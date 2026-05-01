// ============================================================
// compare-benchmark — "am I beating the market?"
// ============================================================
// Computes the user's value-weighted portfolio gain% (vs avg cost)
// and stacks it next to three benchmarks: Merval, S&P 500, Bitcoin
// — for the same period (synthetic period = "since you bought" /
// inception of the cartera).
//
// Real production version would compute time-aligned returns over
// a configurable window (1m / 3m / YTD / 1y). For the prototype +
// Cohen demo we use deterministic synthetic benchmark values so
// the numbers are stable across sessions and the AI verdict has a
// reliable comparison.
//
// Request body: {}
// Response:
//   {
//     portfolio: { gainPct: number, totalUsd: number },
//     benchmarks: [{ id, name, gainPct, beat: boolean }],
//     verdict: string,         // 1-2 sentence AI take
//     generatedAt: string,
//   }
//
// FALLBACK: deterministic verdict sentence templates that pick a
// rotation based on how many benchmarks the portfolio beats.
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy compare-benchmark
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

// Deterministic synthetic benchmark returns (% over the same period
// as the user's cartera since-inception). Hand-picked to be plausible
// for "the last 6 months" of a 2026 demo. Update annually.
const BENCHMARKS = [
  { id: "merval", name: "Merval (acciones AR)", gainPct:  18.5 },
  { id: "spx",    name: "S&P 500",                gainPct:  11.2 },
  { id: "btc",    name: "Bitcoin",                gainPct:  24.7 },
];

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

function templatedVerdict(gainPct: number, beats: number[]): string {
  const beatCount = beats.filter(Boolean).length;
  const sign = gainPct >= 0 ? "+" : "";
  if (beatCount === 3) {
    return `Cartera ${sign}${gainPct.toFixed(1)}% le gana al Merval, S&P y Bitcoin en el período. Buen mes para tu disciplina.`;
  }
  if (beatCount === 2) {
    return `Cartera ${sign}${gainPct.toFixed(1)}% supera a 2 de 3 benchmarks. Mantenete enfocado en la tesis.`;
  }
  if (beatCount === 1) {
    return `Cartera ${sign}${gainPct.toFixed(1)}% le gana a 1 de 3 benchmarks. Revisá si tu mix está alineado con tu objetivo.`;
  }
  if (gainPct >= 0) {
    return `Cartera ${sign}${gainPct.toFixed(1)}% queda atrás de los 3 benchmarks. Sigue en verde, pero el mercado pega más fuerte.`;
  }
  return `Cartera ${gainPct.toFixed(1)}% en rojo y los 3 benchmarks en verde. Buen momento para revisar tesis y rebalanceo.`;
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

    // --- read holdings + compute portfolio gain ---
    const { data: rawHoldings } = await userClient
      .from("holdings").select("ticker, qty, avg_cost").gt("qty", 0);
    const holdings = (rawHoldings || []).map((h) => {
      const meta = ASSETS[h.ticker] || { name: h.ticker, category: "OTROS", currency: "USD", price: 0 };
      const qty = Number(h.qty) || 0;
      const avgCost = Number(h.avg_cost) || 0;
      const valueLocal = qty * meta.price;
      const valueUsd = meta.currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
      const gainPct = avgCost > 0 ? ((meta.price - avgCost) / avgCost) * 100 : 0;
      return { ticker: h.ticker, valueUsd, gainPct };
    });

    if (holdings.length === 0) {
      return new Response(JSON.stringify({
        portfolio: { gainPct: 0, totalUsd: 0 },
        benchmarks: BENCHMARKS.map((b) => ({ ...b, beat: false })),
        verdict: "Sin posiciones para comparar todavía. Empezá comprando algo desde Mercado.",
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const totalUsd = holdings.reduce((acc, h) => acc + h.valueUsd, 0);
    const portfolioGain = totalUsd > 0
      ? holdings.reduce((acc, h) => acc + h.valueUsd * h.gainPct, 0) / totalUsd
      : 0;
    const benchResults = BENCHMARKS.map((b) => ({
      ...b, beat: portfolioGain > b.gainPct,
    }));
    const beatsArr = benchResults.map((b) => b.beat);

    // --- LLM path (or templated) ---
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({
        portfolio:  { gainPct: Number(portfolioGain.toFixed(2)), totalUsd: Math.round(totalUsd) },
        benchmarks: benchResults.map((b) => ({ ...b, gainPct: Number(b.gainPct.toFixed(2)) })),
        verdict:    templatedVerdict(portfolioGain, beatsArr),
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userPrompt = [
      `Sos SAMAS, asistente de inversiones para retail argentino. Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{`,
      `  "verdict": "1-2 oraciones, máximo 240 caracteres, en español, voseo"`,
      `}`,
      ``,
      `Reglas:`,
      `- Voseo (vos), profesional y cercano. Cero hype, cero emojis.`,
      `- Mencioná concretamente cuántos benchmarks supera el usuario y qué significa.`,
      `- Cero recomendación legal/fiscal directa.`,
      `- Si supera todos: tono de "buen trabajo, mantené disciplina".`,
      `- Si supera ninguno: tono de "el mercado pega fuerte, revisá la tesis sin pánico".`,
      ``,
      `Datos:`,
      `Portfolio: ${portfolioGain >= 0 ? "+" : ""}${portfolioGain.toFixed(2)}% (US$${Math.round(totalUsd).toLocaleString("en-US")})`,
      `Benchmarks: ${benchResults.map((b) => `${b.name} ${b.gainPct >= 0 ? "+" : ""}${b.gainPct.toFixed(1)}%${b.beat ? " (✓ supera)" : " (× queda atrás)"}`).join(", ")}`,
    ].join("\n");

    const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL, max_tokens: 300,
        messages: [{ role: "user", content: userPrompt }],
      }),
    }, 12000);
    if (!r.ok) {
      return new Response(JSON.stringify({
        portfolio:  { gainPct: Number(portfolioGain.toFixed(2)), totalUsd: Math.round(totalUsd) },
        benchmarks: benchResults.map((b) => ({ ...b, gainPct: Number(b.gainPct.toFixed(2)) })),
        verdict:    templatedVerdict(portfolioGain, beatsArr),
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const json = await r.json();
    const text = json?.content?.[0]?.text || "";
    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: { verdict?: string };
    try { parsed = JSON.parse(stripped); } catch {
      parsed = { verdict: templatedVerdict(portfolioGain, beatsArr) };
    }

    return new Response(JSON.stringify({
      portfolio:  { gainPct: Number(portfolioGain.toFixed(2)), totalUsd: Math.round(totalUsd) },
      benchmarks: benchResults.map((b) => ({ ...b, gainPct: Number(b.gainPct.toFixed(2)) })),
      verdict:    String(parsed.verdict || templatedVerdict(portfolioGain, beatsArr)).slice(0, 280),
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[compare-benchmark] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
