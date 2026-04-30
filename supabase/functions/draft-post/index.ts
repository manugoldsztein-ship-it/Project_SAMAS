// ============================================================
// draft-post — AI-drafted post from caller's recent activity
// ============================================================
// Reads the caller's holdings + last few trade transactions via
// JWT-scoped RLS, asks Claude Haiku to draft a SHORT social post
// (max ~220 chars to leave the user room to edit before posting),
// returns:
//   { draft: string, ticker?: string }
//
// FALLBACK
//   Templated draft when ANTHROPIC_API_KEY isn't set — picks the
//   most recent trade or the largest holding and fills a sentence
//   template with real numbers. Same response shape as the LLM.
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy draft-post
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

// Asset metadata mirror (kept in sync with broker.js / analyze-* by
// hand). Used to enrich holdings + transactions with category +
// human name when building the prompt / template.
const ASSETS: Record<string, { name: string; category: string; currency: string; price: number; changePct: number; }> = {
  AAPL: { name: "Apple",            category: "CEDEAR", currency: "USD", price: 215.40, changePct:  1.84 },
  NVDA: { name: "NVIDIA",           category: "CEDEAR", currency: "USD", price: 892.15, changePct:  4.21 },
  TSLA: { name: "Tesla",            category: "CEDEAR", currency: "USD", price: 248.30, changePct: -1.20 },
  MSFT: { name: "Microsoft",        category: "CEDEAR", currency: "USD", price: 432.10, changePct:  0.74 },
  GOOGL:{ name: "Alphabet",         category: "CEDEAR", currency: "USD", price: 184.20, changePct:  1.12 },
  GGAL: { name: "Grupo Galicia",    category: "ACCION", currency: "ARS", price: 4250,   changePct: -2.10 },
  YPF:  { name: "YPF",              category: "ACCION", currency: "ARS", price: 38500,  changePct:  3.45 },
  PAMP: { name: "Pampa Energía",    category: "ACCION", currency: "ARS", price: 5820,   changePct:  0.92 },
  BTC:  { name: "Bitcoin",          category: "CRYPTO", currency: "USD", price: 92450,  changePct:  0.92 },
  ETH:  { name: "Ethereum",         category: "CRYPTO", currency: "USD", price: 2845,   changePct:  2.18 },
  AL30: { name: "Bonar 2030",       category: "BONO",   currency: "USD", price: 56.70,  changePct:  0.40 },
  SPY:  { name: "S&P 500 ETF",      category: "ETF",    currency: "USD", price: 512.40, changePct:  0.62 },
  QQQ:  { name: "Nasdaq-100 ETF",   category: "ETF",    currency: "USD", price: 431.20, changePct:  0.88 },
  IWM:  { name: "Russell 2000 ETF", category: "ETF",    currency: "USD", price: 218.65, changePct: -0.34 },
  EWZ:  { name: "Brasil ETF",       category: "ETF",    currency: "USD", price:  29.40, changePct:  1.05 },
  GLD:  { name: "Oro (SPDR Gold)",  category: "COMMOD", currency: "USD", price: 228.60, changePct:  1.24 },
  SLV:  { name: "Plata (iShares)",  category: "COMMOD", currency: "USD", price:  27.85, changePct: -0.51 },
  USO:  { name: "Petróleo (USO)",   category: "COMMOD", currency: "USD", price:  81.30, changePct: -0.72 },
};

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

// Templated draft when no API key available. Picks the most recent
// trade (preferred) or the largest holding (fallback) and fills a
// rotation of casual one-liners. Always under 220 chars.
function templatedDraft(opts: {
  recentTrade?: { kind: string; ticker?: string; reference?: string; amount?: number; currency?: string };
  topHolding?: { ticker: string; name: string; category: string; pctOfBook: number; gainPct: number };
}) {
  const { recentTrade, topHolding } = opts;

  if (recentTrade?.ticker) {
    const meta = ASSETS[recentTrade.ticker];
    const tickerName = meta?.name || recentTrade.ticker;
    const isBuy = recentTrade.kind === "trade_buy";
    const templates = isBuy
      ? [
          `Sumé $${recentTrade.ticker} a la cartera. Tesis: ${tickerName} sigue siendo una de las posiciones que mejor entiendo del mercado.`,
          `Más $${recentTrade.ticker}. Cuando veo entrega de fundamentals, doblo posición. ¿Qué opinás?`,
          `Compré $${recentTrade.ticker} hoy. ${meta?.category === "CEDEAR" ? "Dolarización vía CEDEAR sigue siendo el camino." : "Apuesta de mediano plazo."}`,
        ]
      : [
          `Vendí $${recentTrade.ticker}. Rotación de posiciones para liberar capital.`,
          `Cerré $${recentTrade.ticker}. Voy a esperar mejor punto de entrada.`,
          `Tomé ganancias en $${recentTrade.ticker} hoy. Disciplina sobre convicción a veces.`,
        ];
    const draft = templates[Math.floor(Math.random() * templates.length)];
    return { draft: draft.slice(0, 240), ticker: recentTrade.ticker };
  }

  if (topHolding) {
    const meta = ASSETS[topHolding.ticker];
    const tickerName = meta?.name || topHolding.name;
    const sign = topHolding.gainPct >= 0 ? "+" : "";
    const templates = [
      `$${topHolding.ticker} sigue siendo mi posición más grande de la cartera (${topHolding.pctOfBook.toFixed(0)}%). PNL ${sign}${topHolding.gainPct.toFixed(1)}%.`,
      `Mirando ${tickerName} hoy. ${topHolding.gainPct >= 0 ? "Verde sostenido" : "Rojo pero la tesis sigue intacta"}.`,
      `${tickerName} representa el ${topHolding.pctOfBook.toFixed(0)}% de mi cartera. ¿Diversifico más o doblo?`,
    ];
    const draft = templates[Math.floor(Math.random() * templates.length)];
    return { draft: draft.slice(0, 240), ticker: topHolding.ticker };
  }

  return {
    draft: "Mirando el mercado hoy. ¿Qué están operando?",
    ticker: undefined as string | undefined,
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

    // --- read holdings + last 3 trade transactions (RLS-scoped) ---
    const [holdingsRes, txRes] = await Promise.all([
      userClient.from("holdings").select("ticker, qty, avg_cost, currency"),
      userClient.from("transactions")
        .select("kind, amount, currency, reference, memo, created_at")
        .in("kind", ["trade_buy", "trade_sell"])
        .order("created_at", { ascending: false })
        .limit(3),
    ]);
    const holdings = (holdingsRes.data || []).filter((h) => Number(h.qty) > 0);
    const trades = txRes.data || [];

    // --- enrich + rank ---
    const ARS_TO_USD = 1 / 1245;
    type EnrichedHold = { ticker: string; name: string; category: string; valueUsd: number; pctOfBook: number; gainPct: number };
    const enrichedHoldings: EnrichedHold[] = holdings.map((h) => {
      const meta = ASSETS[h.ticker] || { name: h.ticker, category: "OTROS", currency: h.currency || "USD", price: Number(h.avg_cost) || 0, changePct: 0 };
      const qty = Number(h.qty) || 0;
      const avgCost = Number(h.avg_cost) || 0;
      const valueLocal = qty * meta.price;
      const valueUsd = meta.currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
      const gainPct = avgCost > 0 ? ((meta.price - avgCost) / avgCost) * 100 : 0;
      return { ticker: h.ticker, name: meta.name, category: meta.category, valueUsd, pctOfBook: 0, gainPct };
    });
    const totalUsd = enrichedHoldings.reduce((acc, r) => acc + r.valueUsd, 0);
    enrichedHoldings.forEach((r) => { r.pctOfBook = totalUsd > 0 ? (r.valueUsd / totalUsd) * 100 : 0; });
    const ranked = [...enrichedHoldings].sort((a, b) => b.valueUsd - a.valueUsd);
    const topHolding = ranked[0];
    // The most recent trade — pull ticker from `reference` since that's
    // where broker.js stores it (kind='trade_buy' → reference='AAPL').
    const recentTrade = trades[0]
      ? { kind: trades[0].kind, ticker: trades[0].reference, reference: trades[0].reference, amount: Number(trades[0].amount), currency: trades[0].currency }
      : undefined;

    // --- LLM path (or templated) ---
    if (!ANTHROPIC_API_KEY) {
      console.log("[draft-post] no API key — templated draft");
      return new Response(JSON.stringify(templatedDraft({ recentTrade, topHolding })), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const portfolioJson = ranked.slice(0, 5).map((r) => ({
      ticker: r.ticker, name: r.name, category: r.category,
      pctOfBook: Number(r.pctOfBook.toFixed(1)),
      gainPct: Number(r.gainPct.toFixed(1)),
    }));
    const tradesJson = trades.map((t) => ({
      side: t.kind === "trade_buy" ? "buy" : "sell",
      ticker: t.reference,
      memo: t.memo,
    }));

    const userPrompt = [
      `Sos un comentarista de mercado que ayuda a un inversor argentino retail a redactar un post corto para una red social financiera (estilo Twitter para finanzas).`,
      ``,
      `Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{ "draft": "el texto del post, máximo 220 caracteres", "ticker": "el ticker principal mencionado o null" }`,
      ``,
      `Reglas de tono:`,
      `- Casual, voseo (vos), profesional pero cercano.`,
      `- Cero hype, cero emojis, cero hashtags.`,
      `- Mencioná uno (1) ticker en formato $TICKER si aplica.`,
      `- Que se note que el autor tiene la posición o la está mirando — primera persona.`,
      `- No des recomendación de comprar/vender directa; sí podés expresar tesis o duda.`,
      `- Máximo 220 caracteres.`,
      ``,
      `Cartera del usuario (top 5 posiciones):`,
      JSON.stringify(portfolioJson, null, 2),
      ``,
      `Operaciones recientes:`,
      tradesJson.length > 0 ? JSON.stringify(tradesJson, null, 2) : "(ninguna reciente)",
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
        max_tokens: 400,
        messages: [{ role: "user", content: userPrompt }],
      }),
    }, 12000);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn(`[draft-post] anthropic ${r.status}:`, txt.slice(0, 300));
      // Soft-fail to templated.
      return new Response(JSON.stringify(templatedDraft({ recentTrade, topHolding })), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const json = await r.json();
    const text = json?.content?.[0]?.text || "";
    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: { draft?: string; ticker?: string };
    try {
      parsed = JSON.parse(stripped);
    } catch {
      console.warn("[draft-post] non-JSON response:", text.slice(0, 200));
      return new Response(JSON.stringify(templatedDraft({ recentTrade, topHolding })), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const draft = String(parsed.draft || "").slice(0, 280);
    if (!draft) {
      // Empty draft → fall back. Better than returning ""
      return new Response(JSON.stringify(templatedDraft({ recentTrade, topHolding })), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      draft,
      ticker: parsed.ticker ? String(parsed.ticker).slice(0, 10) : undefined,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[draft-post] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
