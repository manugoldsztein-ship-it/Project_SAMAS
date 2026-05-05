// ============================================================
// journal-recap — Trade Journal recap + per-trade reflection
// ============================================================
// Two modes via the request body:
//
// 1. mode="recap"   (default): aggregate the user's trade_journal
//    entries from the last 90 days into a written recap with
//    batting average, top wins/losses, and a lessons-learned
//    summary. Used by the Profile / Trade Journal screen.
//
// 2. mode="reflect" + journal_id: generate an AI reflection for a
//    single closed trade. Updates trade_journal.reflection.
//
// Method: deterministic stats first, Claude Haiku writes the prose.
// Templated fallback when no API key.
//
// USER-INITIATED → consumes quota.
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  consumeRateLimit, RATE_LIMITS, buildBucket, rateLimit429, makeAdminClient,
} from "../_shared/rate-limit.ts";
import {
  readJsonBody, sanitizeString, validationErrorResponse,
} from "../_shared/validate.ts";

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

type JournalRow = {
  id: string;
  ticker: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  thesis_at_entry: string | null;
  reflection: string | null;
  outcome: string | null;
  realized_usd: number | null;
  occurred_at: string;
  closed_at: string | null;
};

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

async function recapMode(userClient: ReturnType<typeof createClient>) {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { data: rows } = await userClient
    .from("trade_journal")
    .select("*")
    .gte("occurred_at", ninetyDaysAgo)
    .order("occurred_at", { ascending: false })
    .limit(200);

  const entries: JournalRow[] = (rows as JournalRow[]) || [];
  const closed = entries.filter((e) => e.outcome && e.outcome !== "open");
  const wins   = closed.filter((e) => e.outcome === "gain");
  const losses = closed.filter((e) => e.outcome === "loss");
  const totalRealized = closed.reduce((s, e) => s + (Number(e.realized_usd) || 0), 0);
  const battingAvg = closed.length > 0 ? wins.length / closed.length : null;

  // Top wins / losses by absolute realized.
  const topWins = [...wins]
    .sort((a, b) => (Number(b.realized_usd) || 0) - (Number(a.realized_usd) || 0))
    .slice(0, 3);
  const topLosses = [...losses]
    .sort((a, b) => (Number(a.realized_usd) || 0) - (Number(b.realized_usd) || 0))
    .slice(0, 3);

  // Templated narrative (fallback or AI seed).
  const tt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
  const fallbackNarrative = closed.length === 0
    ? "Todavía no cerraste trades en los últimos 90 días. El diario espera tus primeros movimientos completos para empezar a generar lecciones."
    : `Cerraste ${closed.length} trades en los últimos 90 días. Win rate: ${battingAvg !== null ? Math.round(battingAvg * 100) : 0}%. P/L realizado: ${totalRealized >= 0 ? "+" : ""}US$${tt(totalRealized)}. ${wins.length} ganadores, ${losses.length} perdedores. ${battingAvg !== null && battingAvg >= 0.55 ? "Disciplina sólida — la mayoría jugaron a tu favor." : "El número no lo es todo: revisá QUÉ tesis fallaron y por qué."}`;

  let aiNarrative: string | null = null;
  if (ANTHROPIC_API_KEY && closed.length > 0) {
    const userPrompt = [
      `Sos SAMAS, un asistente financiero argentino. Generá un recap de 90 días del diario de trading de un usuario.`,
      ``,
      `Stats:`,
      `- Trades cerrados: ${closed.length}`,
      `- Win rate: ${battingAvg !== null ? (battingAvg * 100).toFixed(0) : 0}%`,
      `- P/L realizado: US$${tt(totalRealized)}`,
      `- Ganadores: ${wins.length} | Perdedores: ${losses.length}`,
      ``,
      `Top 3 ganadores: ${topWins.map((t) => `${t.ticker} (+US$${tt(Number(t.realized_usd) || 0)})`).join(", ") || "ninguno"}`,
      `Top 3 perdedores: ${topLosses.map((t) => `${t.ticker} (US$${tt(Number(t.realized_usd) || 0)})`).join(", ") || "ninguno"}`,
      ``,
      `Tesis cortas que el usuario escribió al entrar (sample):`,
      ...closed.slice(0, 6).map((e) => `- ${e.ticker}: "${(e.thesis_at_entry || "").slice(0, 120)}"`),
      ``,
      `Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{`,
      `  "headline":  "una oración que captura el período (≤80 caracteres)",`,
      `  "narrative": "3-4 oraciones (≤320 caracteres total) en castellano voseo: ¿qué tipo de trades te funcionaron mejor? ¿qué patrón se repite en las pérdidas? ¿qué cambiarías?",`,
      `  "lesson":    "una sola lección concreta y accionable (≤140 caracteres)"`,
      `}`,
      ``,
      `Tono: profesional pero cercano, sereno, sin hype. NO des recomendaciones de instrumentos. NO prometas resultados. Las lecciones son sobre PROCESO, no sobre tickers específicos.`,
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
          model: ANTHROPIC_MODEL, max_tokens: 600,
          messages: [{ role: "user", content: userPrompt }],
        }),
      }, 12000);
      if (r.ok) {
        const json = await r.json();
        const text = json?.content?.[0]?.text || "";
        const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
        const parsed = JSON.parse(stripped);
        aiNarrative = parsed?.narrative ? String(parsed.narrative).slice(0, 400) : null;
        return {
          stats: { closed: closed.length, wins: wins.length, losses: losses.length, battingAvg, totalRealized },
          headline:  parsed?.headline  ? String(parsed.headline).slice(0, 120)  : null,
          narrative: aiNarrative || fallbackNarrative,
          lesson:    parsed?.lesson    ? String(parsed.lesson).slice(0, 200)    : null,
          topWins, topLosses,
          generatedAt: new Date().toISOString(),
        };
      }
    } catch (_e) { /* fall through to templated */ }
  }

  return {
    stats: { closed: closed.length, wins: wins.length, losses: losses.length, battingAvg, totalRealized },
    headline:  null,
    narrative: aiNarrative || fallbackNarrative,
    lesson:    null,
    topWins, topLosses,
    generatedAt: new Date().toISOString(),
  };
}

async function reflectMode(userClient: ReturnType<typeof createClient>, journalId: string) {
  const { data: row } = await userClient
    .from("trade_journal")
    .select("*")
    .eq("id", journalId)
    .maybeSingle();
  const entry = row as JournalRow | null;
  if (!entry) {
    return { error: "journal entry not found" };
  }

  const tt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
  const fallback = entry.outcome === "gain"
    ? `Cerraste ${entry.ticker} con ganancia de US$${tt(Number(entry.realized_usd) || 0)}. La tesis funcionó. Vale la pena revisar si fue por las razones que escribiste o por momentum del mercado.`
    : entry.outcome === "loss"
    ? `Cerraste ${entry.ticker} con pérdida de US$${tt(Math.abs(Number(entry.realized_usd) || 0))}. ¿Qué cambió desde tu tesis original? ¿Era una tesis falsable de entrada, o un wishful thinking?`
    : `Cerraste ${entry.ticker} cerca del costo. Sin lecciones fuertes en el resultado, pero sí podés mirar el TIMING — ¿salió por convicción o por aburrimiento?`;

  let reflection = fallback;
  if (ANTHROPIC_API_KEY) {
    const prompt = [
      `Sos SAMAS, un asistente financiero argentino. Un usuario cerró un trade y querés ayudarlo a reflexionar:`,
      ``,
      `Ticker: ${entry.ticker}`,
      `Resultado: ${entry.outcome} (${entry.realized_usd != null ? "US$" + tt(Number(entry.realized_usd)) : "n/a"})`,
      `Tesis original: "${(entry.thesis_at_entry || "(sin tesis)").slice(0, 240)}"`,
      ``,
      `Devolvé un JSON con esta forma EXACTA:`,
      `{ "reflection": "2-3 oraciones (≤240 caracteres total) en voseo argentino, profesional y sereno, sin emojis. Ayudá al usuario a aprender del trade — preguntale si la tesis se cumplió por las razones correctas, qué cambiaría, qué patrón se repite." }`,
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
          model: ANTHROPIC_MODEL, max_tokens: 400,
          messages: [{ role: "user", content: prompt }],
        }),
      }, 10000);
      if (r.ok) {
        const json = await r.json();
        const text = json?.content?.[0]?.text || "";
        const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
        const parsed = JSON.parse(stripped);
        if (parsed?.reflection) reflection = String(parsed.reflection).slice(0, 400);
      }
    } catch (_e) { /* fall through */ }
  }

  // Persist reflection so the user can see it on next open without
  // re-burning quota.
  await userClient
    .from("trade_journal")
    .update({ reflection })
    .eq("id", journalId);

  return { reflection };
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

    const _rl = await consumeRateLimit(makeAdminClient(), {
      bucket: buildBucket("journal-recap", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    let _body: unknown = {};
    try {
      _body = await readJsonBody(req);
    } catch (e) {
      const ve = validationErrorResponse(e, corsHeaders);
      if (ve) return ve;
      throw e;
    }
    const body = (_body || {}) as Record<string, unknown>;
    const mode = sanitizeString(body.mode, 16) || "recap";

    if (mode === "reflect") {
      const journalId = sanitizeString(body.journal_id, 64);
      if (!journalId) {
        return new Response(JSON.stringify({ error: "journal_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const out = await reflectMode(userClient, journalId);
      return new Response(JSON.stringify(out), {
        status: out.error ? 404 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const out = await recapMode(userClient);
    return new Response(JSON.stringify(out), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[journal-recap] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
