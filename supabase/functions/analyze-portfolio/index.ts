// ============================================================
// analyze-portfolio — Claude-generated portfolio analysis
// ============================================================
// Reads the caller's holdings via their JWT (RLS auto-scopes the
// query to auth.uid()), passes them to Claude Haiku with a tight
// prompt template, and returns a structured response:
//
//   {
//     headline:     string,            // one-line summary
//     bullets:      string[],          // 3 quick observations
//     suggestion:   string,            // one concrete next move
//     concentration: string,           // dominant ticker / sector
//     generatedAt:  string,            // ISO timestamp
//   }
//
// MODEL
//   claude-haiku-4-5-20251001 — fast, cheap, perfect for the
//   "tap → 1.5s wait → result" UX. Same model used by fetch-news
//   for the article-translation pass.
//
// SECURITY
//   user_id derives from the verified JWT, never the request
//   body. Even though we use the user-scoped client (RLS does
//   the filtering), we still return early on a missing/invalid
//   token.
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy analyze-portfolio
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  consumeRateLimit, RATE_LIMITS, buildBucket, getRequestIp, rateLimit429,
  makeAdminClient,
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

// Asset universe — duplicated here intentionally so the function is
// self-contained and doesn't depend on any client bundle. Stays in
// sync with src/v2/api/broker.js ASSETS by hand. Only the fields
// the LLM actually uses (ticker / name / category / currency / price
// / changePct) are included; logos / colors / etc. don't help the
// analysis and just bloat the prompt.
const ASSETS: Record<string, {
  name: string;
  category: string;
  currency: string;
  price: number;
  changePct: number;
}> = {
  AAPL: { name: "Apple",            category: "CEDEAR", currency: "USD", price: 215.40, changePct:  1.84 },
  NVDA: { name: "NVIDIA",           category: "CEDEAR", currency: "USD", price: 892.15, changePct:  4.21 },
  TSLA: { name: "Tesla",            category: "CEDEAR", currency: "USD", price: 248.30, changePct: -1.20 },
  MSFT: { name: "Microsoft",        category: "CEDEAR", currency: "USD", price: 432.10, changePct:  0.74 },
  GOOGL:{ name: "Alphabet",         category: "CEDEAR", currency: "USD", price: 184.20, changePct:  1.12 },
  GGAL: { name: "Grupo Galicia",    category: "ACCION", currency: "ARS", price: 4250,   changePct: -2.10 },
  YPF:  { name: "YPF",              category: "ACCION", currency: "ARS", price: 38500,  changePct:  3.45 },
  PAMP: { name: "Pampa Energía",    category: "ACCION", currency: "ARS", price: 5820,   changePct:  0.92 },
  AL30: { name: "Bonar 2030",       category: "BONO",   currency: "USD", price: 56.70,  changePct:  0.40 },
  SPY:  { name: "S&P 500 ETF",      category: "ETF",    currency: "USD", price: 512.40, changePct:  0.62 },
  QQQ:  { name: "Nasdaq-100 ETF",   category: "ETF",    currency: "USD", price: 431.20, changePct:  0.88 },
  IWM:  { name: "Russell 2000 ETF", category: "ETF",    currency: "USD", price: 218.65, changePct: -0.34 },
  EWZ:  { name: "Brasil ETF",       category: "ETF",    currency: "USD", price:  29.40, changePct:  1.05 },
  GLD:  { name: "Oro (SPDR Gold)",  category: "COMMOD", currency: "USD", price: 228.60, changePct:  1.24 },
  SLV:  { name: "Plata (iShares)",  category: "COMMOD", currency: "USD", price:  27.85, changePct: -0.51 },
  USO:  { name: "Petróleo (USO)",   category: "COMMOD", currency: "USD", price:  81.30, changePct: -0.72 },
};

// ARS → USD conversion using a fixed MEP rate (no live FX call inside
// the function — the small drift between this and the real MEP
// doesn't change the analysis qualitatively).
const ARS_TO_USD = 1 / 1245;

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
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

    // --- rate limit (samas-0.4.17) ---
    // AI preset: 60/min per (user, ip). On top of the SAMAS Plus
    // ai_usage_daily quota (5/day for non-Plus). Bucket is per-user
    // since this function is auth-only.
    const rl = await consumeRateLimit(makeAdminClient(), {
      bucket: buildBucket("analyze-portfolio", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!rl.allowed) return rateLimit429(rl, corsHeaders);

    // --- read holdings (RLS scopes to auth.uid() automatically) ---
    const { data: holdings, error: hErr } = await userClient
      .from("holdings")
      .select("ticker, qty, avg_cost, currency");
    if (hErr) {
      return new Response(JSON.stringify({ error: hErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rows = (holdings || []).filter((h) => Number(h.qty) > 0);
    if (rows.length === 0) {
      return new Response(JSON.stringify({
        headline: "Tu cartera está vacía.",
        bullets: ["Sin posiciones activas para analizar."],
        suggestion: "Empezá comprando una posición desde el tab Mercado.",
        concentration: "—",
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- enrich with current prices + compute USD value per row ---
    type EnrichedRow = {
      ticker: string;
      name: string;
      category: string;
      qty: number;
      avgCost: number;
      currency: string;
      currentPrice: number;
      valueUsd: number;
      gainPct: number;
      changePct: number;
    };
    const enriched: EnrichedRow[] = rows.map((h) => {
      const meta = ASSETS[h.ticker] || {
        name: h.ticker, category: "OTROS", currency: h.currency || "USD",
        price: Number(h.avg_cost) || 0, changePct: 0,
      };
      const qty = Number(h.qty) || 0;
      const avgCost = Number(h.avg_cost) || 0;
      const currentPrice = meta.price;
      const valueLocal = qty * currentPrice;
      const valueUsd = meta.currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
      const gainPct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
      return {
        ticker: h.ticker,
        name: meta.name,
        category: meta.category,
        qty,
        avgCost,
        currency: meta.currency,
        currentPrice,
        valueUsd,
        gainPct,
        changePct: meta.changePct,
      };
    });

    const totalUsd = enriched.reduce((acc, r) => acc + r.valueUsd, 0);
    const ranked = [...enriched].sort((a, b) => b.valueUsd - a.valueUsd);

    // --- prompt build ---
    const portfolioJson = ranked.map((r) => ({
      ticker:    r.ticker,
      name:      r.name,
      category:  r.category,
      qty:       r.qty,
      currency:  r.currency,
      valueUsd:  Math.round(r.valueUsd),
      pctOfBook: totalUsd > 0 ? Number((r.valueUsd / totalUsd * 100).toFixed(1)) : 0,
      gainPct:   Number(r.gainPct.toFixed(1)),
      dayChange: Number(r.changePct.toFixed(1)),
    }));

    const userPrompt = [
      `Analizá esta cartera de un inversor argentino retail. Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{`,
      `  "headline": "una línea, máximo 80 caracteres, en español",`,
      `  "bullets": ["3 observaciones cortas, cada una máximo 90 caracteres, en español"],`,
      `  "suggestion": "una sugerencia concreta, accionable, máximo 100 caracteres, en español",`,
      `  "concentration": "el ticker o sector dominante, máximo 30 caracteres"`,
      `}`,
      ``,
      `Reglas de tono:`,
      `- Profesional pero cercano (vos, no usted).`,
      `- Cero hype, cero términos en inglés innecesarios.`,
      `- No des consejos legales ni de cumplimiento; sí podés hablar de riesgo / diversificación / asignación.`,
      `- Si hay alta concentración (>40% en un ticker o sector), mencionalo.`,
      `- No uses emojis.`,
      ``,
      `Cartera (valor total: US$${Math.round(totalUsd).toLocaleString("en-US")}):`,
      JSON.stringify(portfolioJson, null, 2),
    ].join("\n");

    // --- Claude call (with templated fallback) ---
    // If ANTHROPIC_API_KEY isn't set, build the response from a
    // template populated with the caller's real portfolio numbers.
    // Same shape as the LLM response, so the UI doesn't need to
    // branch. Useful during the pre-Cohen demo phase when we don't
    // want to spend on API calls yet — flip the env on later and
    // real Claude responses replace these without code changes.
    if (!ANTHROPIC_API_KEY) {
      console.log("[analyze-portfolio] no API key — returning templated analysis");
      const top = ranked[0];
      const topPct = totalUsd > 0 ? (top.valueUsd / totalUsd) * 100 : 0;
      // Sector mix (CEDEAR / ACCION / BONO / ETF / COMMOD)
      const sectorMap: Record<string, number> = {};
      for (const r of ranked) {
        sectorMap[r.category] = (sectorMap[r.category] || 0) + r.valueUsd;
      }
      const topSector = Object.entries(sectorMap).sort((a, b) => b[1] - a[1])[0];
      const sectorPct = totalUsd > 0 ? (topSector[1] / totalUsd) * 100 : 0;
      const sectorLabel: Record<string, string> = {
        CEDEAR: "CEDEARs", ACCION: "acciones argentinas",
        BONO: "bonos", ETF: "ETFs", COMMOD: "commodities",
      };
      const sectorName = sectorLabel[topSector[0]] || topSector[0].toLowerCase();
      const nGains = ranked.filter((r) => r.gainPct > 0).length;
      const nLosses = ranked.filter((r) => r.gainPct < 0).length;
      const avgGain = ranked.reduce((acc, r) => acc + r.gainPct * r.valueUsd, 0) /
        Math.max(totalUsd, 1);
      const headline = topPct > 40
        ? `Tu cartera de US$${Math.round(totalUsd).toLocaleString("en-US")} está muy concentrada en ${top.ticker}.`
        : `Cartera diversificada de US$${Math.round(totalUsd).toLocaleString("en-US")} con peso en ${sectorName}.`;
      const bullets: string[] = [];
      if (topPct > 40) {
        bullets.push(`${top.ticker} representa ${topPct.toFixed(0)}% de tu book — alta concentración.`);
      } else {
        bullets.push(`${top.ticker} es tu mayor posición (${topPct.toFixed(0)}%), pero la cartera está repartida.`);
      }
      bullets.push(`${ranked.length} posiciones activas con un retorno promedio ponderado de ${avgGain >= 0 ? "+" : ""}${avgGain.toFixed(1)}%.`);
      if (nGains > nLosses) {
        bullets.push(`${nGains} de ${ranked.length} posiciones en verde — momento favorable para revisar tomas de ganancia.`);
      } else if (nLosses > nGains) {
        bullets.push(`${nLosses} de ${ranked.length} posiciones en rojo — momento de revisar tesis y stop-losses.`);
      } else {
        bullets.push(`Cartera mixta: ${nGains} en verde y ${nLosses} en rojo. Sin sesgo claro.`);
      }
      const suggestion = topPct > 40
        ? `Considerá reducir ${top.ticker} a menos del 30% del book para bajar riesgo de concentración.`
        : `Mantené revisando earnings y eventos macro de ${sectorName} para defender la asignación actual.`;
      return new Response(JSON.stringify({
        headline:      headline.slice(0, 200),
        bullets:       bullets.map((b) => b.slice(0, 200)),
        suggestion:    suggestion.slice(0, 240),
        concentration: `${top.ticker} (${topPct.toFixed(0)}%)`,
        generatedAt:   new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
    }, 15000);

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn(`[analyze-portfolio] anthropic ${r.status}:`, txt.slice(0, 300));
      return new Response(JSON.stringify({ error: "AI unavailable" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const json = await r.json();
    const text = json?.content?.[0]?.text || "";
    // Strip optional markdown fences and parse the JSON.
    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: {
      headline?: string;
      bullets?: string[];
      suggestion?: string;
      concentration?: string;
    };
    try {
      parsed = JSON.parse(stripped);
    } catch {
      console.warn("[analyze-portfolio] non-JSON response:", text.slice(0, 200));
      // Fallback: stuff the raw text into headline so the UI still
      // renders something instead of a hard error.
      parsed = {
        headline: text.slice(0, 80),
        bullets: [],
        suggestion: "",
        concentration: ranked[0]?.ticker || "",
      };
    }

    return new Response(JSON.stringify({
      headline:     String(parsed.headline || "").slice(0, 200),
      bullets:      Array.isArray(parsed.bullets) ? parsed.bullets.map((b) => String(b).slice(0, 200)).slice(0, 5) : [],
      suggestion:   String(parsed.suggestion || "").slice(0, 240),
      concentration: String(parsed.concentration || ranked[0]?.ticker || "").slice(0, 60),
      generatedAt:  new Date().toISOString(),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[analyze-portfolio] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
