// ============================================================
// news-digest — daily AI digest of news relevant to held tickers
// ============================================================
// Reads the user's holdings, pulls the freshest cached articles
// (public.articles, populated by the fetch-news Edge Function on
// demand) for the top-weighted tickers, and asks Claude Haiku to
// write a 2-3 sentence digest naming concrete headlines + impact.
//
// Designed as an auto-loading surface (FREE for both tiers) — sits
// at the top of the News tab and gives the user a "what mattered
// for MY portfolio today" hook before they scroll the generic feed.
//
// Stats sent to Claude as authority. Claude only writes the prose.
// Tickers + headlines + URLs are passed through unchanged.
//
// Request body: {}
// Response:
//   {
//     digest: string,           // 2-3 sentences, voseo
//     headlines: [
//       { ticker, name, title, source, url, publishedAt, pctOfBook },
//       ...
//     ],
//     coveredTickers: string[],
//     generatedAt: string,
//   }
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy news-digest \
//     --project-ref diulqkaorfqccipguiok --no-verify-jwt
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

const ASSETS: Record<string, { name: string; currency: string; price: number; }> = {
  AAPL:  { name: "Apple",            currency: "USD", price: 215.40 },
  NVDA:  { name: "NVIDIA",           currency: "USD", price: 892.15 },
  TSLA:  { name: "Tesla",            currency: "USD", price: 248.30 },
  MSFT:  { name: "Microsoft",        currency: "USD", price: 432.10 },
  GOOGL: { name: "Alphabet",         currency: "USD", price: 184.20 },
  META:  { name: "Meta Platforms",   currency: "USD", price: 568.40 },
  AMZN:  { name: "Amazon",           currency: "USD", price: 198.20 },
  KO:    { name: "Coca-Cola",        currency: "USD", price: 71.10 },
  GGAL:  { name: "Grupo Galicia",    currency: "ARS", price: 4250 },
  YPF:   { name: "YPF",              currency: "ARS", price: 38500 },
  PAMP:  { name: "Pampa Energía",    currency: "ARS", price: 5820 },
  ALUA:  { name: "Aluar",            currency: "ARS", price: 1180 },
  BTC:   { name: "Bitcoin",          currency: "USD", price: 67400 },
  ETH:   { name: "Ethereum",         currency: "USD", price: 3580 },
  SPY:   { name: "S&P 500 ETF",      currency: "USD", price: 542.30 },
  QQQ:   { name: "Nasdaq-100 ETF",   currency: "USD", price: 478.20 },
};

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
      bucket: buildBucket("news-digest", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    // --- read holdings ---
    const { data: rawHoldings } = await userClient
      .from("holdings").select("ticker, qty").gt("qty", 0);
    const holdings = rawHoldings || [];

    if (holdings.length === 0) {
      return new Response(JSON.stringify({
        digest: "Sin posiciones todavía. Después de tu primera compra, te armo un digest cada día con lo que importa para tu cartera.",
        headlines: [],
        coveredTickers: [],
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Compute pctOfBook + sort by weight, take top 5 tickers
    let totalUsd = 0;
    const enriched = holdings.map((h: any) => {
      const meta = ASSETS[h.ticker];
      const qty = Number(h.qty) || 0;
      const valueLocal = qty * (meta?.price ?? 0);
      const valueUsd = meta?.currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
      totalUsd += valueUsd;
      return { ticker: h.ticker, name: meta?.name || h.ticker, valueUsd };
    });
    const tickers = enriched
      .sort((a, b) => b.valueUsd - a.valueUsd)
      .slice(0, 5)
      .map((h) => h.ticker);
    const tickerWeight: Record<string, number> = {};
    for (const t of enriched) {
      tickerWeight[t.ticker] = totalUsd > 0 ? (t.valueUsd / totalUsd) * 100 : 0;
    }

    // --- pull cached articles for those tickers (newest first per ticker) ---
    // Use service role to read articles since the table is public-ish
    // (no RLS enforcement on it for reads, articles are not user data).
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: rawArticles } = await adminClient
      .from("articles")
      .select("ticker, title, summary, url, source, published_at")
      .in("ticker", tickers)
      .order("published_at", { ascending: false })
      .limit(40);

    const articles = rawArticles || [];

    // Take up to 2 articles per ticker, max 6 total. Most recent wins.
    const perTicker: Record<string, number> = {};
    const picked: typeof articles = [];
    for (const a of articles) {
      perTicker[a.ticker] = perTicker[a.ticker] || 0;
      if (perTicker[a.ticker] >= 2) continue;
      perTicker[a.ticker]++;
      picked.push(a);
      if (picked.length >= 6) break;
    }

    if (picked.length === 0) {
      return new Response(JSON.stringify({
        digest: "Día tranquilo en tus posiciones. Sin novedades importantes en las últimas 24h. Aprovechá para revisar tu tesis sin ruido.",
        headlines: [],
        coveredTickers: tickers,
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const headlines = picked.map((a) => ({
      ticker: a.ticker,
      name: ASSETS[a.ticker]?.name || a.ticker,
      title: a.title,
      source: a.source,
      url: a.url,
      publishedAt: a.published_at,
      pctOfBook: Number((tickerWeight[a.ticker] || 0).toFixed(1)),
    }));

    // --- LLM digest (or fallback) ---
    function templatedDigest() {
      const top = headlines.slice(0, 3).map((h) => `$${h.ticker}: ${h.title}`).join(" / ");
      return `Lo que se mueve en tu cartera hoy: ${top}. ${headlines.length > 3 ? `Y ${headlines.length - 3} titular${headlines.length - 3 > 1 ? "es" : ""} más abajo.` : ""}`.slice(0, 280);
    }

    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({
        digest: templatedDigest(),
        headlines,
        coveredTickers: tickers,
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const itemsForPrompt = headlines.map((h) => ({
      ticker: h.ticker,
      name: h.name,
      title: h.title,
      source: h.source,
      pctOfBook: h.pctOfBook,
    }));

    const userPrompt = [
      `Sos SAMAS, asistente de inversiones para retail argentino. Vas a escribir un "digest de noticias" con lo que pasó hoy en las posiciones del usuario.`,
      ``,
      `Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{`,
      `  "digest": "2-3 oraciones, máximo 280 caracteres total"`,
      `}`,
      ``,
      `Reglas:`,
      `- Voseo (vos), profesional, sereno. Cero hype, cero emojis.`,
      `- Mencioná concretamente los tickers más relevantes con $TICKER.`,
      `- No reportes TODOS los titulares — sintetizá los 1-2 más importantes para la cartera. Mirá pctOfBook para priorizar.`,
      `- Si hay un titular crítico (earnings, regulatorio, ruling), priorizalo.`,
      `- Si todos los titulares son rutinarios, decilo: "día tranquilo en tu cartera, lo más relevante: …"`,
      ``,
      `Titulares disponibles:`,
      JSON.stringify(itemsForPrompt, null, 2),
    ].join("\n");

    let digest = "";
    try {
      const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL, max_tokens: 400,
          messages: [{ role: "user", content: userPrompt }],
        }),
      }, 12000);
      if (r.ok) {
        const json = await r.json();
        const text = json?.content?.[0]?.text || "";
        const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
        const parsed = JSON.parse(stripped);
        digest = String(parsed.digest || "").slice(0, 320);
      }
    } catch (_e) { /* fall through */ }

    if (!digest) digest = templatedDigest();

    return new Response(JSON.stringify({
      digest,
      headlines,
      coveredTickers: tickers,
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[news-digest] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
