// ============================================================
// explain-news — AI takes a news article + the caller's holdings,
// returns a 2-3 sentence "why does this matter for me" explanation.
// ============================================================
// Triggered when the user taps "¿Por qué me importa?" on any
// NewsCard. Runs against Claude Haiku with both the article and
// the user's portfolio in context.
//
// Request body:
//   {
//     title:   string,
//     summary: string,
//     tickers: string[],   // tickers Finnhub tagged on the article
//     source?: string
//   }
// Response:
//   {
//     relevant:   boolean,        // true if any article ticker matches a holding
//     hits:       string[],       // tickers the user owns that this article references
//     explanation: string,        // 2-3 sentences in Spanish
//     generatedAt: string,
//   }
//
// FALLBACK
//   No API key → templated explanation. Picks "you have a direct
//   position in $X" / "no direct exposure but related to..." based
//   on tickers + categories.
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy explain-news
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
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";

const ASSETS: Record<string, { name: string; category: string; }> = {
  AAPL: { name: "Apple",            category: "CEDEAR" },
  NVDA: { name: "NVIDIA",           category: "CEDEAR" },
  TSLA: { name: "Tesla",            category: "CEDEAR" },
  MSFT: { name: "Microsoft",        category: "CEDEAR" },
  GOOGL:{ name: "Alphabet",         category: "CEDEAR" },
  GGAL: { name: "Grupo Galicia",    category: "ACCION" },
  YPF:  { name: "YPF",              category: "ACCION" },
  PAMP: { name: "Pampa Energía",    category: "ACCION" },
  BTC:  { name: "Bitcoin",          category: "CRYPTO" },
  ETH:  { name: "Ethereum",         category: "CRYPTO" },
  AL30: { name: "Bonar 2030",       category: "BONO" },
  SPY:  { name: "S&P 500 ETF",      category: "ETF" },
  QQQ:  { name: "Nasdaq-100 ETF",   category: "ETF" },
  IWM:  { name: "Russell 2000 ETF", category: "ETF" },
  EWZ:  { name: "Brasil ETF",       category: "ETF" },
  GLD:  { name: "Oro (SPDR Gold)",  category: "COMMOD" },
  SLV:  { name: "Plata (iShares)",  category: "COMMOD" },
  USO:  { name: "Petróleo (USO)",   category: "COMMOD" },
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
      bucket: buildBucket("explain-news", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    // --- parse body ---
    let _body: unknown;
    try {
      _body = await readJsonBody(req);
    } catch (e) {
      const ve = validationErrorResponse(e, corsHeaders);
      if (ve) return ve;
      throw e;
    }
    const body = _body as Record<string, unknown>;
    const title = String(body?.title || "").slice(0, 300);
    const summary = String(body?.summary || "").slice(0, 1200);
    const tickers = Array.isArray(body?.tickers)
      ? body.tickers.map((t: unknown) => String(t).toUpperCase()).slice(0, 10)
      : [];
    if (!title) {
      return new Response(JSON.stringify({ error: "title requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- read holdings + compute hits (article tickers ∩ user tickers) ---
    const { data: holdings } = await userClient
      .from("holdings").select("ticker, qty").gt("qty", 0);
    const heldSet = new Set((holdings || []).map((h) => String(h.ticker).toUpperCase()));
    const hits = tickers.filter((t) => heldSet.has(t));
    const heldList = Array.from(heldSet);
    const heldNames = heldList.map((t) => ASSETS[t]?.name || t);
    const relevant = hits.length > 0;

    // --- LLM path (or templated) ---
    if (!ANTHROPIC_API_KEY) {
      console.log("[explain-news] no API key — templated explanation");
      let explanation = "";
      if (hits.length === 1) {
        const meta = ASSETS[hits[0]];
        explanation = `Tenés posición directa en $${hits[0]}${meta ? ` (${meta.name})` : ""}. Vale la pena mirar cómo esto puede mover el precio en tu cartera.`;
      } else if (hits.length > 1) {
        explanation = `Esta noticia toca ${hits.length} de tus posiciones (${hits.map((t) => `$${t}`).join(", ")}). Impacto directo en tu book.`;
      } else if (tickers.length > 0) {
        explanation = `No tenés exposición directa a ${tickers.slice(0, 3).map((t) => `$${t}`).join(", ")}, pero el sector puede arrastrar al mercado y afectar tus posiciones por correlación.`;
      } else {
        explanation = "No hay exposición directa en tu cartera. Útil como contexto de mercado, no como señal específica.";
      }
      return new Response(JSON.stringify({
        relevant, hits, explanation, generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userPrompt = [
      `Sos una asistente de inversiones para retail argentino. El usuario tocó "¿Por qué me importa?" en un artículo de noticias. Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{`,
      `  "explanation": "2-3 oraciones, máximo 280 caracteres total, en español"`,
      `}`,
      ``,
      `Reglas:`,
      `- Voseo (vos), profesional y cercano. Cero hype, cero emojis.`,
      `- Si el usuario tiene posiciones que esta noticia menciona directamente: explicá CÓMO podría afectarlas concretamente.`,
      `- Si no tiene exposición directa: explicá si hay correlación con su book (mismo sector, misma macro, etc.) o decí honestamente que no le aplica.`,
      `- No des recomendación de comprar/vender. Sí podés hablar de impacto en precio, sector, riesgo.`,
      ``,
      `Artículo:`,
      `  título: ${title}`,
      `  resumen: ${summary}`,
      `  tickers mencionados: ${tickers.length > 0 ? tickers.join(", ") : "(ninguno)"}`,
      ``,
      `Cartera del usuario: ${heldList.length > 0 ? heldList.map((t, i) => `${t} (${heldNames[i]})`).join(", ") : "(vacía)"}`,
      ``,
      `Hits (tickers del artículo que el usuario tiene): ${hits.length > 0 ? hits.join(", ") : "(ninguno)"}`,
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
      console.warn(`[explain-news] anthropic ${r.status}`);
      // Fallthrough to a generic templated reply so the UI still
      // gets something useful.
      return new Response(JSON.stringify({
        relevant, hits,
        explanation: relevant
          ? `Toca ${hits.map((t) => `$${t}`).join(", ")} en tu cartera.`
          : "No hay exposición directa. Contexto general.",
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const json = await r.json();
    const text = json?.content?.[0]?.text || "";
    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: { explanation?: string };
    try { parsed = JSON.parse(stripped); } catch { parsed = { explanation: text }; }
    return new Response(JSON.stringify({
      relevant, hits,
      explanation: String(parsed.explanation || "").slice(0, 400),
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[explain-news] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
