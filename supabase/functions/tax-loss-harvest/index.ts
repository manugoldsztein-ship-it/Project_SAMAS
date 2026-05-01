// ============================================================
// tax-loss-harvest — AI-powered tax-loss harvesting suggestions
// ============================================================
// Reads the user's holdings, computes unrealized P&L per ticker
// using avg_cost vs current price, identifies losers, and suggests
// a list of positions to crystallize this fiscal year to offset
// realized gains (impuesto cedular). All numbers stay deterministic;
// Claude only refines the human-language reasons.
//
// Tax assumption (impuesto cedular AR, residentes, activos USD):
//   rate = 15% on net realized gains (USD-sourced).
//   Realized YTD synthesized client-side already in TaxYearCard;
//   we mirror the exact same deterministic seed here so the
//   "offset target" lines up with the Pro Wallet card.
//
// Request body: {}
// Response:
//   {
//     items: [
//       {
//         ticker, name, qty, avgCost, currentPrice, currency,
//         unrealizedAbs, unrealizedPct,
//         lossUsd,        // |unrealizedAbs| in USD, positive number
//         taxSavingsUsd,  // = lossUsd * 0.15 capped by realizedYtd
//         reason,         // 1 sentence AI/templated
//       },
//       ...
//     ],
//     realizedYtdUsd,
//     totalHarvestableLossUsd,
//     totalTaxSavingsUsd,
//     summary,
//     generatedAt,
//   }
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy tax-loss-harvest \
//     --project-ref diulqkaorfqccipguiok --no-verify-jwt
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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
  BTC:   { name: "Bitcoin",          category: "CRYPTO", currency: "USD", price: 67400 },
  ETH:   { name: "Ethereum",         category: "CRYPTO", currency: "USD", price: 3580 },
  SPY:   { name: "S&P 500 ETF",      category: "ETF",    currency: "USD", price: 542.30 },
  QQQ:   { name: "Nasdaq-100 ETF",   category: "ETF",    currency: "USD", price: 478.20 },
  AL30:  { name: "Bonar 2030",       category: "BONO",   currency: "USD", price: 58.30 },
  GD30:  { name: "Global 2030",      category: "BONO",   currency: "USD", price: 56.10 },
};

const ARS_TO_USD = 1 / 1245;
const TAX_RATE = 0.15;

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

// Mirrors the deterministic seed used in src/v2/Wallet.jsx TaxYearCard
// so the "realized YTD" number we use as the offset target matches
// what the user already sees on their Pro Wallet card.
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicRealizedYtdUsd(userId: string, totalUsd: number): number {
  // Hash userId into a seed
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  const rng = mulberry32(h >>> 0);
  // Same shape as TaxYearCard: (rng - 0.4) * 0.04 * total. Matches Pro wallet card.
  return (rng() - 0.4) * 0.04 * totalUsd;
}

type Loser = {
  ticker: string;
  name: string;
  qty: number;
  avgCost: number;
  currentPrice: number;
  currency: "ARS" | "USD";
  unrealizedAbs: number; // local currency, negative
  unrealizedPct: number;
  lossUsd: number; // positive number, abs(unrealizedAbs) in USD
};

function templatedReason(it: Loser, taxSavingsUsd: number, realizedYtdUsd: number): string {
  const lossLine = `${it.ticker} cae ${it.unrealizedPct.toFixed(1)}% (US$${it.lossUsd.toFixed(0)} no realizado)`;
  if (realizedYtdUsd > 0) {
    return `${lossLine}. Vendiendo crystalizás la pérdida y ahorrás US$${taxSavingsUsd.toFixed(0)} en impuesto cedular sobre ganancias del año.`;
  }
  return `${lossLine}. Sin ganancias realizadas este año, la pérdida queda como crédito fiscal a futuro.`;
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

    // --- read holdings ---
    const { data: rawHoldings } = await userClient
      .from("holdings")
      .select("ticker, qty, avg_cost, currency")
      .gt("qty", 0);

    if (!rawHoldings || rawHoldings.length === 0) {
      return new Response(JSON.stringify({
        items: [],
        realizedYtdUsd: 0,
        totalHarvestableLossUsd: 0,
        totalTaxSavingsUsd: 0,
        summary: "Sin posiciones todavía. Volvé después de tu primera compra.",
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Compute book total + per-ticker unrealized P&L
    let totalUsd = 0;
    const enriched = rawHoldings.map((h: any) => {
      const meta = ASSETS[h.ticker];
      const qty = Number(h.qty) || 0;
      const avgCost = Number(h.avg_cost) || 0;
      const currentPrice = meta?.price ?? avgCost;
      const currency = (meta?.currency ?? h.currency ?? "USD") as "ARS" | "USD";
      const valueLocal = qty * currentPrice;
      const valueUsd = currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
      const unrealizedAbs = qty * (currentPrice - avgCost);
      const unrealizedUsd = currency === "ARS" ? unrealizedAbs * ARS_TO_USD : unrealizedAbs;
      const unrealizedPct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
      totalUsd += valueUsd;
      return {
        ticker: h.ticker,
        name: meta?.name || h.ticker,
        qty,
        avgCost,
        currentPrice,
        currency,
        unrealizedAbs,
        unrealizedUsd,
        unrealizedPct,
      };
    });

    // Losers only: positions where current price < avg cost
    const losers: Loser[] = enriched
      .filter((e) => e.unrealizedAbs < 0)
      .map((e) => ({
        ticker: e.ticker,
        name: e.name,
        qty: e.qty,
        avgCost: e.avgCost,
        currentPrice: e.currentPrice,
        currency: e.currency,
        unrealizedAbs: e.unrealizedAbs,
        unrealizedPct: e.unrealizedPct,
        lossUsd: Math.abs(e.unrealizedUsd),
      }))
      .sort((a, b) => b.lossUsd - a.lossUsd) // biggest loss first
      .slice(0, 8);

    const realizedYtdUsd = deterministicRealizedYtdUsd(user.id, totalUsd);
    const totalHarvestableLossUsd = losers.reduce((s, it) => s + it.lossUsd, 0);
    // Tax savings = min(harvested loss, realized gains) * tax rate
    const offsetableUsd = Math.min(totalHarvestableLossUsd, Math.max(0, realizedYtdUsd));
    const totalTaxSavingsUsd = offsetableUsd * TAX_RATE;

    // Per-position savings: split offsetable proportionally
    const itemsWithSavings = losers.map((it) => {
      const proportion = totalHarvestableLossUsd > 0 ? it.lossUsd / totalHarvestableLossUsd : 0;
      const taxSavingsUsd = offsetableUsd * proportion * TAX_RATE;
      return { ...it, taxSavingsUsd };
    });

    if (losers.length === 0) {
      return new Response(JSON.stringify({
        items: [],
        realizedYtdUsd: Number(realizedYtdUsd.toFixed(2)),
        totalHarvestableLossUsd: 0,
        totalTaxSavingsUsd: 0,
        summary: "Tus posiciones están todas en verde. Sin pérdidas para cosechar este año fiscal.",
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- LLM path (or templated) ---
    if (!ANTHROPIC_API_KEY) {
      const itemsOut = itemsWithSavings.map((it) => ({
        ticker: it.ticker, name: it.name,
        qty: Number(it.qty.toFixed(4)),
        avgCost: Number(it.avgCost.toFixed(2)),
        currentPrice: Number(it.currentPrice.toFixed(2)),
        currency: it.currency,
        unrealizedAbs: Number(it.unrealizedAbs.toFixed(2)),
        unrealizedPct: Number(it.unrealizedPct.toFixed(2)),
        lossUsd: Number(it.lossUsd.toFixed(2)),
        taxSavingsUsd: Number(it.taxSavingsUsd.toFixed(2)),
        reason: templatedReason(it, it.taxSavingsUsd, realizedYtdUsd),
      }));
      const summaryFallback = realizedYtdUsd > 0
        ? `${losers.length} posición${losers.length > 1 ? "es" : ""} en pérdida. Cosechándolas podés ahorrar hasta US$${totalTaxSavingsUsd.toFixed(0)} en impuesto cedular este año.`
        : `${losers.length} posición${losers.length > 1 ? "es" : ""} en pérdida. Sin ganancias realizadas todavía, las pérdidas se trasladan como crédito fiscal.`;
      return new Response(JSON.stringify({
        items: itemsOut,
        realizedYtdUsd: Number(realizedYtdUsd.toFixed(2)),
        totalHarvestableLossUsd: Number(totalHarvestableLossUsd.toFixed(2)),
        totalTaxSavingsUsd: Number(totalTaxSavingsUsd.toFixed(2)),
        summary: summaryFallback,
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const itemsForPrompt = itemsWithSavings.map((it, i) => ({
      i,
      ticker: it.ticker,
      name: it.name,
      lossUsd: Number(it.lossUsd.toFixed(0)),
      unrealizedPct: Number(it.unrealizedPct.toFixed(1)),
      taxSavingsUsd: Number(it.taxSavingsUsd.toFixed(0)),
    }));

    const userPrompt = [
      `Sos SAMAS, asistente de inversiones para retail argentino. Estás ayudando con cosecha de pérdidas fiscales (tax-loss harvesting) — vender posiciones perdedoras este año fiscal para crystalizar la pérdida y compensar ganancias realizadas, reduciendo el impuesto cedular (15% en Argentina sobre ganancias en USD).`,
      ``,
      `Datos del usuario:`,
      `- realizadoYtdUsd: ${realizedYtdUsd.toFixed(0)} (ganancias realizadas en lo que va del año, USD)`,
      `- totalLossUsd:    ${totalHarvestableLossUsd.toFixed(0)} (pérdida total disponible para cosechar)`,
      `- ahorroFiscalEstimadoUsd: ${totalTaxSavingsUsd.toFixed(0)}`,
      ``,
      `Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{`,
      `  "summary": "1-2 oraciones, máximo 180 caracteres, mencioná concretamente el ahorro estimado",`,
      `  "reasons": ["array con la reason refinada para cada item, en el MISMO orden, máximo 140 caracteres cada una"]`,
      `}`,
      ``,
      `Reglas:`,
      `- Voseo (vos), profesional, sereno. Cero hype.`,
      `- En cada reason mencioná: ticker, % de pérdida, monto en USD, y si hay ahorro fiscal concreto.`,
      `- "reasons" debe tener exactamente ${losers.length} elementos.`,
      `- Si realizadoYtdUsd <= 0: explicá que la pérdida queda como crédito fiscal trasladable.`,
      `- No es asesoramiento financiero — no uses "deberías", usa "podés".`,
      ``,
      `Lista de posiciones perdedoras:`,
      JSON.stringify(itemsForPrompt, null, 2),
    ].join("\n");

    const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL, max_tokens: 800,
        messages: [{ role: "user", content: userPrompt }],
      }),
    }, 12000);

    let summary = "";
    let reasons: string[] = [];
    if (r.ok) {
      const json = await r.json();
      const text = json?.content?.[0]?.text || "";
      const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
      try {
        const parsed = JSON.parse(stripped);
        summary = String(parsed.summary || "").slice(0, 220);
        if (Array.isArray(parsed.reasons)) {
          reasons = parsed.reasons.map((s: unknown) => String(s).slice(0, 200));
        }
      } catch (_e) { /* ignore — fall back to templated */ }
    }

    const itemsOut = itemsWithSavings.map((it, i) => ({
      ticker: it.ticker, name: it.name,
      qty: Number(it.qty.toFixed(4)),
      avgCost: Number(it.avgCost.toFixed(2)),
      currentPrice: Number(it.currentPrice.toFixed(2)),
      currency: it.currency,
      unrealizedAbs: Number(it.unrealizedAbs.toFixed(2)),
      unrealizedPct: Number(it.unrealizedPct.toFixed(2)),
      lossUsd: Number(it.lossUsd.toFixed(2)),
      taxSavingsUsd: Number(it.taxSavingsUsd.toFixed(2)),
      reason: reasons[i] || templatedReason(it, it.taxSavingsUsd, realizedYtdUsd),
    }));

    if (!summary) {
      summary = realizedYtdUsd > 0
        ? `${losers.length} posición${losers.length > 1 ? "es" : ""} en pérdida. Ahorro fiscal estimado: US$${totalTaxSavingsUsd.toFixed(0)} este año.`
        : `${losers.length} posición${losers.length > 1 ? "es" : ""} en pérdida. Sin ganancias realizadas todavía — la pérdida queda como crédito fiscal a futuro.`;
    }

    return new Response(JSON.stringify({
      items: itemsOut,
      realizedYtdUsd: Number(realizedYtdUsd.toFixed(2)),
      totalHarvestableLossUsd: Number(totalHarvestableLossUsd.toFixed(2)),
      totalTaxSavingsUsd: Number(totalTaxSavingsUsd.toFixed(2)),
      summary,
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[tax-loss-harvest] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
