// ============================================================
// proactive-insights — AI proactive notifications generator
// ============================================================
// Scans the calling user's holdings for actionable signals and
// drops notification rows (kind='insight') so they show up in the
// bell-icon inbox + push notification queue. Each row gets a
// Claude-refined headline + body; the underlying signal numbers
// stay deterministic.
//
// Signals checked (server-side, all deterministic):
//   - concentration: any ticker > 30% of book → "rebalance hint"
//   - big_drawdown:  ticker -15% or worse vs avg_cost → "review thesis"
//   - big_gain:      ticker +30% or better vs avg_cost → "consider trim"
//   - cash_drag:     synthetic flag if portfolio.totalUsd is small AND
//                    holdings count is low → "putting cash to work"
//   - earnings_soon: any held ticker reports in 0-2 days
//
// Each user gets at most 5 fresh insights per call (the loudest
// ones). Insights of the same kind+ticker are deduped against
// notifications inserted in the last 24h so re-running the function
// doesn't spam the inbox.
//
// HOW TO USE
//   - On-demand:  POST /functions/v1/proactive-insights with the
//     user's JWT (called from the bell-inbox "Refresh" button).
//   - Cron:       schedulable via pg_cron daily; in cron mode the
//     function runs through every active user (loop on getUser via
//     service role). For 0.2.1 we ship the on-demand path only;
//     cron wiring is a future SQL migration.
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy proactive-insights \
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
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

// Mirrors earnings-watch's calendar so "earnings tomorrow" lines up.
const EARNINGS_OFFSETS_DAYS: Record<string, number> = {
  AAPL: 4, NVDA: 12, TSLA: 7, MSFT: 28, GOOGL: 30, GGAL: 18, YPF: 22,
};

const ARS_TO_USD = 1 / 1245;

type Insight = {
  kind: "concentration" | "big_drawdown" | "big_gain" | "cash_drag" | "earnings_soon";
  ticker: string | null;
  title: string;     // server templated (will be refined by LLM)
  body: string;      // ditto
  data: Record<string, unknown>;
};

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
      SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!,
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
      bucket: buildBucket("proactive-insights", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

    // --- read holdings ---
    const { data: rawHoldings } = await userClient
      .from("holdings")
      .select("ticker, qty, avg_cost, currency")
      .gt("qty", 0);

    if (!rawHoldings || rawHoldings.length === 0) {
      return new Response(JSON.stringify({
        inserted: 0,
        summary: "Sin posiciones todavía. Volvé después de tu primera compra.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Compute book total + per-ticker enrichment
    let totalUsd = 0;
    const enriched = rawHoldings.map((h: any) => {
      const meta = ASSETS[h.ticker];
      const qty = Number(h.qty) || 0;
      const avgCost = Number(h.avg_cost) || 0;
      const currentPrice = meta?.price ?? avgCost;
      const currency = (meta?.currency ?? h.currency ?? "USD") as "ARS" | "USD";
      const valueLocal = qty * currentPrice;
      const valueUsd = currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
      const unrealizedPct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
      totalUsd += valueUsd;
      return {
        ticker: h.ticker,
        name: meta?.name || h.ticker,
        qty, avgCost, currentPrice, currency, valueUsd, unrealizedPct,
      };
    });

    // ----- collect raw signals (deterministic) -----
    const candidates: Insight[] = [];

    for (const h of enriched) {
      const pctOfBook = totalUsd > 0 ? (h.valueUsd / totalUsd) * 100 : 0;

      // 1. concentration: > 30% of book
      if (pctOfBook >= 30) {
        candidates.push({
          kind: "concentration",
          ticker: h.ticker,
          title: `${h.ticker} es ${pctOfBook.toFixed(0)}% de tu cartera`,
          body: `Concentración alta. Considerá rebalancear para reducir riesgo idiosincrático.`,
          data: { ticker: h.ticker, pctOfBook: Number(pctOfBook.toFixed(1)) },
        });
      }

      // 2. big drawdown: -15% or worse
      if (h.unrealizedPct <= -15) {
        candidates.push({
          kind: "big_drawdown",
          ticker: h.ticker,
          title: `${h.ticker} cae ${Math.abs(h.unrealizedPct).toFixed(0)}% desde tu compra`,
          body: `Drawdown significativo. Revisá la tesis original o evaluá tax-loss harvesting.`,
          data: { ticker: h.ticker, drawdownPct: Number(h.unrealizedPct.toFixed(1)) },
        });
      }

      // 3. big gain: +30% or better
      if (h.unrealizedPct >= 30) {
        candidates.push({
          kind: "big_gain",
          ticker: h.ticker,
          title: `${h.ticker} sube ${h.unrealizedPct.toFixed(0)}% desde tu compra`,
          body: `Buena ganancia no realizada. ¿Tomás parte? Vender un % crystaliza la ganancia y baja la concentración.`,
          data: { ticker: h.ticker, gainPct: Number(h.unrealizedPct.toFixed(1)) },
        });
      }

      // 4. earnings in 0-2 days
      const offset = EARNINGS_OFFSETS_DAYS[h.ticker];
      if (offset !== undefined && offset >= 0 && offset <= 2) {
        const when = offset === 0 ? "hoy" : offset === 1 ? "mañana" : "pasado mañana";
        candidates.push({
          kind: "earnings_soon",
          ticker: h.ticker,
          title: `${h.ticker} reporta ${when}`,
          body: `Tenés ${pctOfBook.toFixed(0)}% del book en este ticker. Movimiento esperado post-earnings: ±5-9%.`,
          data: { ticker: h.ticker, daysOut: offset, pctOfBook: Number(pctOfBook.toFixed(1)) },
        });
      }
    }

    // 5. cash drag: synthetic — small portfolio + few positions = "build out"
    if (totalUsd > 0 && totalUsd < 500 && enriched.length <= 2) {
      candidates.push({
        kind: "cash_drag",
        ticker: null,
        title: "Tu cartera es chica todavía",
        body: `Solo ${enriched.length} posición${enriched.length > 1 ? "es" : ""}, US$${totalUsd.toFixed(0)} invertido. Diversificar baja el riesgo idiosincrático.`,
        data: { totalUsd: Number(totalUsd.toFixed(2)), holdings: enriched.length },
      });
    }

    if (candidates.length === 0) {
      return new Response(JSON.stringify({
        inserted: 0,
        summary: "Cartera tranquila. Sin alertas accionables hoy.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ----- dedupe against the last 24h of insights -----
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentRows } = await adminClient
      .from("notifications")
      .select("kind, data, created_at")
      .eq("user_id", user.id)
      .eq("kind", "insight")
      .gte("created_at", dayAgo);

    const seenSignatures = new Set<string>();
    for (const r of (recentRows || [])) {
      const sig = `${(r.data as any)?.signal || ""}::${(r.data as any)?.ticker || ""}`;
      seenSignatures.add(sig);
    }

    const fresh = candidates.filter((c) => {
      const sig = `${c.kind}::${c.ticker || ""}`;
      return !seenSignatures.has(sig);
    });

    if (fresh.length === 0) {
      return new Response(JSON.stringify({
        inserted: 0,
        summary: "Ya te avisé de todo lo accionable en las últimas 24h.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ----- pick top 5 by priority -----
    const priority: Record<Insight["kind"], number> = {
      earnings_soon: 0, concentration: 1, big_drawdown: 2, big_gain: 3, cash_drag: 4,
    };
    fresh.sort((a, b) => priority[a.kind] - priority[b.kind]);
    const picks = fresh.slice(0, 5);

    // ----- LLM refinement (optional) -----
    let refined: { title: string; body: string }[] = [];
    if (ANTHROPIC_API_KEY && picks.length > 0) {
      const itemsForPrompt = picks.map((p, i) => ({
        i,
        kind: p.kind,
        ticker: p.ticker,
        baselineTitle: p.title,
        baselineBody: p.body,
        data: p.data,
      }));
      const userPrompt = [
        `Sos SAMAS, asistente de inversiones para retail argentino. Te paso un set de señales detectadas en la cartera del usuario y vas a refinar cada una en un mensaje proactivo de notificación push.`,
        ``,
        `Devolvé un JSON con esta forma EXACTA, sin markdown:`,
        `{`,
        `  "items": [{ "title": "≤50 chars", "body": "≤120 chars" }, ...]`,
        `}`,
        ``,
        `Reglas:`,
        `- Voseo (vos), profesional, sereno. Cero hype, cero emojis.`,
        `- "title" en imperativo o anuncio (≤50 caracteres). Sin claims sobre el futuro.`,
        `- "body" descriptivo + 1 acción concreta (≤120 caracteres). No uses "deberías", usá "podés".`,
        `- "items" debe tener exactamente ${picks.length} elementos en el MISMO orden.`,
        `- Mantené tickers + números tal cual te los paso. No inventes datos.`,
        ``,
        `Señales:`,
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
            model: ANTHROPIC_MODEL, max_tokens: 800,
            messages: [{ role: "user", content: userPrompt }],
          }),
        }, 12000);
        if (r.ok) {
          const json = await r.json();
          const text = json?.content?.[0]?.text || "";
          const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
          const parsed = JSON.parse(stripped);
          if (Array.isArray(parsed.items)) {
            refined = parsed.items.map((x: any) => ({
              title: String(x.title || "").slice(0, 80),
              body: String(x.body || "").slice(0, 200),
            }));
          }
        }
      } catch (_e) { /* fall through to baseline */ }
    }

    // ----- insert notifications -----
    const rows = picks.map((p, i) => ({
      user_id: user.id,
      kind: "insight",
      title: refined[i]?.title || p.title,
      body: refined[i]?.body || p.body,
      data: { ...p.data, signal: p.kind, ticker: p.ticker },
    }));

    const { error: insertErr } = await adminClient
      .from("notifications")
      .insert(rows);

    if (insertErr) {
      console.error("[proactive-insights] insert err", insertErr);
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Best-effort push (single combined "you have N new insights"
    // ping rather than spamming N pushes — keeps the lock screen clean).
    try {
      await fetchTimeout(`${SUPABASE_URL}/functions/v1/send-push`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "apikey": SERVICE_KEY,
        },
        body: JSON.stringify({
          user_id: user.id,
          title: picks.length === 1 ? rows[0].title : "Nuevos insights de tu cartera",
          body: picks.length === 1
            ? rows[0].body
            : `${picks.length} señales accionables. Abrí la campana para verlas.`,
          data: { kind: "insight", count: picks.length },
        }),
      }, 4000).catch(() => {});
    } catch (_e) { /* ignore — inbox row is the durable record */ }

    return new Response(JSON.stringify({
      inserted: picks.length,
      summary: `${picks.length} insight${picks.length > 1 ? "s" : ""} generad${picks.length > 1 ? "os" : "o"}.`,
      kinds: picks.map((p) => p.kind),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[proactive-insights] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
