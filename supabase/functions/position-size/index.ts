// ============================================================
// position-size — AI position-sizing suggestions
// ============================================================
// Fires when the user is about to enter a qty in the trade form.
// Reads holdings + cash balance + the target ticker, returns three
// deterministic suggestions (conservador / estándar / agresivo) so
// the user has a starting point instead of typing into a vacuum.
//
// Sizing rules (deterministic, server-side):
//   For each bucket we compute the smaller of two caps:
//     a) % of total book USD value
//     b) % of available cash for the asset's currency
//   Then divide by current price → suggested qty (floored to whole
//   units for all categories — Cohen settles in integer units).
//   Then nudge down if the resulting position would push the ticker
//   above the concentration ceiling for that bucket.
//
//   Conservative: 1.5% of book OR  5% of cash, ceiling 10% concentration
//   Standard:     5%   of book OR 15% of cash, ceiling 20% concentration
//   Aggressive:   10%  of book OR 30% of cash, ceiling 35% concentration
//
// Each suggestion comes with a Claude-refined one-line rationale.
// Numbers stay deterministic; the LLM only refines text.
//
// Request body: { ticker: string, side: "buy" | "sell" }
// Response (buy):
//   {
//     suggestions: [
//       { label: "conservador" | "estandar" | "agresivo",
//         qty: number, pctOfBook: number, valueUsd: number,
//         rationale: string },
//       ...
//     ],
//     summary: string,
//     generatedAt: string,
//   }
//
// For SELL we return only "tomar parte" suggestions (1/3 / 1/2 /
// todo) computed off the held qty.
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy position-size \
//     --project-ref diulqkaorfqccipguiok --no-verify-jwt
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
  // samas-0.4.18 security headers
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";

const ASSETS: Record<string, { name: string; category: string; currency: string; price: number; }> = {
  AAPL:  { name: "Apple",            category: "CEDEAR", currency: "USD", price: 215.40 },
  NVDA:  { name: "NVIDIA",           category: "CEDEAR", currency: "USD", price: 892.15 },
  TSLA:  { name: "Tesla",            category: "CEDEAR", currency: "USD", price: 248.30 },
  MSFT:  { name: "Microsoft",        category: "CEDEAR", currency: "USD", price: 432.10 },
  GOOGL: { name: "Alphabet",         category: "CEDEAR", currency: "USD", price: 184.20 },
  META:  { name: "Meta Platforms",   category: "CEDEAR", currency: "USD", price: 568.40 },
  AMZN:  { name: "Amazon",           category: "CEDEAR", currency: "USD", price: 198.20 },
  KO:    { name: "Coca-Cola",        category: "CEDEAR", currency: "USD", price: 71.10 },
  GGAL:  { name: "Grupo Galicia",    category: "ACCION", currency: "ARS", price: 4250 },
  YPF:   { name: "YPF",              category: "ACCION", currency: "ARS", price: 38500 },
  PAMP:  { name: "Pampa Energía",    category: "ACCION", currency: "ARS", price: 5820 },
  ALUA:  { name: "Aluar",            category: "ACCION", currency: "ARS", price: 1180 },
  SPY:   { name: "S&P 500 ETF",      category: "ETF",    currency: "USD", price: 542.30 },
  QQQ:   { name: "Nasdaq-100 ETF",   category: "ETF",    currency: "USD", price: 478.20 },
  AL30:  { name: "Bonar 2030",       category: "BONO",   currency: "USD", price: 58.30 },
  GD30:  { name: "Global 2030",      category: "BONO",   currency: "USD", price: 56.10 },
};

const ARS_TO_USD = 1 / 1245;

// Per-category risk weight — how much each unit "costs" against the
// concentration ceiling. Higher = treat as more risky → suggest less.
// CRYPTO removed in samas-0.4.21 (Cohen doesn't operate it).
const CATEGORY_RISK: Record<string, number> = {
  BONO: 0.4, ETF: 0.7, CEDEAR: 1.0, ACCION: 1.1, COMMOD: 1.2,
};

type Bucket = {
  id: "conservador" | "estandar" | "agresivo";
  pctOfBookCap: number;
  pctOfCashCap: number;
  concCeiling: number; // 0..1
};

const BUCKETS: Bucket[] = [
  { id: "conservador", pctOfBookCap: 0.015, pctOfCashCap: 0.05, concCeiling: 0.10 },
  { id: "estandar",    pctOfBookCap: 0.05,  pctOfCashCap: 0.15, concCeiling: 0.20 },
  { id: "agresivo",    pctOfBookCap: 0.10,  pctOfCashCap: 0.30, concCeiling: 0.35 },
];

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

function roundQty(qty: number, category: string): number {
  if (qty <= 0) return 0;
  // Whole units for everything (Cohen settles in integer units).
  return Math.floor(qty);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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
      bucket: buildBucket("position-size", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    let _body: unknown;
    try {
      _body = await readJsonBody(req);
    } catch (e) {
      const ve = validationErrorResponse(e, corsHeaders);
      if (ve) return ve;
      throw e;
    }
    const body = _body as Record<string, unknown>;
    const ticker = String(body?.ticker || "").toUpperCase();
    const side = (body?.side === "sell" ? "sell" : "buy") as "buy" | "sell";
    if (!ticker || !ASSETS[ticker]) {
      return new Response(JSON.stringify({
        suggestions: [],
        summary: "Sin info para este ticker.",
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const asset = ASSETS[ticker];

    // --- read holdings ---
    const { data: rawHoldings } = await userClient
      .from("holdings")
      .select("ticker, qty, avg_cost, currency")
      .gt("qty", 0);
    const holdings = rawHoldings || [];

    let totalUsd = 0;
    let alreadyHeldQty = 0;
    let alreadyHeldUsd = 0;
    for (const h of holdings) {
      const meta = ASSETS[h.ticker];
      const qty = Number(h.qty) || 0;
      const px = meta?.price ?? Number(h.avg_cost) ?? 0;
      const ccy = (meta?.currency ?? h.currency ?? "USD") as "ARS" | "USD";
      const valueLocal = qty * px;
      const valueUsd = ccy === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
      totalUsd += valueUsd;
      if (h.ticker === ticker) {
        alreadyHeldQty = qty;
        alreadyHeldUsd = valueUsd;
      }
    }

    // --- read cash balance from accounts table (currency, balance) ---
    const { data: accountsRows } = await userClient
      .from("accounts")
      .select("currency, balance");
    const balanceMap: Record<string, number> = {};
    for (const a of (accountsRows || [])) {
      balanceMap[a.currency] = Number(a.balance) || 0;
    }
    const cashArs = balanceMap["ARS"] || 0;
    const cashUsd = balanceMap["USD"] || 0;
    const cashLocal = asset.currency === "ARS" ? cashArs : cashUsd;
    const cashLocalUsd = asset.currency === "ARS" ? cashArs * ARS_TO_USD : cashUsd;

    // ----------------------------------------------------------
    // SELL side: simple fractional take suggestions vs held qty.
    // ----------------------------------------------------------
    if (side === "sell") {
      if (alreadyHeldQty <= 0) {
        return new Response(JSON.stringify({
          suggestions: [],
          summary: "No tenés posición acá. ¿Quisiste decir comprar?",
          generatedAt: new Date().toISOString(),
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const sells = [
        { id: "un_tercio",    label: "Un tercio",    factor: 1 / 3 },
        { id: "la_mitad",     label: "La mitad",     factor: 0.5 },
        { id: "todo",         label: "Cerrar posición", factor: 1.0 },
      ];
      const suggestions = sells.map((s) => {
        const qty = roundQty(alreadyHeldQty * s.factor, asset.category);
        const valueUsd = qty * asset.price * (asset.currency === "ARS" ? ARS_TO_USD : 1);
        return {
          label: s.id,
          displayLabel: s.label,
          qty,
          pctOfBook: totalUsd > 0 ? (valueUsd / totalUsd) * 100 : 0,
          valueUsd: Number(valueUsd.toFixed(2)),
          rationale: s.factor === 1
            ? `Cerrar tus ${alreadyHeldQty.toString()} unidades. Liberás ${ticker} por completo.`
            : `Vender ${qty} unidades. Te quedan ${alreadyHeldQty - qty} (${(((alreadyHeldQty - qty) / alreadyHeldQty) * 100).toFixed(0)}% de la posición original).`,
        };
      });
      return new Response(JSON.stringify({
        suggestions,
        summary: `Tenés ${alreadyHeldQty} unidades de ${ticker}. Acá hay 3 maneras de tomar parte.`,
        generatedAt: new Date().toISOString(),
        side: "sell",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ----------------------------------------------------------
    // BUY side: bucketed sizing.
    // ----------------------------------------------------------
    const priceUsd = asset.currency === "ARS" ? asset.price * ARS_TO_USD : asset.price;

    const rawSuggestions = BUCKETS.map((b) => {
      const cashCapLocal = cashLocal * b.pctOfCashCap;
      const cashCapUsd = cashLocalUsd * b.pctOfCashCap;
      const bookCapUsd = totalUsd > 0 ? totalUsd * b.pctOfBookCap : cashCapUsd;
      // Smaller cap wins. For empty-portfolio first-buyers, fall back
      // to cash cap so we still suggest something.
      let targetUsd = totalUsd > 0 ? Math.min(bookCapUsd, cashCapUsd) : cashCapUsd;

      // Concentration ceiling: don't push the ticker above ceiling % of book.
      const newTotalUsd = totalUsd + targetUsd;
      const newPosUsd = alreadyHeldUsd + targetUsd;
      const newConc = newTotalUsd > 0 ? newPosUsd / newTotalUsd : 0;
      if (newConc > b.concCeiling && newTotalUsd > 0) {
        // Solve newPos / newTotal == ceiling for the buy amount
        // (alreadyHeld + buy) / (total + buy) = c
        // alreadyHeld + buy = c*total + c*buy
        // buy*(1-c) = c*total - alreadyHeld
        const buyForCeiling = (b.concCeiling * totalUsd - alreadyHeldUsd) / (1 - b.concCeiling);
        targetUsd = Math.max(0, Math.min(targetUsd, buyForCeiling));
      }

      // Apply category risk weight as a small dampener for riskier
      // categories at the conservative bucket only.
      if (b.id === "conservador") {
        const w = CATEGORY_RISK[asset.category] || 1.0;
        if (w > 1.1) targetUsd = targetUsd / w;
      }

      const qtyRaw = priceUsd > 0 ? targetUsd / priceUsd : 0;
      const qty = roundQty(qtyRaw, asset.category);
      const valueUsd = qty * priceUsd;
      const newPosFinal = alreadyHeldUsd + valueUsd;
      const newTotalFinal = totalUsd + valueUsd;
      const finalPctOfBook = newTotalFinal > 0 ? (newPosFinal / newTotalFinal) * 100 : 0;
      return {
        bucket: b,
        qty,
        valueUsd,
        finalPctOfBook,
      };
    }).filter((s) => s.qty > 0);

    if (rawSuggestions.length === 0) {
      return new Response(JSON.stringify({
        suggestions: [],
        summary: cashLocal <= 0
          ? `Sin saldo en ${asset.currency}. Cargá plata para operar ${ticker}.`
          : `Saldo insuficiente para una compra mínima de ${ticker} a precio actual.`,
        generatedAt: new Date().toISOString(),
        side: "buy",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Templated rationale builder. The LLM may refine these.
    function templatedRationale(s: typeof rawSuggestions[number]): string {
      const concLine = `te dejaría ${s.finalPctOfBook.toFixed(0)}% del book en ${ticker}`;
      if (s.bucket.id === "conservador") {
        return `Compra prudente: ${s.qty} unidades, ${concLine}. Bajo impacto si la tesis falla.`;
      }
      if (s.bucket.id === "estandar") {
        return `Tamaño estándar: ${s.qty} unidades, ${concLine}. Convicción moderada.`;
      }
      return `Posición agresiva: ${s.qty} unidades, ${concLine}. Solo si tenés alta convicción.`;
    }

    // ----- LLM refinement (optional) -----
    let aiRationales: string[] = [];
    if (ANTHROPIC_API_KEY) {
      const itemsForPrompt = rawSuggestions.map((s, i) => ({
        i,
        bucket: s.bucket.id,
        qty: s.qty,
        finalPctOfBook: Number(s.finalPctOfBook.toFixed(1)),
        ticker,
        category: asset.category,
      }));
      const userPrompt = [
        `Sos SAMAS, asistente de inversiones para retail argentino. El usuario está por comprar ${ticker} (${asset.category}). Generá una sugerencia de tamaño de posición refinada para cada bucket.`,
        ``,
        `Devolvé un JSON con esta forma EXACTA, sin markdown:`,
        `{`,
        `  "rationales": ["≤120 chars cada una, una por bucket en el MISMO orden"]`,
        `}`,
        ``,
        `Reglas:`,
        `- Voseo (vos), profesional, sereno. Cero hype.`,
        `- En cada rationale mencioná: cantidad concreta de unidades, % del book post-compra, y el "porqué" del bucket.`,
        `- "rationales" debe tener exactamente ${rawSuggestions.length} elementos.`,
        `- Mantené números tal cual te los paso.`,
        ``,
        `Buckets:`,
        JSON.stringify(itemsForPrompt, null, 2),
      ].join("\n");

      try {
        const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: ANTHROPIC_MODEL, max_tokens: 600,
            messages: [{ role: "user", content: userPrompt }],
          }),
        }, 10000);
        if (r.ok) {
          const json = await r.json();
          const text = json?.content?.[0]?.text || "";
          const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
          const parsed = JSON.parse(stripped);
          if (Array.isArray(parsed.rationales)) {
            aiRationales = parsed.rationales.map((s: unknown) => String(s).slice(0, 200));
          }
        }
      } catch (_e) { /* fall back to templated */ }
    }

    const suggestions = rawSuggestions.map((s, i) => ({
      label: s.bucket.id,
      displayLabel: s.bucket.id === "conservador" ? "Conservador"
        : s.bucket.id === "estandar" ? "Estándar"
        : "Agresivo",
      qty: s.qty,
      pctOfBook: Number(s.finalPctOfBook.toFixed(1)),
      valueUsd: Number(s.valueUsd.toFixed(2)),
      rationale: aiRationales[i] || templatedRationale(s),
    }));

    const summary = totalUsd > 0
      ? `Tu cartera vale ~US$${totalUsd.toFixed(0)}. Acá hay 3 tamaños sugeridos para ${ticker}.`
      : `Primera compra. Acá hay 3 tamaños sugeridos para ${ticker}.`;

    return new Response(JSON.stringify({
      suggestions,
      summary,
      generatedAt: new Date().toISOString(),
      side: "buy",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[position-size] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
