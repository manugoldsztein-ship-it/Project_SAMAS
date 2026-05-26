// ============================================================
// trade-coach — AI sanity check on a pending order
// ============================================================
// Runs in the order confirmation step (Broker.jsx ConfirmOrderStep).
// Reads the user's holdings via JWT-scoped RLS, weighs the pending
// trade against the current book, returns a short verdict + reason.
//
// Request body:
//   { ticker: string, side: "buy" | "sell", qty: number, price: number }
// Response:
//   {
//     verdict:   "go" | "caution" | "flag",   // affects UI color/chip
//     headline:  string,                       // 1 line, max 90 chars
//     reason:    string,                       // 1-2 lines, max 200 chars
//     generatedAt: string,
//   }
//
// FALLBACK
//   When no LLM provider is configured (or the call fails), we run
//   a heuristic on the numbers (concentration deltas, sector mix,
//   sufficient capital) and return a sensible verdict. Same shape.
//
// LLM PROVIDER (samas-0.4.85)
//   This function calls the shared callLLM() helper in _shared/llm.ts.
//   Provider is picked by LLM_PROVIDER env var (anthropic | ollama).
//   See _shared/llm.ts header for all env vars.
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy trade-coach
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  consumeRateLimit, RATE_LIMITS, buildBucket, rateLimit429, makeAdminClient,
} from "../_shared/rate-limit.ts";
import {
  readJsonBody, sanitizeString, validationErrorResponse,
} from "../_shared/validate.ts";
import { callLLM, parseLLMJson } from "../_shared/llm.ts";

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

// Asset metadata — mirror of broker.js ASSETS, kept in sync by hand.
const ASSETS: Record<string, { name: string; category: string; currency: string; price: number; }> = {
  AAPL: { name: "Apple",            category: "CEDEAR", currency: "USD", price: 215.40 },
  NVDA: { name: "NVIDIA",           category: "CEDEAR", currency: "USD", price: 892.15 },
  TSLA: { name: "Tesla",            category: "CEDEAR", currency: "USD", price: 248.30 },
  MSFT: { name: "Microsoft",        category: "CEDEAR", currency: "USD", price: 432.10 },
  GOOGL:{ name: "Alphabet",         category: "CEDEAR", currency: "USD", price: 184.20 },
  GGAL: { name: "Grupo Galicia",    category: "ACCION", currency: "ARS", price: 4250 },
  YPF:  { name: "YPF",              category: "ACCION", currency: "ARS", price: 38500 },
  PAMP: { name: "Pampa Energía",    category: "ACCION", currency: "ARS", price: 5820 },
  IBIT:  { name: "iShares Bitcoin Trust", category: "CEDEAR", currency: "USD", price: 62.4 },
  COIN:  { name: "Coinbase", category: "CEDEAR", currency: "USD", price: 247.3 },
  MSTR:  { name: "MicroStrategy", category: "CEDEAR", currency: "USD", price: 358.4 },
  MARA:  { name: "Marathon Digital", category: "CEDEAR", currency: "USD", price: 18.2 },
  RIOT:  { name: "Riot Platforms", category: "CEDEAR", currency: "USD", price: 11.85 },
  AL30: { name: "Bonar 2030",       category: "BONO",   currency: "USD", price: 56.70 },
  MMARS:  { name: "SAMAS Money Market ARS", category: "FCI", currency: "ARS", price: 100.42 },
  MMUSD:  { name: "SAMAS Money Market USD", category: "FCI", currency: "USD", price: 102.18 },
  RFAR:  { name: "SAMAS Renta Fija", category: "FCI", currency: "USD", price: 105.83 },
  MIXTO:  { name: "SAMAS Mixta", category: "FCI", currency: "USD", price: 112.4 },
  EQUITY:  { name: "SAMAS Renta Variable", category: "FCI", currency: "USD", price: 128.95 },
  SPY:  { name: "S&P 500 ETF",      category: "ETF",    currency: "USD", price: 512.40 },
  QQQ:  { name: "Nasdaq-100 ETF",   category: "ETF",    currency: "USD", price: 431.20 },
  IWM:  { name: "Russell 2000 ETF", category: "ETF",    currency: "USD", price: 218.65 },
  EWZ:  { name: "Brasil ETF",       category: "ETF",    currency: "USD", price:  29.40 },
  GLD:  { name: "Oro (SPDR Gold)",  category: "COMMOD", currency: "USD", price: 228.60 },
  SLV:  { name: "Plata (iShares)",  category: "COMMOD", currency: "USD", price:  27.85 },
  USO:  { name: "Petróleo (USO)",   category: "COMMOD", currency: "USD", price:  81.30 },
};

const ARS_TO_USD = 1 / 1245;

type EnrichedHolding = {
  ticker: string; name: string; category: string;
  qty: number; valueUsd: number; pctOfBook: number;
};

// Heuristic verdict when no Anthropic key. Uses concentration after
// the trade + sector mix to produce a sensible verdict.
function templatedCoach(input: {
  ticker: string; side: "buy" | "sell"; qty: number; price: number;
  holdings: EnrichedHolding[];
}) {
  const { ticker, side, qty, price, holdings } = input;
  const meta = ASSETS[ticker];
  const tradeUsd = (() => {
    if (!meta) return qty * price;
    const local = qty * price;
    return meta.currency === "ARS" ? local * ARS_TO_USD : local;
  })();
  const tickerName = meta?.name || ticker;
  const isBuy = side === "buy";

  if (holdings.length === 0) {
    if (isBuy) {
      return {
        verdict: "go" as const,
        headline: `Primera posición: ${tickerName}.`,
        reason: `Empezás con ${ticker}. Pensalo como semilla — diversificá según vayas sumando capital.`,
      };
    }
    return {
      verdict: "flag" as const,
      headline: `No hay ${ticker} en tu cartera.`,
      reason: `Estás intentando vender un ticker que no aparece en tus posiciones. Revisá antes de confirmar.`,
    };
  }

  const totalUsd = holdings.reduce((acc, h) => acc + h.valueUsd, 0);
  const existing = holdings.find((h) => h.ticker === ticker);
  const existingPct = existing ? existing.pctOfBook : 0;

  if (!isBuy) {
    if (!existing || existing.qty < qty) {
      return {
        verdict: "flag" as const,
        headline: "Cantidad mayor a la que tenés.",
        reason: `Intentás vender ${qty} ${ticker} pero solo tenés ${existing?.qty ?? 0}. Ajustá la cantidad.`,
      };
    }
    const pctSold = existing.qty > 0 ? (qty / existing.qty) * 100 : 0;
    if (pctSold >= 100) {
      return {
        verdict: "caution" as const,
        headline: `Cerrás la posición en ${tickerName}.`,
        reason: `Esta venta liquida el 100% de tu ${ticker}. Asegurate de que la tesis cambió, no solo el precio.`,
      };
    }
    return {
      verdict: "go" as const,
      headline: `Reducís ${tickerName} en ${pctSold.toFixed(0)}%.`,
      reason: "Toma de ganancias o rotación parcial — disciplina razonable.",
    };
  }

  // BUY path — compute resulting concentration.
  const newValue = (existing?.valueUsd || 0) + tradeUsd;
  const newTotal = totalUsd + tradeUsd;
  const newPct = newTotal > 0 ? (newValue / newTotal) * 100 : 0;
  const sectorMap: Record<string, number> = {};
  for (const h of holdings) sectorMap[h.category] = (sectorMap[h.category] || 0) + h.valueUsd;
  if (meta) sectorMap[meta.category] = (sectorMap[meta.category] || 0) + tradeUsd;
  const topSector = Object.entries(sectorMap).sort((a, b) => b[1] - a[1])[0];
  const topSectorPct = newTotal > 0 ? (topSector[1] / newTotal) * 100 : 0;

  if (newPct > 40) {
    return {
      verdict: "caution" as const,
      headline: `${ticker} llegaría al ${newPct.toFixed(0)}% de tu cartera.`,
      reason: `Concentración alta. Si la tesis es fuerte, dale — sino considerá tamaño más chico.`,
    };
  }
  if (topSectorPct > 60 && meta?.category === topSector[0]) {
    const sectorLabel: Record<string, string> = {
      CEDEAR: "CEDEARs", ACCION: "acciones argentinas", CRYPTO: "cripto",
      BONO: "bonos", ETF: "ETFs", COMMOD: "commodities",
    };
    return {
      verdict: "caution" as const,
      headline: `Tu exposición a ${sectorLabel[topSector[0]] || topSector[0]} pasaría a ${topSectorPct.toFixed(0)}%.`,
      reason: "Mucho peso en una sola categoría aumenta correlación entre tus posiciones.",
    };
  }
  if (existing) {
    return {
      verdict: "go" as const,
      headline: `Sumás a tu posición en ${tickerName}.`,
      reason: `Quedaría en ${newPct.toFixed(0)}% del book. Promedio sano si la tesis sigue intacta.`,
    };
  }
  return {
    verdict: "go" as const,
    headline: `Nueva posición en ${tickerName}.`,
    reason: `Diversificación sumando categoría. Quedaría en ${newPct.toFixed(0)}% del book.`,
  };
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
      bucket: buildBucket("trade-coach", { userId: user.id }),
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
    const ticker = String(body?.ticker || "").trim().toUpperCase();
    const side = body?.side === "sell" ? "sell" : "buy";
    const qty = Number(body?.qty);
    const price = Number(body?.price);
    if (!ticker || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      return new Response(JSON.stringify({ error: "ticker, qty, price requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- read holdings ---
    const { data: holdings } = await userClient
      .from("holdings")
      .select("ticker, qty, currency");
    const enriched: EnrichedHolding[] = (holdings || [])
      .filter((h) => Number(h.qty) > 0)
      .map((h) => {
        const meta = ASSETS[h.ticker] || { name: h.ticker, category: "OTROS", currency: h.currency || "USD", price: 0 };
        const qty = Number(h.qty) || 0;
        const valueLocal = qty * meta.price;
        const valueUsd = meta.currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
        return { ticker: h.ticker, name: meta.name, category: meta.category, qty, valueUsd, pctOfBook: 0 };
      });
    const totalUsd = enriched.reduce((acc, h) => acc + h.valueUsd, 0);
    enriched.forEach((h) => { h.pctOfBook = totalUsd > 0 ? (h.valueUsd / totalUsd) * 100 : 0; });

    // --- LLM path (or templated) ---
    const meta = ASSETS[ticker];
    const tradeUsd = meta?.currency === "ARS" ? qty * price * ARS_TO_USD : qty * price;
    const portfolioJson = enriched.map((h) => ({
      ticker: h.ticker, name: h.name, category: h.category,
      qty: h.qty, valueUsd: Math.round(h.valueUsd),
      pctOfBook: Number(h.pctOfBook.toFixed(1)),
    }));

    const userPrompt = [
      `Sos SAMAS, una asistente de inversiones para retail argentino. El usuario está por confirmar una operación. Devolvé un JSON con este formato EXACTO, sin markdown:`,
      `{`,
      `  "verdict": "go" | "caution" | "flag",`,
      `  "headline": "1 línea, máximo 90 caracteres",`,
      `  "reason": "1-2 líneas, máximo 180 caracteres"`,
      `}`,
      ``,
      `Reglas:`,
      `- Voseo (vos), profesional y cercano. Cero hype, cero emojis.`,
      `- "go" = la operación parece consistente con la cartera.`,
      `- "caution" = ruido a flagear (concentración, exposición sectorial, costo grande relativo a book).`,
      `- "flag" = problema concreto (vender más de lo que tiene, ticker desconocido, etc).`,
      `- No des recomendación directa de comprar/vender. Sí podés hablar de riesgo/concentración/encaje en la cartera.`,
      ``,
      `Operación:`,
      `- Lado: ${side === "buy" ? "compra" : "venta"}`,
      `- Ticker: ${ticker} (${meta?.name || "desconocido"}, categoría ${meta?.category || "?"})`,
      `- Cantidad: ${qty}`,
      `- Precio unitario: ${meta?.currency || "USD"} ${price}`,
      `- Monto total estimado: US$${Math.round(tradeUsd).toLocaleString("en-US")}`,
      ``,
      `Cartera actual del usuario (valor total US$${Math.round(totalUsd).toLocaleString("en-US")}):`,
      enriched.length > 0 ? JSON.stringify(portfolioJson, null, 2) : "(cartera vacía)",
    ].join("\n");

    const llm = await callLLM({ user: userPrompt, maxTokens: 400, timeoutMs: 12000 });
    if (!llm) {
      const tmpl = templatedCoach({ ticker, side, qty, price, holdings: enriched });
      return new Response(JSON.stringify({ ...tmpl, generatedAt: new Date().toISOString() }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const parsed = parseLLMJson<{ verdict?: string; headline?: string; reason?: string }>(llm.text);
    if (!parsed) {
      console.warn("[trade-coach] non-JSON response:", llm.text.slice(0, 200));
      const tmpl = templatedCoach({ ticker, side, qty, price, holdings: enriched });
      return new Response(JSON.stringify({ ...tmpl, generatedAt: new Date().toISOString() }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const verdict = (["go", "caution", "flag"].includes(parsed.verdict || ""))
      ? (parsed.verdict as "go" | "caution" | "flag") : "go";
    return new Response(JSON.stringify({
      verdict,
      headline:    String(parsed.headline || "").slice(0, 200),
      reason:      String(parsed.reason   || "").slice(0, 240),
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[trade-coach] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
