// ============================================================
// quarterly-review — AI narrative review of the last 90 days
// ============================================================
// Reads holdings (current snapshot) + orders (executed in the
// period) and produces a Claude-written narrative review of the
// user's last quarter: returns, top winners, top losers, biggest
// activity, sector tilt. Designed to feel like the kind of report
// a private banker would email a client at quarter-end.
//
// Period: trailing 90 days from "now" (not calendar quarters —
// keeps the surface useful any day of the year).
//
// Stats computed server-side (deterministic):
//   - quarterReturnPct: value-weighted gain across current holdings
//   - winners[]:        top 3 holdings by gain%
//   - losers[]:         top 3 holdings by loss%
//   - tradesCount:      orders executed in the period
//   - busiest:          ticker with the most orders
//   - newPositions[]:   tickers first bought in the period
//   - closedPositions[]: tickers fully sold in the period (qty hit 0)
//   - sectorMix:        category breakdown
//
// Claude writes a 3-4 paragraph narrative in markdown using these
// numbers. Numbers are sent as authority; the prose interprets them.
// Templated fallback when no API key.
//
// Request body: {}
// Response:
//   {
//     period: { from, to, days: 90 },
//     stats:  { ... see above ... },
//     narrative: string,   // markdown, 3-4 paragraphs
//     headline:  string,   // 1 sentence, used as card subtitle
//     generatedAt: string,
//   }
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy quarterly-review \
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
const PERIOD_DAYS = 90;

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
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

    const now = new Date();
    const from = new Date(now.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000);
    const fromIso = from.toISOString();
    const toIso = now.toISOString();

    // --- read holdings + orders in parallel ---
    const [holdingsRes, ordersRes] = await Promise.all([
      userClient.from("holdings").select("ticker, qty, avg_cost, currency").gt("qty", 0),
      userClient.from("orders")
        .select("ticker, side, qty, price, currency, executed_at, created_at, status")
        .eq("status", "executed")
        .gte("created_at", fromIso)
        .order("created_at", { ascending: true }),
    ]);

    const holdings = holdingsRes.data || [];
    const orders = ordersRes.data || [];

    // ----- compute per-ticker P&L on current holdings -----
    let totalUsd = 0;
    let totalCostUsd = 0;
    const perTicker = holdings.map((h: any) => {
      const meta = ASSETS[h.ticker];
      const qty = Number(h.qty) || 0;
      const avgCost = Number(h.avg_cost) || 0;
      const currentPrice = meta?.price ?? avgCost;
      const currency = (meta?.currency ?? h.currency ?? "USD") as "ARS" | "USD";
      const valueLocal = qty * currentPrice;
      const costLocal = qty * avgCost;
      const valueUsd = currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
      const costUsd = currency === "ARS" ? costLocal * ARS_TO_USD : costLocal;
      const gainPct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
      totalUsd += valueUsd;
      totalCostUsd += costUsd;
      return {
        ticker: h.ticker,
        name: meta?.name || h.ticker,
        category: meta?.category || "OTHER",
        valueUsd,
        gainPct,
        gainUsd: valueUsd - costUsd,
      };
    });

    if (holdings.length === 0) {
      return new Response(JSON.stringify({
        period: { from: fromIso, to: toIso, days: PERIOD_DAYS },
        stats: null,
        narrative: "Sin posiciones en el trimestre. Después de tu primera compra te puedo armar un review en cualquier momento.",
        headline: "Sin posiciones para revisar.",
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Quarter return = (current value - cost) / cost
    const quarterReturnPct = totalCostUsd > 0
      ? ((totalUsd - totalCostUsd) / totalCostUsd) * 100
      : 0;

    // ----- winners / losers -----
    const sortedByGain = [...perTicker].sort((a, b) => b.gainPct - a.gainPct);
    const winners = sortedByGain.filter((t) => t.gainPct > 0).slice(0, 3);
    const losers = sortedByGain.filter((t) => t.gainPct < 0).slice(-3).reverse();

    // ----- order-derived stats -----
    const tradesCount = orders.length;
    const tickerOrderCount: Record<string, number> = {};
    for (const o of orders) {
      tickerOrderCount[o.ticker] = (tickerOrderCount[o.ticker] || 0) + 1;
    }
    const busiestEntry = Object.entries(tickerOrderCount).sort((a, b) => b[1] - a[1])[0];
    const busiest = busiestEntry ? { ticker: busiestEntry[0], n: busiestEntry[1] } : null;

    // New positions = tickers first bought in window AND not held before
    // For prototype, approximate: tickers in orders with side=buy that
    // also currently appear in holdings AND have no buy orders before
    // the window. We don't have full pre-window history so we just
    // flag tickers held now that have buys in the window.
    const newPositionTickers: string[] = [];
    const closedPositionTickers: string[] = [];
    const heldTickerSet = new Set(holdings.map((h: any) => h.ticker));
    const buyTickerSet = new Set<string>();
    const sellTickerSet = new Set<string>();
    for (const o of orders) {
      if (o.side === "buy") buyTickerSet.add(o.ticker);
      else sellTickerSet.add(o.ticker);
    }
    for (const t of buyTickerSet) {
      if (heldTickerSet.has(t)) newPositionTickers.push(t);
    }
    for (const t of sellTickerSet) {
      if (!heldTickerSet.has(t)) closedPositionTickers.push(t);
    }

    // ----- sector mix -----
    const sectorUsd: Record<string, number> = {};
    for (const t of perTicker) {
      sectorUsd[t.category] = (sectorUsd[t.category] || 0) + t.valueUsd;
    }
    const sectorMix = Object.entries(sectorUsd).map(([cat, val]) => ({
      category: cat,
      pctOfBook: totalUsd > 0 ? (val / totalUsd) * 100 : 0,
    })).sort((a, b) => b.pctOfBook - a.pctOfBook);

    const stats = {
      totalUsd: Number(totalUsd.toFixed(2)),
      totalCostUsd: Number(totalCostUsd.toFixed(2)),
      quarterReturnPct: Number(quarterReturnPct.toFixed(2)),
      winners: winners.map((w) => ({
        ticker: w.ticker, name: w.name,
        gainPct: Number(w.gainPct.toFixed(2)),
        gainUsd: Number(w.gainUsd.toFixed(2)),
      })),
      losers: losers.map((l) => ({
        ticker: l.ticker, name: l.name,
        gainPct: Number(l.gainPct.toFixed(2)),
        gainUsd: Number(l.gainUsd.toFixed(2)),
      })),
      tradesCount,
      busiest,
      newPositionTickers,
      closedPositionTickers,
      sectorMix: sectorMix.map((s) => ({
        category: s.category,
        pctOfBook: Number(s.pctOfBook.toFixed(1)),
      })),
    };

    // ----- templated narrative (fallback) -----
    function templatedNarrative(): { narrative: string; headline: string } {
      const ret = stats.quarterReturnPct;
      const lead = ret >= 0
        ? `Buen trimestre. Tu cartera subió ${fmtPct(ret)} contra costo en los últimos 90 días.`
        : `Trimestre flojo. Tu cartera bajó ${fmtPct(ret)} contra costo en los últimos 90 días.`;
      const winnerLine = stats.winners.length > 0
        ? `Lo que más empujó: ${stats.winners.map((w) => `${w.ticker} (${fmtPct(w.gainPct)})`).join(", ")}.`
        : "";
      const loserLine = stats.losers.length > 0
        ? `Lo que más restó: ${stats.losers.map((l) => `${l.ticker} (${fmtPct(l.gainPct)})`).join(", ")}.`
        : "Ninguna posición cerró el trimestre en rojo.";
      const activityLine = tradesCount === 0
        ? "Sin actividad operativa en el período — modo 'comprar y mantener'."
        : `${tradesCount} operación${tradesCount > 1 ? "es" : ""} ejecutada${tradesCount > 1 ? "s" : ""}${busiest ? `, ${busiest.ticker} fue la más operada (${busiest.n} veces)` : ""}.`;
      const sectorLine = stats.sectorMix.length > 0
        ? `Tu cartera quedó concentrada en ${stats.sectorMix[0].category} (${stats.sectorMix[0].pctOfBook.toFixed(0)}%${stats.sectorMix.length > 1 ? `, seguido por ${stats.sectorMix[1].category} ${stats.sectorMix[1].pctOfBook.toFixed(0)}%` : ""}).`
        : "";
      const narrative = `## Tu trimestre en una mirada\n\n${lead}\n\n## Lo que se movió\n\n${winnerLine} ${loserLine}\n\n## Actividad\n\n${activityLine}\n\n## Hacia adelante\n\n${sectorLine} Mantené el ojo en la concentración y revisá las posiciones perdedoras antes del próximo cierre.`;
      const headline = ret >= 0
        ? `+${ret.toFixed(1)}% el trimestre. ${stats.winners[0]?.ticker || "—"} fue tu mejor jugada.`
        : `${ret.toFixed(1)}% el trimestre. ${stats.losers[0]?.ticker || "—"} fue el principal lastre.`;
      return { narrative, headline };
    }

    if (!ANTHROPIC_API_KEY) {
      const { narrative, headline } = templatedNarrative();
      return new Response(JSON.stringify({
        period: { from: fromIso, to: toIso, days: PERIOD_DAYS },
        stats,
        narrative,
        headline,
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ----- LLM narrative -----
    const userPrompt = [
      `Sos SAMAS, asistente de inversiones para retail argentino. Generá un review trimestral en castellano para el usuario, con tono de banca privada — sereno, profesional, voseo (vos), sin hype.`,
      ``,
      `Devolvé un JSON con esta forma EXACTA, sin markdown alrededor del JSON:`,
      `{`,
      `  "headline": "1 oración ≤120 caracteres que resume el trimestre",`,
      `  "narrative": "markdown de 3-4 párrafos cortos con secciones ## h2"`,
      `}`,
      ``,
      `El "narrative" debe tener estas 4 secciones, en este orden, cada una con ## como heading:`,
      `1. ## Tu trimestre en una mirada — retorno %, tono general (positivo/neutro/desafiante)`,
      `2. ## Lo que se movió — winners y losers concretos con %`,
      `3. ## Actividad — # de operaciones, ticker más operado, posiciones nuevas/cerradas`,
      `4. ## Hacia adelante — concentración sectorial, qué mirar próximamente`,
      ``,
      `Reglas de redacción:`,
      `- Usá los números EXACTOS que te paso. No inventes.`,
      `- Mencioná tickers con $TICKER format.`,
      `- 3-4 oraciones por sección máximo. Cero relleno.`,
      `- No uses "deberías"; usá "podés" o frases descriptivas.`,
      `- Cero disclaimer de "no es asesoramiento" — el frontend lo agrega.`,
      ``,
      `Stats del trimestre:`,
      JSON.stringify(stats, null, 2),
    ].join("\n");

    let narrative = "";
    let headline = "";
    try {
      const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL, max_tokens: 1200,
          messages: [{ role: "user", content: userPrompt }],
        }),
      }, 15000);
      if (r.ok) {
        const json = await r.json();
        const text = json?.content?.[0]?.text || "";
        const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
        const parsed = JSON.parse(stripped);
        narrative = String(parsed.narrative || "").slice(0, 3000);
        headline = String(parsed.headline || "").slice(0, 200);
      }
    } catch (_e) { /* fall through to templated */ }

    if (!narrative || !headline) {
      const t = templatedNarrative();
      narrative = narrative || t.narrative;
      headline = headline || t.headline;
    }

    return new Response(JSON.stringify({
      period: { from: fromIso, to: toIso, days: PERIOD_DAYS },
      stats,
      narrative,
      headline,
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[quarterly-review] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
