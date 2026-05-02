// ============================================================
// score-risk — 1-10 risk score per held ticker + reason
// ============================================================
// Reads holdings, computes a deterministic 1-10 risk score per
// position based on:
//   - category baseline (BONO=2, ETF=4, CEDEAR=6, ACCION=7,
//     COMMOD=6)
//   - volatility multiplier (per-ticker historical move %)
//   - concentration penalty (positions > 30% of book add risk)
//   - recent drawdown (negative gainPct vs avg cost)
//
// AI then refines the per-ticker reason; numerical scores stay
// deterministic so the LLM can't hallucinate them.
//
// Request body: {}
// Response:
//   {
//     scores: {
//       [ticker]: {
//         score:  1-10,
//         level:  "low" | "medium" | "high",
//         reason: string,
//       }
//     },
//     summary:    string,
//     generatedAt: string,
//   }
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy score-risk
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  consumeRateLimit, RATE_LIMITS, buildBucket, rateLimit429, makeAdminClient,
} from "../_shared/rate-limit.ts";

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

const ASSETS: Record<string, { name: string; category: string; currency: string; price: number; volMult: number; }> = {
  // volMult = relative volatility — 1.0 is "average", >1.5 = high vol
  AAPL: { name: "Apple",            category: "CEDEAR", currency: "USD", price: 215.40, volMult: 1.0 },
  NVDA: { name: "NVIDIA",           category: "CEDEAR", currency: "USD", price: 892.15, volMult: 1.6 },
  TSLA: { name: "Tesla",            category: "CEDEAR", currency: "USD", price: 248.30, volMult: 1.8 },
  MSFT: { name: "Microsoft",        category: "CEDEAR", currency: "USD", price: 432.10, volMult: 0.9 },
  GOOGL:{ name: "Alphabet",         category: "CEDEAR", currency: "USD", price: 184.20, volMult: 1.0 },
  GGAL: { name: "Grupo Galicia",    category: "ACCION", currency: "ARS", price: 4250,   volMult: 1.4 },
  YPF:  { name: "YPF",              category: "ACCION", currency: "ARS", price: 38500,  volMult: 1.5 },
  PAMP: { name: "Pampa Energía",    category: "ACCION", currency: "ARS", price: 5820,   volMult: 1.3 },
  IBIT:  { name: "iShares Bitcoin Trust", category: "CEDEAR", currency: "USD", price: 62.4, volMult: 1.7 },
  COIN:  { name: "Coinbase", category: "CEDEAR", currency: "USD", price: 247.3, volMult: 1.7 },
  MSTR:  { name: "MicroStrategy", category: "CEDEAR", currency: "USD", price: 358.4, volMult: 1.9 },
  MARA:  { name: "Marathon Digital", category: "CEDEAR", currency: "USD", price: 18.2, volMult: 2.0 },
  RIOT:  { name: "Riot Platforms", category: "CEDEAR", currency: "USD", price: 11.85, volMult: 2.0 },
  AL30: { name: "Bonar 2030",       category: "BONO",   currency: "USD", price: 56.70,  volMult: 0.8 },
  SPY:  { name: "S&P 500 ETF",      category: "ETF",    currency: "USD", price: 512.40, volMult: 0.7 },
  QQQ:  { name: "Nasdaq-100 ETF",   category: "ETF",    currency: "USD", price: 431.20, volMult: 1.0 },
  IWM:  { name: "Russell 2000 ETF", category: "ETF",    currency: "USD", price: 218.65, volMult: 1.1 },
  EWZ:  { name: "Brasil ETF",       category: "ETF",    currency: "USD", price:  29.40, volMult: 1.3 },
  GLD:  { name: "Oro (SPDR Gold)",  category: "COMMOD", currency: "USD", price: 228.60, volMult: 0.8 },
  SLV:  { name: "Plata (iShares)",  category: "COMMOD", currency: "USD", price:  27.85, volMult: 1.2 },
  USO:  { name: "Petróleo (USO)",   category: "COMMOD", currency: "USD", price:  81.30, volMult: 1.4 },
};

const ARS_TO_USD = 1 / 1245;

const CATEGORY_BASELINE: Record<string, number> = {
  BONO:   2,
  ETF:    4,
  CEDEAR: 6,
  COMMOD: 6,
  ACCION: 7,
};

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

type ScoreEntry = {
  ticker: string;
  name: string;
  category: string;
  pctOfBook: number;
  gainPct: number;
  score: number;       // 1-10 integer
  level: "low" | "medium" | "high";
  factors: string[];   // template factors fed into the AI prompt
};

function levelFromScore(s: number): "low" | "medium" | "high" {
  if (s <= 3) return "low";
  if (s <= 6) return "medium";
  return "high";
}

function templatedReason(e: ScoreEntry): string {
  if (e.score <= 3) {
    return `Riesgo bajo. ${e.factors.join(". ")}.`;
  }
  if (e.score <= 6) {
    return `Riesgo medio. ${e.factors.join(". ")}.`;
  }
  return `Riesgo alto. ${e.factors.join(". ")}.`;
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
      bucket: buildBucket("score-risk", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    const { data: rawHoldings } = await userClient
      .from("holdings").select("ticker, qty, avg_cost").gt("qty", 0);
    const holdings = (rawHoldings || []).map((h) => {
      const meta = ASSETS[h.ticker] || { name: h.ticker, category: "OTROS", currency: "USD", price: 0, volMult: 1 };
      const qty = Number(h.qty) || 0;
      const avgCost = Number(h.avg_cost) || 0;
      const valueLocal = qty * meta.price;
      const valueUsd = meta.currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
      const gainPct = avgCost > 0 ? ((meta.price - avgCost) / avgCost) * 100 : 0;
      return { ticker: h.ticker, name: meta.name, category: meta.category, qty, valueUsd, gainPct, volMult: meta.volMult };
    });

    if (holdings.length === 0) {
      return new Response(JSON.stringify({
        scores: {}, summary: "Sin posiciones para evaluar.",
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const totalUsd = holdings.reduce((acc, h) => acc + h.valueUsd, 0);

    // Score each holding deterministically.
    const entries: ScoreEntry[] = holdings.map((h) => {
      const baseline = CATEGORY_BASELINE[h.category] ?? 5;
      const pctOfBook = totalUsd > 0 ? (h.valueUsd / totalUsd) * 100 : 0;
      const factors: string[] = [];

      // Category baseline
      const catLabels: Record<string, string> = {
        BONO: "bono soberano", ETF: "ETF",
        CEDEAR: "CEDEAR", ACCION: "acción argentina",
        COMMOD: "commodity",
      };
      factors.push(`${catLabels[h.category] || h.category} (baseline ${baseline})`);

      // Volatility — adjust score by ±2 based on volMult.
      let volAdjust = 0;
      if (h.volMult >= 1.7)      volAdjust = +2;
      else if (h.volMult >= 1.3) volAdjust = +1;
      else if (h.volMult <= 0.8) volAdjust = -1;
      if (volAdjust > 0) factors.push(`volatilidad alta (×${h.volMult.toFixed(1)})`);
      else if (volAdjust < 0) factors.push(`volatilidad baja (×${h.volMult.toFixed(1)})`);

      // Concentration — > 40% of book adds 2, > 25% adds 1.
      let concAdjust = 0;
      if (pctOfBook >= 40) concAdjust = +2;
      else if (pctOfBook >= 25) concAdjust = +1;
      if (concAdjust > 0) factors.push(`${pctOfBook.toFixed(0)}% del book (concentración)`);

      // Drawdown — < -15% adds 1.
      let ddAdjust = 0;
      if (h.gainPct <= -15) {
        ddAdjust = +1;
        factors.push(`${h.gainPct.toFixed(1)}% en rojo (drawdown material)`);
      }

      const score = Math.max(1, Math.min(10, baseline + volAdjust + concAdjust + ddAdjust));
      return {
        ticker: h.ticker, name: h.name, category: h.category,
        pctOfBook, gainPct: h.gainPct,
        score, level: levelFromScore(score),
        factors,
      };
    });

    // --- LLM path (or templated) ---
    if (!ANTHROPIC_API_KEY) {
      const scores: Record<string, { score: number; level: string; reason: string }> = {};
      for (const e of entries) {
        scores[e.ticker] = { score: e.score, level: e.level, reason: templatedReason(e) };
      }
      const highCount = entries.filter((e) => e.level === "high").length;
      const summary = highCount === 0
        ? "Tu cartera tiene riesgo bajo a medio en todas las posiciones."
        : `${highCount} posición${highCount > 1 ? "es" : ""} en riesgo alto. Revisá si te encajan con tu perfil.`;
      return new Response(JSON.stringify({
        scores, summary,
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // LLM-enhanced reasons. Tickers + scores + levels stay deterministic.
    const promptInput = entries.map((e, i) => ({
      i, ticker: e.ticker, name: e.name, category: e.category,
      score: e.score, level: e.level,
      pctOfBook: Number(e.pctOfBook.toFixed(1)),
      gainPct: Number(e.gainPct.toFixed(1)),
      factors: e.factors,
    }));

    const userPrompt = [
      `Sos SAMAS, asistente de inversiones para retail argentino. Tenés un score de riesgo (1-10) ya calculado para cada posición. Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{`,
      `  "summary": "1 oración resumen, máximo 130 caracteres",`,
      `  "reasons": ["array con la razón refinada para cada posición, en el MISMO orden, máximo 130 caracteres cada una"]`,
      `}`,
      ``,
      `Reglas:`,
      `- Voseo (vos), profesional y cercano. Cero hype, cero emojis.`,
      `- En cada reason: explicá CONCRETAMENTE por qué ese score (mencioná categoría, peso en el book, volatilidad, drawdown si aplica).`,
      `- "reasons" debe tener exactamente ${entries.length} elementos.`,
      `- NO cambies los scores. Solo refinás la redacción.`,
      ``,
      `Posiciones:`,
      JSON.stringify(promptInput, null, 2),
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

    let parsed: { summary?: string; reasons?: string[] } = {};
    if (r.ok) {
      const json = await r.json();
      const text = json?.content?.[0]?.text || "";
      const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
      try { parsed = JSON.parse(stripped); } catch { parsed = {}; }
    }

    const scores: Record<string, { score: number; level: string; reason: string }> = {};
    entries.forEach((e, i) => {
      scores[e.ticker] = {
        score: e.score, level: e.level,
        reason: (Array.isArray(parsed.reasons) && parsed.reasons[i])
          ? String(parsed.reasons[i]).slice(0, 200)
          : templatedReason(e),
      };
    });

    const highCount = entries.filter((e) => e.level === "high").length;
    const fallbackSummary = highCount === 0
      ? "Tu cartera tiene riesgo bajo a medio en todas las posiciones."
      : `${highCount} posición${highCount > 1 ? "es" : ""} en riesgo alto.`;

    return new Response(JSON.stringify({
      scores,
      summary: String(parsed.summary || fallbackSummary).slice(0, 200),
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[score-risk] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
