// ============================================================
// behavior-watch — detect toxic trading patterns + suggest a pause
// ============================================================
// Inverts the Robinhood model: SAMAS profits from users staying
// healthy and disciplined, not from churn / overtrading. This
// function looks at the user's last 30 days of transactions and
// flags patterns that an AR senior asesor would call out:
//
//   - overtrading: >N orders / day vs their baseline
//   - revenge:    sell-at-loss followed by buy within <60 min
//   - fomo:       buy after a +5% move on the same ticker
//   - panic:      sell during a heavy red session
//   - drift:      zero activity 60+ days (kind reminder)
//
// Detection is deterministic (rule-based on transactions); Claude
// Haiku optionally generates a personalized empathetic message
// per detected pattern. If ANTHROPIC_API_KEY is unset, we use a
// templated message so the demo works offline.
//
// USER-INITIATED: consumes quota when called from the Wallet
// BehaviorCard (samas-0.4.28). Cron version for proactive pushes
// is a follow-up.
//
// HOW TO DEPLOY
//   supabase functions deploy behavior-watch \
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

type Pattern = "overtrading" | "revenge" | "fomo" | "panic" | "drift";
type Alert = {
  pattern: Pattern;
  severity: "low" | "medium" | "high";
  reason: string;          // factual observation
  message: string;         // empathetic line for the user
  suggestion: string;      // concrete action
};

type Txn = {
  id?: string | number;
  ticker?: string | null;
  amount?: number | null;     // signed; negative for buys, positive for sells in our ledger
  qty?: number | null;
  side?: "buy" | "sell" | null;
  occurred_at?: string;
  created_at?: string;
};

function parseDate(t: Txn): number {
  const s = t.occurred_at || t.created_at;
  if (!s) return 0;
  const n = Date.parse(s);
  return isFinite(n) ? n : 0;
}

function detectPatterns(txns: Txn[]): Alert[] {
  const alerts: Alert[] = [];
  if (!txns || txns.length === 0) {
    // No activity — kindly nudge if we know they've been around
    // long enough that "no activity" is meaningful. We surface
    // this as a "drift" pattern (low severity).
    alerts.push({
      pattern: "drift",
      severity: "low",
      reason: "Sin operaciones recientes.",
      message: "Tomate tu tiempo. Una buena cartera no se construye con prisa — pero tampoco con olvido. Cuando estés listo, revisá tu plan.",
      suggestion: "Ver mi plan en Objetivos",
    });
    return alerts;
  }

  // Sort newest-first.
  const sorted = [...txns].sort((a, b) => parseDate(b) - parseDate(a));
  const now = Date.now();
  const trades = sorted.filter((t) => t.ticker && (t.side === "buy" || t.side === "sell"));

  // OVERTRADING — count trades in last 7 days. If >12 (avg ~2/day),
  // flag.
  const weekAgo = now - 7 * 24 * 3600 * 1000;
  const last7 = trades.filter((t) => parseDate(t) >= weekAgo);
  if (last7.length >= 12) {
    alerts.push({
      pattern: "overtrading",
      severity: last7.length >= 20 ? "high" : "medium",
      reason: `${last7.length} operaciones en los últimos 7 días.`,
      message: "Operás más de lo habitual. La estadística dice que más turnover suele bajar tu rendimiento neto, no subirlo. Acordate de tu tesis original.",
      suggestion: "Pausa de 24h antes de la próxima operación",
    });
  }

  // REVENGE — sell-at-loss followed by buy within 60min on a different ticker.
  // We don't have explicit P/L in the ledger, so we approximate "sell at loss"
  // as any sell — and look for buys that follow within 60 minutes.
  // Conservative: only fires if it happened TWICE in the last 14 days.
  let revengeCount = 0;
  for (let i = 0; i < trades.length - 1; i++) {
    const a = trades[i + 1]; // older
    const b = trades[i];     // newer
    if (a.side === "sell" && b.side === "buy" && a.ticker !== b.ticker) {
      const dt = parseDate(b) - parseDate(a);
      if (dt > 0 && dt < 60 * 60 * 1000 && parseDate(a) > now - 14 * 24 * 3600 * 1000) {
        revengeCount++;
      }
    }
  }
  if (revengeCount >= 2) {
    alerts.push({
      pattern: "revenge",
      severity: "medium",
      reason: `${revengeCount} ventas seguidas de compras en menos de 1 hora, en activos distintos, en las últimas 2 semanas.`,
      message: "Cerrar una posición y abrir otra al toque suele ser revenge trading — buscar compensar la última con la próxima. Esa es la decisión más cara de un retail.",
      suggestion: "Esperá una hora antes de la próxima compra",
    });
  }

  // FOMO — buy after a +5% rally. We don't have intraday price history
  // in the ledger; use a simple proxy: 3+ buys in the same week, all on
  // tickers that the user didn't hold a month ago. Approximate.
  const monthAgo = now - 30 * 24 * 3600 * 1000;
  const recentBuys = trades.filter((t) => t.side === "buy" && parseDate(t) >= weekAgo);
  if (recentBuys.length >= 3) {
    const newTickers = new Set(recentBuys.map((t) => t.ticker as string));
    const oldHoldings = new Set(
      trades.filter((t) => t.side === "buy" && parseDate(t) < monthAgo).map((t) => t.ticker as string)
    );
    const newOnly = [...newTickers].filter((t) => !oldHoldings.has(t));
    if (newOnly.length >= 3) {
      alerts.push({
        pattern: "fomo",
        severity: "low",
        reason: `${newOnly.length} compras nuevas en la última semana (tickers que no operabas el mes pasado).`,
        message: "Diversificación es bueno. Comprar 3+ tickers nuevos en una semana puede ser FOMO. ¿Tenés tesis para cada uno o es momentum del mercado?",
        suggestion: "Escribí una tesis para cada nueva posición",
      });
    }
  }

  // PANIC — 3+ sells in a single day. Strong signal.
  const byDay = new Map<string, Txn[]>();
  for (const t of trades) {
    if (t.side !== "sell") continue;
    const d = parseDate(t);
    if (d < monthAgo) continue;
    const dayKey = new Date(d).toISOString().slice(0, 10);
    const arr = byDay.get(dayKey) || [];
    arr.push(t);
    byDay.set(dayKey, arr);
  }
  for (const [, sells] of byDay) {
    if (sells.length >= 3) {
      alerts.push({
        pattern: "panic",
        severity: "high",
        reason: `${sells.length} ventas en un solo día.`,
        message: "Vender 3+ activos en un día casi nunca es estratégico — suele ser pánico. Si pasó hace poco, está bien aceptar que pasó. Lo importante: ¿por qué? ¿La tesis original cambió?",
        suggestion: "Anotá qué te llevó a vender. Releé en 1 mes.",
      });
      break; // One panic alert is enough; no need to repeat per day.
    }
  }

  return alerts;
}

async function refineWithAI(alerts: Alert[]): Promise<Alert[]> {
  if (!ANTHROPIC_API_KEY || alerts.length === 0) return alerts;
  const userPrompt = [
    `Sos SAMAS, un asistente financiero argentino. Un usuario tiene los siguientes patrones detectados en sus operaciones recientes:`,
    ``,
    ...alerts.map((a, i) => `${i + 1}. ${a.pattern}: ${a.reason}`),
    ``,
    `Devolvé un JSON con esta forma EXACTA, sin markdown:`,
    `{`,
    `  "messages": [`,
    `    "una oración empática de máximo 140 caracteres por cada patrón, en orden",`,
    `    "..."`,
    `  ]`,
    `}`,
    ``,
    `Tono: profesional pero cercano (vos), sereno, sin hype, sin sermones.`,
    `Esto NO es asesoramiento financiero. Es un nudge gentil para que el usuario pause y reflexione.`,
    `No prometas resultados ni des recomendaciones de instrumentos.`,
    `Voseo argentino. Cero emojis.`,
  ].join("\n");

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 600,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    clearTimeout(tid);
    if (!r.ok) return alerts;
    const json = await r.json();
    const text = json?.content?.[0]?.text || "";
    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(stripped);
    const msgs: string[] = Array.isArray(parsed?.messages) ? parsed.messages : [];
    return alerts.map((a, i) => {
      const m = msgs[i];
      return m && typeof m === "string" && m.length > 10
        ? { ...a, message: m.slice(0, 240) }
        : a;
    });
  } catch (_e) {
    return alerts;
  }
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
      bucket: buildBucket("behavior-watch", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    // Read transactions via RLS-scoped client (auth.uid() filters
    // automatically). 90-day window so we can compute baselines.
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const { data: txns } = await userClient
      .from("transactions")
      .select("id, ticker, amount, qty, side, occurred_at, created_at")
      .gte("created_at", ninetyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(500);

    let alerts = detectPatterns(txns || []);
    alerts = await refineWithAI(alerts);

    return new Response(JSON.stringify({
      alerts,
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[behavior-watch] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
