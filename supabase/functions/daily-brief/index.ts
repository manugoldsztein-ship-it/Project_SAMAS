// ============================================================
// daily-brief — short "good morning" summary of the user's book
// ============================================================
// Auto-runs from the Wallet's DailyBriefCard on every app open
// (cached client-side for ~12 hours so we don't re-call on rapid
// re-mounts). Reads:
//   - holdings (current state)
//   - last 5 trade transactions
//   - the broker's day-change % per held ticker (from ASSETS.changePct)
//
// Computes:
//   - weighted gain% across the book
//   - top mover today (held ticker with biggest abs(changePct))
//   - any held ticker that recently traded (last 5 days)
//
// Returns a 2-3 sentence brief in Spanish, voseo. Cohen-pitch
// material: this is the FIRST thing the user sees every morning.
//
// Request body:  {}  (no params — derives everything from JWT)
// Response:
//   {
//     brief:        string,        // 2-3 sentences
//     headline:     string,        // 1 line, max 80 chars
//     totalUsd:     number,
//     gainPct:      number,        // value-weighted
//     topMover:     { ticker, changePct } | null,
//     generatedAt:  string,
//   }
//
// FALLBACK
//   No API key → templated brief built from real numbers. Same shape.
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy daily-brief
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

const ARS_TO_USD = 1 / 1245;

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

// Templated brief — picks one of a few sentence skeletons rotated
// by gain direction so re-runs don't all read identically.
function templatedBrief(opts: {
  totalUsd: number; gainPct: number;
  topMover: { ticker: string; changePct: number } | null;
  holdingsCount: number;
}): { headline: string; brief: string } {
  const { totalUsd, gainPct, topMover, holdingsCount } = opts;
  const totalLabel = `US$${Math.round(totalUsd).toLocaleString("en-US")}`;
  const sign = gainPct >= 0 ? "+" : "";
  const dir = gainPct >= 0 ? "verde" : "rojo";

  if (holdingsCount === 0) {
    return {
      headline: "Sin posiciones todavía.",
      brief: "Tu cartera está vacía. Empezá comprando algo desde el tab Mercado y volvé mañana para tener tu primer brief.",
    };
  }

  const headline = topMover
    ? `${totalLabel}, ${dir} ${sign}${gainPct.toFixed(1)}%. ${topMover.changePct >= 0 ? "Lidera" : "Cae"} $${topMover.ticker}.`
    : `${totalLabel}, ${dir} ${sign}${gainPct.toFixed(1)}%.`;

  const lines: string[] = [];
  // Sentence 1 — global state.
  lines.push(`Buen día. Tu cartera de ${holdingsCount} posición${holdingsCount > 1 ? "es" : ""} está en ${totalLabel}, retorno ponderado ${sign}${gainPct.toFixed(1)}%.`);
  // Sentence 2 — top mover.
  if (topMover) {
    const meta = ASSETS[topMover.ticker];
    const tickerName = meta?.name || topMover.ticker;
    if (topMover.changePct >= 0) {
      lines.push(`$${topMover.ticker} (${tickerName}) lidera con ${topMover.changePct >= 0 ? "+" : ""}${topMover.changePct.toFixed(1)}% hoy — se nota en tu book.`);
    } else {
      lines.push(`$${topMover.ticker} (${tickerName}) cede ${Math.abs(topMover.changePct).toFixed(1)}% hoy — el peso en tu cartera lo siente.`);
    }
  }
  // Sentence 3 — call to action / focus.
  if (Math.abs(gainPct) < 1) {
    lines.push("Mercado tranquilo. Buen momento para revisar tesis y rebalancear si lo necesitás.");
  } else if (gainPct >= 3) {
    lines.push("Día fuerte. Considerá si querés tomar ganancias parciales en la posición más grande.");
  } else if (gainPct <= -3) {
    lines.push("Día complicado. Revisá si la tesis de tus posiciones sigue intacta antes de mover algo.");
  } else {
    lines.push("Día normal. Sin sobresaltos en tu cartera.");
  }

  return { headline, brief: lines.join(" ") };
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
      .from("holdings").select("ticker, qty, avg_cost").gt("qty", 0);
    const holdings = (rawHoldings || []).map((h) => {
      const meta = ASSETS[h.ticker] || { name: h.ticker, category: "OTROS", currency: "USD", price: 0, changePct: 0 };
      const qty = Number(h.qty) || 0;
      const valueLocal = qty * meta.price;
      const valueUsd = meta.currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
      return {
        ticker: h.ticker, name: meta.name, category: meta.category,
        qty, valueUsd, changePct: meta.changePct,
        gainPct: Number(h.avg_cost) > 0 ? ((meta.price - Number(h.avg_cost)) / Number(h.avg_cost)) * 100 : 0,
      };
    });

    // Compute totals + top mover (held ticker with biggest abs day move).
    const totalUsd = holdings.reduce((acc, h) => acc + h.valueUsd, 0);
    const weightedGain = totalUsd > 0
      ? holdings.reduce((acc, h) => acc + h.valueUsd * h.gainPct, 0) / totalUsd
      : 0;
    const topMover = holdings.length > 0
      ? [...holdings].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0]
      : null;

    // --- LLM path (or templated) ---
    if (!ANTHROPIC_API_KEY) {
      const tmpl = templatedBrief({
        totalUsd, gainPct: weightedGain,
        topMover: topMover ? { ticker: topMover.ticker, changePct: topMover.changePct } : null,
        holdingsCount: holdings.length,
      });
      return new Response(JSON.stringify({
        ...tmpl,
        totalUsd: Math.round(totalUsd),
        gainPct: Number(weightedGain.toFixed(2)),
        topMover: topMover ? { ticker: topMover.ticker, changePct: Number(topMover.changePct.toFixed(2)) } : null,
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // LLM brief.
    const portfolioJson = holdings.map((h) => ({
      ticker: h.ticker,
      name: h.name,
      qty: h.qty,
      pctOfBook: totalUsd > 0 ? Number(((h.valueUsd / totalUsd) * 100).toFixed(1)) : 0,
      gainPct: Number(h.gainPct.toFixed(1)),
      dayChange: Number(h.changePct.toFixed(1)),
    }));

    const userPrompt = [
      `Sos SAMAS, asistente de inversiones para retail argentino. Escribís el "brief diario" que el usuario ve cada vez que abre la app.`,
      ``,
      `Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{`,
      `  "headline": "1 línea, máximo 80 caracteres, en español",`,
      `  "brief":    "2-3 oraciones, máximo 280 caracteres total, en español"`,
      `}`,
      ``,
      `Reglas:`,
      `- Voseo (vos), tono "buen día" — directo, profesional, cercano.`,
      `- Cero hype, cero emojis, cero hashtags.`,
      `- Cubrí 3 cosas en el brief: estado de la cartera (verde/rojo, %), top mover del día con su impacto, y un "qué mirar hoy".`,
      `- Si el "qué mirar hoy" se te ocurre algo (earnings, evento macro), mencionalo. Si no, una línea de disciplina/tesis.`,
      `- No des recomendación de comprar/vender directa.`,
      ``,
      `Estado actual:`,
      `- Total cartera: US$${Math.round(totalUsd).toLocaleString("en-US")}`,
      `- Retorno ponderado: ${weightedGain >= 0 ? "+" : ""}${weightedGain.toFixed(1)}%`,
      `- Top mover: ${topMover ? `$${topMover.ticker} (${topMover.changePct >= 0 ? "+" : ""}${topMover.changePct.toFixed(1)}% hoy)` : "ninguno notable"}`,
      ``,
      `Cartera completa:`,
      JSON.stringify(portfolioJson, null, 2),
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
        max_tokens: 500,
        messages: [{ role: "user", content: userPrompt }],
      }),
    }, 12000);
    if (!r.ok) {
      const tmpl = templatedBrief({
        totalUsd, gainPct: weightedGain,
        topMover: topMover ? { ticker: topMover.ticker, changePct: topMover.changePct } : null,
        holdingsCount: holdings.length,
      });
      return new Response(JSON.stringify({
        ...tmpl,
        totalUsd: Math.round(totalUsd),
        gainPct: Number(weightedGain.toFixed(2)),
        topMover: topMover ? { ticker: topMover.ticker, changePct: Number(topMover.changePct.toFixed(2)) } : null,
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const json = await r.json();
    const text = json?.content?.[0]?.text || "";
    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: { headline?: string; brief?: string };
    try { parsed = JSON.parse(stripped); } catch {
      const tmpl = templatedBrief({
        totalUsd, gainPct: weightedGain,
        topMover: topMover ? { ticker: topMover.ticker, changePct: topMover.changePct } : null,
        holdingsCount: holdings.length,
      });
      parsed = tmpl;
    }
    return new Response(JSON.stringify({
      headline: String(parsed.headline || "").slice(0, 200),
      brief:    String(parsed.brief    || "").slice(0, 500),
      totalUsd: Math.round(totalUsd),
      gainPct:  Number(weightedGain.toFixed(2)),
      topMover: topMover ? { ticker: topMover.ticker, changePct: Number(topMover.changePct.toFixed(2)) } : null,
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[daily-brief] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
