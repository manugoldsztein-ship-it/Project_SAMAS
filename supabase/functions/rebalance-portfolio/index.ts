// ============================================================
// rebalance-portfolio — AI-suggested rebalance actions
// ============================================================
// Reads the caller's holdings, computes their current category mix
// (CEDEAR / ACCION / CRYPTO / BONO / ETF / COMMOD), compares to a
// requested risk profile, and returns a list of concrete buy/sell
// actions that would move the book toward the target.
//
// Request body:
//   { profile: "conservative" | "balanced" | "aggressive" }
// Response:
//   {
//     actions: [
//       { side: "buy"|"sell", ticker: string, qty: number,
//         currency: "ARS"|"USD", reason: string,
//         estUsd: number },
//       ...                                      // up to 6 actions
//     ],
//     summary:    string,                         // 1-2 sentences
//     targetMix:  Record<string, number>,         // % by category
//     currentMix: Record<string, number>,
//     generatedAt: string,
//   }
//
// FALLBACK
//   No API key → deterministic algorithmic rebalance using fixed
//   per-profile target weights. Same response shape.
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  consumeRateLimit, RATE_LIMITS, buildBucket, rateLimit429, makeAdminClient,
} from "../_shared/rate-limit.ts";
import {
  readJsonBody, sanitizeString, validationErrorResponse,
} from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";

const ASSETS: Record<string, { name: string; category: string; currency: string; price: number; }> = {
  AAPL: { name: "Apple",            category: "CEDEAR", currency: "USD", price: 215.40 },
  NVDA: { name: "NVIDIA",           category: "CEDEAR", currency: "USD", price: 892.15 },
  TSLA: { name: "Tesla",            category: "CEDEAR", currency: "USD", price: 248.30 },
  MSFT: { name: "Microsoft",        category: "CEDEAR", currency: "USD", price: 432.10 },
  GOOGL:{ name: "Alphabet",         category: "CEDEAR", currency: "USD", price: 184.20 },
  GGAL: { name: "Grupo Galicia",    category: "ACCION", currency: "ARS", price: 4250 },
  YPF:  { name: "YPF",              category: "ACCION", currency: "ARS", price: 38500 },
  PAMP: { name: "Pampa Energía",    category: "ACCION", currency: "ARS", price: 5820 },
  BTC:  { name: "Bitcoin",          category: "CRYPTO", currency: "USD", price: 92450 },
  ETH:  { name: "Ethereum",         category: "CRYPTO", currency: "USD", price: 2845 },
  AL30: { name: "Bonar 2030",       category: "BONO",   currency: "USD", price: 56.70 },
  SPY:  { name: "S&P 500 ETF",      category: "ETF",    currency: "USD", price: 512.40 },
  QQQ:  { name: "Nasdaq-100 ETF",   category: "ETF",    currency: "USD", price: 431.20 },
  IWM:  { name: "Russell 2000 ETF", category: "ETF",    currency: "USD", price: 218.65 },
  EWZ:  { name: "Brasil ETF",       category: "ETF",    currency: "USD", price:  29.40 },
  GLD:  { name: "Oro (SPDR Gold)",  category: "COMMOD", currency: "USD", price: 228.60 },
  SLV:  { name: "Plata (iShares)",  category: "COMMOD", currency: "USD", price:  27.85 },
  USO:  { name: "Petróleo (USO)",   category: "COMMOD", currency: "USD", price:  81.30 },
};

const ARS_TO_USD = 1 / 1245;

// Target category mix per risk profile. Numbers are % of total book
// in USD. Should sum to 100.
const PROFILE_TARGETS: Record<string, Record<string, number>> = {
  conservative: { ETF: 35, BONO: 30, CEDEAR: 15, ACCION: 5,  COMMOD: 10, CRYPTO: 5 },
  balanced:     { ETF: 30, BONO: 15, CEDEAR: 25, ACCION: 15, COMMOD: 10, CRYPTO: 5 },
  aggressive:   { ETF: 15, BONO: 5,  CEDEAR: 35, ACCION: 20, COMMOD: 5,  CRYPTO: 20 },
};

const CATEGORY_LABEL: Record<string, string> = {
  CEDEAR: "CEDEARs (acciones US)",
  ACCION: "acciones argentinas",
  CRYPTO: "cripto",
  BONO:   "bonos",
  ETF:    "ETFs",
  COMMOD: "commodities",
};

// Default ticker pick per category — used when buying into a
// category for the first time. Ranked by liquidity / popularity.
const CATEGORY_DEFAULT_TICKER: Record<string, string> = {
  CEDEAR: "AAPL",
  ACCION: "GGAL",
  CRYPTO: "BTC",
  BONO:   "AL30",
  ETF:    "SPY",
  COMMOD: "GLD",
};

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

type Holding = {
  ticker: string;
  name: string;
  category: string;
  qty: number;
  currency: string;
  price: number;
  valueUsd: number;
};

// Algorithmic rebalance — used both as the no-API-key fallback AND
// as the seed proposal that we hand to the LLM as context.
function algorithmicActions(opts: {
  profile: string;
  holdings: Holding[];
  totalUsd: number;
  currentMix: Record<string, number>;
  targetMix: Record<string, number>;
}) {
  const { holdings, totalUsd, currentMix, targetMix } = opts;
  const actions: {
    side: "buy" | "sell"; ticker: string; qty: number;
    currency: "ARS" | "USD"; reason: string; estUsd: number;
  }[] = [];

  // Iterate categories with a non-trivial gap (≥3 percentage points).
  const cats = Object.keys(targetMix);
  type Gap = { cat: string; gapPct: number; gapUsd: number };
  const gaps: Gap[] = cats.map((cat) => {
    const have = currentMix[cat] || 0;
    const want = targetMix[cat] || 0;
    const gapPct = want - have;
    const gapUsd = (gapPct / 100) * totalUsd;
    return { cat, gapPct, gapUsd };
  }).filter((g) => Math.abs(g.gapPct) >= 3);

  // Sort by absolute gap so the biggest deltas surface first.
  gaps.sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));

  for (const g of gaps.slice(0, 6)) {
    if (g.gapUsd > 0) {
      // BUY — find or pick a default ticker in this category.
      const heldInCat = holdings
        .filter((h) => h.category === g.cat)
        .sort((a, b) => b.valueUsd - a.valueUsd);
      const ticker = heldInCat[0]?.ticker || CATEGORY_DEFAULT_TICKER[g.cat];
      if (!ticker) continue;
      const meta = ASSETS[ticker];
      if (!meta) continue;
      const priceLocal = meta.price;
      const targetLocal = meta.currency === "ARS" ? g.gapUsd / ARS_TO_USD : g.gapUsd;
      // Round qty to 2 decimals for crypto (BTC 0.05) or whole units
      // for everything else.
      const qty = meta.category === "CRYPTO"
        ? Number((targetLocal / priceLocal).toFixed(4))
        : Math.max(1, Math.round(targetLocal / priceLocal));
      if (qty <= 0) continue;
      actions.push({
        side: "buy", ticker, qty,
        currency: meta.currency as "ARS" | "USD",
        reason: heldInCat[0]
          ? `Sumar a ${ticker} para llegar al ${(targetMix[g.cat] || 0).toFixed(0)}% en ${CATEGORY_LABEL[g.cat] || g.cat}.`
          : `Abrir posición en ${CATEGORY_LABEL[g.cat] || g.cat} (objetivo ${(targetMix[g.cat] || 0).toFixed(0)}% del book).`,
        estUsd: g.gapUsd,
      });
    } else {
      // SELL — must have a position in this category.
      const heldInCat = holdings
        .filter((h) => h.category === g.cat)
        .sort((a, b) => b.valueUsd - a.valueUsd);
      if (heldInCat.length === 0) continue;
      // Sell from the LARGEST position in the over-weighted category.
      const top = heldInCat[0];
      const meta = ASSETS[top.ticker];
      if (!meta) continue;
      const priceLocal = meta.price;
      const sellLocal = meta.currency === "ARS"
        ? Math.abs(g.gapUsd) / ARS_TO_USD
        : Math.abs(g.gapUsd);
      let qty = meta.category === "CRYPTO"
        ? Number((sellLocal / priceLocal).toFixed(4))
        : Math.max(1, Math.round(sellLocal / priceLocal));
      qty = Math.min(qty, top.qty);   // cap at owned qty
      if (qty <= 0) continue;
      actions.push({
        side: "sell", ticker: top.ticker, qty,
        currency: meta.currency as "ARS" | "USD",
        reason: `Reducir ${top.ticker}: ${CATEGORY_LABEL[g.cat] || g.cat} está en ${(currentMix[g.cat] || 0).toFixed(0)}% (objetivo ${(targetMix[g.cat] || 0).toFixed(0)}%).`,
        estUsd: Math.abs(g.gapUsd),
      });
    }
  }

  return actions;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- auth gate ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return new Response(JSON.stringify({ error: "missing token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- rate limit (samas-0.4.17): AI tier ---
    const _rl = await consumeRateLimit(makeAdminClient(), {
      bucket: buildBucket("rebalance-portfolio", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    // --- parse body ---
    let _body: unknown;
    try {
      _body = await readJsonBody(req);
    } catch (e) {
      const ve = validationErrorResponse(e, corsHeaders);
      if (ve) return ve;
      throw e;
    }
    const body = _body as Record<string, unknown>;
    const profile = String(body?.profile || "balanced") as keyof typeof PROFILE_TARGETS;
    if (!PROFILE_TARGETS[profile]) {
      return new Response(JSON.stringify({ error: "perfil inválido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const targetMix = PROFILE_TARGETS[profile];

    // --- read holdings ---
    const { data: rawHoldings } = await userClient
      .from("holdings").select("ticker, qty, currency").gt("qty", 0);
    const holdings: Holding[] = (rawHoldings || []).map((h) => {
      const meta = ASSETS[h.ticker] || { name: h.ticker, category: "OTROS", currency: h.currency || "USD", price: 0 };
      const qty = Number(h.qty) || 0;
      const valueLocal = qty * meta.price;
      const valueUsd = meta.currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
      return {
        ticker: h.ticker, name: meta.name, category: meta.category,
        qty, currency: meta.currency, price: meta.price, valueUsd,
      };
    });

    if (holdings.length === 0) {
      return new Response(JSON.stringify({
        actions: [],
        summary: "Tu cartera está vacía. Empezá comprando algo desde Mercado y volvé para rebalancear.",
        targetMix, currentMix: {},
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Compute current mix (% of total USD per category).
    const totalUsd = holdings.reduce((acc, h) => acc + h.valueUsd, 0);
    const currentMix: Record<string, number> = {};
    for (const h of holdings) {
      currentMix[h.category] = (currentMix[h.category] || 0) + h.valueUsd;
    }
    for (const k of Object.keys(currentMix)) {
      currentMix[k] = totalUsd > 0 ? (currentMix[k] / totalUsd) * 100 : 0;
    }

    // Run the deterministic algorithm — gives us either the final
    // answer (no API key) or a strong starting point for the LLM.
    const seedActions = algorithmicActions({
      profile, holdings, totalUsd, currentMix, targetMix,
    });

    // --- LLM path (or templated fallback) ---
    if (!ANTHROPIC_API_KEY) {
      console.log(`[rebalance-portfolio] no API key — algorithmic for "${profile}"`);
      const summary = seedActions.length === 0
        ? `Tu cartera ya está balanceada para perfil ${profile}. No sugerimos cambios.`
        : `${seedActions.length} acción${seedActions.length > 1 ? "es" : ""} sugerida${seedActions.length > 1 ? "s" : ""} para acercar tu cartera al perfil ${profile}.`;
      return new Response(JSON.stringify({
        actions: seedActions, summary, targetMix, currentMix,
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // LLM-enhanced version: hand the LLM the context + seed proposal,
    // ask it to refine the rationale on each action and the overall
    // summary. We keep the algorithmic actions intact (changing them
    // would be inviting hallucination) — we just upgrade the language.
    const userPrompt = [
      `Sos SAMAS, asistente de inversiones para retail argentino. Tenés una propuesta algorítmica de rebalanceo y querés mejorar la redacción para que suene como una conversación, no como un script.`,
      ``,
      `Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{`,
      `  "summary": "1-2 oraciones en español, voseo, profesional y cercana, máximo 200 caracteres",`,
      `  "reasons": ["array con la razón refinada para cada acción, en el MISMO orden, máximo 130 caracteres cada una"]`,
      `}`,
      ``,
      `Reglas estrictas:`,
      `- NO modifiques los tickers ni las cantidades. Solo refinás la redacción.`,
      `- Voseo (vos), profesional, cero emojis, cero hype.`,
      `- No des recomendación legal ni fiscal.`,
      `- "reasons" debe tener exactamente ${seedActions.length} elementos.`,
      ``,
      `Perfil objetivo: ${profile}`,
      `Total cartera: US$${Math.round(totalUsd).toLocaleString("en-US")}`,
      ``,
      `Mix actual: ${JSON.stringify(currentMix)}`,
      `Mix objetivo: ${JSON.stringify(targetMix)}`,
      ``,
      `Acciones propuestas:`,
      JSON.stringify(seedActions, null, 2),
    ].join("\n");

    const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 800,
        messages: [{ role: "user", content: userPrompt }],
      }),
    }, 12000);

    if (!r.ok) {
      // Fall back to algorithmic on LLM error.
      const summary = `${seedActions.length} acción${seedActions.length > 1 ? "es" : ""} para acercarte al perfil ${profile}.`;
      return new Response(JSON.stringify({
        actions: seedActions, summary, targetMix, currentMix,
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const json = await r.json();
    const text = json?.content?.[0]?.text || "";
    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: { summary?: string; reasons?: string[] };
    try { parsed = JSON.parse(stripped); } catch {
      parsed = { summary: text.slice(0, 200), reasons: [] };
    }

    // Apply the refined reasons back onto the actions, preserving
    // numerical fields. If the LLM returned a different count than
    // we sent, fall back to the seed reasons for any gaps.
    const refinedActions = seedActions.map((a, i) => ({
      ...a,
      reason: (Array.isArray(parsed.reasons) && parsed.reasons[i])
        ? String(parsed.reasons[i]).slice(0, 200)
        : a.reason,
    }));

    return new Response(JSON.stringify({
      actions:    refinedActions,
      summary:    String(parsed.summary || "").slice(0, 240),
      targetMix, currentMix,
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[rebalance-portfolio] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
