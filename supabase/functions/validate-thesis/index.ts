// ============================================================
// validate-thesis — IA verdict on whether a user's thesis still holds
// ============================================================
// Reads the user's active thesis for a given ticker (or by id), pulls
// the current asset state + recent news for that ticker, asks Claude
// to render a verdict ('holds' / 'weakened' / 'broken') with a 1-2
// sentence reason and an optional suggestion. Caches the verdict on
// the thesis row so re-opening the AssetSheet doesn't re-run the LLM.
//
// Request body:
//   { thesisId: string }   OR   { ticker: string }
// Response:
//   {
//     thesisId: string,
//     verdict:  "holds" | "weakened" | "broken",
//     reason:   string,
//     suggestion: string,
//     priceMoveSinceCreated: number | null,  // % change since thesis date
//     daysOld: number,
//     validatedAt: string,
//   }
//
// FALLBACK
//   No API key → templated verdict based purely on price move:
//     >= +5%  → 'holds' (the market agrees)
//     -5..+5% → 'holds' (no signal yet)
//     -15..-5% → 'weakened' (drawdown, watch)
//     < -15%  → 'broken' (rethink the call)
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy validate-thesis \
//     --project-ref diulqkaorfqccipguiok --no-verify-jwt
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

const ASSETS: Record<string, { name: string; category: string; currency: string; price: number; changePct: number; }> = {
  AAPL:  { name: "Apple",            category: "CEDEAR", currency: "USD", price: 215.40, changePct:  1.84 },
  NVDA:  { name: "NVIDIA",           category: "CEDEAR", currency: "USD", price: 892.15, changePct:  4.21 },
  TSLA:  { name: "Tesla",            category: "CEDEAR", currency: "USD", price: 248.30, changePct: -1.20 },
  MSFT:  { name: "Microsoft",        category: "CEDEAR", currency: "USD", price: 432.10, changePct:  0.74 },
  GOOGL: { name: "Alphabet",         category: "CEDEAR", currency: "USD", price: 184.20, changePct:  1.12 },
  META:  { name: "Meta Platforms",   category: "CEDEAR", currency: "USD", price: 568.40, changePct:  2.30 },
  AMZN:  { name: "Amazon",           category: "CEDEAR", currency: "USD", price: 198.20, changePct:  0.85 },
  KO:    { name: "Coca-Cola",        category: "CEDEAR", currency: "USD", price: 71.10, changePct:  0.30 },
  GGAL:  { name: "Grupo Galicia",    category: "ACCION", currency: "ARS", price: 4250,   changePct: -2.10 },
  YPF:   { name: "YPF",              category: "ACCION", currency: "ARS", price: 38500,  changePct:  3.45 },
  PAMP:  { name: "Pampa Energía",    category: "ACCION", currency: "ARS", price: 5820,   changePct:  0.92 },
  ALUA:  { name: "Aluar",            category: "ACCION", currency: "ARS", price: 1180,   changePct:  0.75 },
  SPY:   { name: "S&P 500 ETF",      category: "ETF",    currency: "USD", price: 542.30, changePct:  0.62 },
  QQQ:   { name: "Nasdaq-100 ETF",   category: "ETF",    currency: "USD", price: 478.20, changePct:  0.88 },
  AL30:  { name: "Bonar 2030",       category: "BONO",   currency: "USD", price: 58.30,  changePct:  0.40 },
  GD30:  { name: "Global 2030",      category: "BONO",   currency: "USD", price: 56.10,  changePct:  0.35 },
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
      bucket: buildBucket("validate-thesis", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    let _body: unknown;
    try {
      _body = await readJsonBody(req);
    } catch (e) {
      const ve = validationErrorResponse(e, corsHeaders);
      if (ve) return ve;
      throw e;
    }
    const body = _body as Record<string, unknown>;

    // --- find the thesis row ---
    let thesisRow;
    if (body?.thesisId) {
      const { data } = await userClient
        .from("theses")
        .select("id, ticker, thesis_text, status, created_at")
        .eq("id", body.thesisId)
        .single();
      thesisRow = data;
    } else if (body?.ticker) {
      const { data } = await userClient
        .from("theses")
        .select("id, ticker, thesis_text, status, created_at")
        .eq("ticker", String(body.ticker).toUpperCase())
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      thesisRow = data;
    }

    if (!thesisRow) {
      return new Response(JSON.stringify({ error: "thesis not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ticker = String(thesisRow.ticker).toUpperCase();
    const asset = ASSETS[ticker];
    if (!asset) {
      return new Response(JSON.stringify({ error: "ticker not in asset universe" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- read holding for cost basis ---
    const { data: holdingRow } = await userClient
      .from("holdings")
      .select("ticker, qty, avg_cost")
      .eq("ticker", ticker)
      .maybeSingle();

    const avgCost = Number(holdingRow?.avg_cost) || 0;
    const priceMoveSinceCreated = avgCost > 0
      ? ((asset.price - avgCost) / avgCost) * 100
      : null;
    const daysOld = Math.max(1, Math.floor(
      (Date.now() - new Date(thesisRow.created_at).getTime()) / (1000 * 60 * 60 * 24),
    ));

    // --- pull a few recent articles for ticker (best effort) ---
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: rawArticles } = await adminClient
      .from("articles")
      .select("title, summary, published_at")
      .eq("ticker", ticker)
      .order("published_at", { ascending: false })
      .limit(3);
    const articles = (rawArticles || []).map((a) => ({
      title: a.title,
      summary: (a.summary || "").slice(0, 200),
      publishedAt: a.published_at,
    }));

    // --- templated verdict (fallback) ---
    function templatedVerdict(): { verdict: string; reason: string; suggestion: string } {
      if (priceMoveSinceCreated == null) {
        return {
          verdict: "holds",
          reason: `Sin cost-basis aún para ${ticker}. La tesis sigue vigente, esperá la próxima señal de precio.`,
          suggestion: "Volvé después de tu primera compra.",
        };
      }
      const m = priceMoveSinceCreated;
      if (m >= 5) {
        return {
          verdict: "holds",
          reason: `${ticker} subió ${m.toFixed(1)}% desde tu compra (${daysOld} días). El mercado está dándole la razón a tu tesis.`,
          suggestion: "Mantené posición. Considerá una orden stop si la ganancia ya es material para vos.",
        };
      }
      if (m >= -5) {
        return {
          verdict: "holds",
          reason: `${ticker} se movió ${m.toFixed(1)}% en ${daysOld} días — sin señal clara todavía. Tu tesis sigue en pie.`,
          suggestion: "Dejá correr. Re-evaluá en 30 días o cuando publiquen earnings.",
        };
      }
      if (m >= -15) {
        return {
          verdict: "weakened",
          reason: `${ticker} cae ${Math.abs(m).toFixed(1)}% desde tu compra. La tesis sigue posible pero el mercado opina distinto en el corto plazo.`,
          suggestion: "Revisá si el motivo original sigue intacto. Si sí, mantené. Si no, considerá tax-loss harvesting.",
        };
      }
      return {
        verdict: "broken",
        reason: `${ticker} cae ${Math.abs(m).toFixed(1)}% desde tu compra (${daysOld} días). Drawdown material — el mercado está descontando algo que tu tesis no contemplaba.`,
        suggestion: "Releé tu tesis. Si los supuestos cambiaron, considerá cerrar la posición. Si no, suficiente conviction para promediar a la baja.",
      };
    }

    let verdict = "holds";
    let reason = "";
    let suggestion = "";

    if (ANTHROPIC_API_KEY) {
      const userPrompt = [
        `Sos SAMAS, asistente de inversiones para retail argentino. El usuario escribió esta tesis cuando compró ${ticker} (${asset.name}, ${asset.category}) hace ${daysOld} días:`,
        ``,
        `>>> "${thesisRow.thesis_text}" <<<`,
        ``,
        `Datos actuales:`,
        `- Precio actual: ${asset.price} ${asset.currency}`,
        `- Movimiento desde la compra: ${priceMoveSinceCreated == null ? "—" : `${priceMoveSinceCreated.toFixed(2)}%`}`,
        `- Variación diaria hoy: ${asset.changePct.toFixed(2)}%`,
        `- Categoría: ${asset.category}`,
        ``,
        articles.length > 0 ? `Titulares recientes:\n${JSON.stringify(articles, null, 2)}` : `Sin titulares recientes en cache.`,
        ``,
        `Devolvé un JSON con esta forma EXACTA, sin markdown:`,
        `{`,
        `  "verdict":    "holds" | "weakened" | "broken",`,
        `  "reason":     "1-2 oraciones, ≤180 caracteres",`,
        `  "suggestion": "1 oración accionable, ≤140 caracteres"`,
        `}`,
        ``,
        `Reglas:`,
        `- Voseo (vos), profesional, sereno. Cero hype, cero emojis.`,
        `- 'holds' = la tesis sigue funcionando o no hay datos en contra todavía`,
        `- 'weakened' = drawdown moderado o señales mixtas; vale revisar`,
        `- 'broken' = la tesis está rota; los supuestos no se sostienen contra los datos`,
        `- Mencioná al menos un dato concreto (% move, titular, días) en reason.`,
        `- En suggestion no des advice de "buy/sell" directa — usá lenguaje como "considerá", "revisá", "evaluá".`,
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
            model: ANTHROPIC_MODEL, max_tokens: 500,
            messages: [{ role: "user", content: userPrompt }],
          }),
        }, 12000);
        if (r.ok) {
          const json = await r.json();
          const text = json?.content?.[0]?.text || "";
          const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
          const parsed = JSON.parse(stripped);
          const v = String(parsed.verdict || "").toLowerCase();
          if (["holds", "weakened", "broken"].includes(v)) verdict = v;
          reason = String(parsed.reason || "").slice(0, 250);
          suggestion = String(parsed.suggestion || "").slice(0, 200);
        }
      } catch (_e) { /* fall through */ }
    }

    if (!reason) {
      const t = templatedVerdict();
      verdict = t.verdict;
      reason = t.reason;
      suggestion = t.suggestion;
    }

    // --- cache verdict on the thesis row (admin write so we don't
    //     fight RLS check constraints in production scenarios) ---
    const validatedAt = new Date().toISOString();
    await adminClient
      .from("theses")
      .update({
        last_verdict: verdict,
        last_reason: reason,
        last_validated_at: validatedAt,
        updated_at: validatedAt,
      })
      .eq("id", thesisRow.id)
      .eq("user_id", user.id);

    return new Response(JSON.stringify({
      thesisId: thesisRow.id,
      ticker,
      thesisText: thesisRow.thesis_text,
      verdict, reason, suggestion,
      priceMoveSinceCreated: priceMoveSinceCreated == null ? null : Number(priceMoveSinceCreated.toFixed(2)),
      daysOld,
      validatedAt,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[validate-thesis] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
