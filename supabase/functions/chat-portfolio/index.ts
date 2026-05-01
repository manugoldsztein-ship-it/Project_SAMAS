// ============================================================
// chat-portfolio — multi-turn chat with the user's portfolio in
// context. The killer AI demo for the Cohen pitch.
// ============================================================
// Request body:
//   {
//     messages: Array<{ role: "user" | "assistant", content: string }>
//   }
// Response:
//   { reply: string }
//
// SECURITY
//   user_id derives from the verified JWT. The function reads the
//   caller's holdings + last 30 days of transactions via RLS-
//   scoped queries and injects them into a system prompt so Claude
//   has accurate context. It never echoes or transmits another
//   user's data.
//
// FALLBACK
//   When ANTHROPIC_API_KEY isn't set, returns a templated reply
//   based on keyword matching against the latest user message
//   (concentración / diversificar / vender / comprar / etc.) plus
//   real portfolio facts. Same response shape as the LLM so the
//   client doesn't branch.
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy chat-portfolio
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

// Asset metadata mirror — kept in sync with broker.js. Used to
// enrich holdings with name + category + current price for the
// Claude system prompt + the templated fallback.
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

type EnrichedHolding = {
  ticker: string; name: string; category: string;
  qty: number; avgCost: number;
  currentPrice: number; valueUsd: number;
  pctOfBook: number; gainPct: number;
};

// Templated reply when no Anthropic key. Keyword matching against
// the user's latest message + real portfolio facts.
function templatedReply(message: string, holdings: EnrichedHolding[]): string {
  const m = message.toLowerCase();
  if (holdings.length === 0) {
    return "Todavía no tenés posiciones activas. Empezá comprando algo desde el tab Mercado y volvé con la cartera armada — ahí puedo darte mucho más contexto.";
  }
  const totalUsd = holdings.reduce((acc, h) => acc + h.valueUsd, 0);
  const totalLabel = `US$${Math.round(totalUsd).toLocaleString("en-US")}`;
  const ranked = [...holdings].sort((a, b) => b.valueUsd - a.valueUsd);
  const top = ranked[0];
  const topPct = totalUsd > 0 ? (top.valueUsd / totalUsd) * 100 : 0;
  const sectorMap: Record<string, number> = {};
  for (const h of holdings) sectorMap[h.category] = (sectorMap[h.category] || 0) + h.valueUsd;
  const topSector = Object.entries(sectorMap).sort((a, b) => b[1] - a[1])[0];
  const sectorPct = totalUsd > 0 ? (topSector[1] / totalUsd) * 100 : 0;
  const sectorLabel: Record<string, string> = {
    CEDEAR: "CEDEARs", ACCION: "acciones argentinas", CRYPTO: "cripto",
    BONO: "bonos", ETF: "ETFs", COMMOD: "commodities",
  };
  const sectorName = sectorLabel[topSector[0]] || topSector[0].toLowerCase();
  const winners = holdings.filter((h) => h.gainPct > 0);
  const losers  = holdings.filter((h) => h.gainPct < 0);
  const weightedGain = totalUsd > 0
    ? holdings.reduce((acc, h) => acc + h.valueUsd * h.gainPct, 0) / totalUsd
    : 0;

  if (m.includes("concentr") || m.includes("diversif") || m.includes("riesgo")) {
    if (topPct > 40) {
      return `Tu cartera de ${totalLabel} tiene una concentración alta en ${top.ticker} (${topPct.toFixed(0)}%). Si esa posición se mueve fuerte, el book entero la siente. Considerá reducirla a menos del 30% si querés bajar el riesgo de concentración.`;
    }
    return `Tu cartera de ${totalLabel} está bastante repartida — el mayor peso es ${top.ticker} con ${topPct.toFixed(0)}%, y la categoría dominante es ${sectorName} con ${sectorPct.toFixed(0)}%. No veo concentración preocupante por ahora.`;
  }

  if (m.includes("ganancia") || m.includes("pnl") || m.includes("rendi") || m.includes("performance")) {
    return `Sobre ${totalLabel} de book, el retorno promedio ponderado es ${weightedGain >= 0 ? "+" : ""}${weightedGain.toFixed(1)}%. ${winners.length} posiciones en verde y ${losers.length} en rojo. Tu mejor posición hoy es ${ranked[0].ticker} con ${ranked[0].gainPct >= 0 ? "+" : ""}${ranked[0].gainPct.toFixed(1)}%.`;
  }

  if (m.includes("vender") || m.includes("vendo") || m.includes("salir")) {
    if (losers.length > 0) {
      const worst = [...losers].sort((a, b) => a.gainPct - b.gainPct)[0];
      return `No te puedo dar consejo de comprar/vender, pero te paso datos: tu peor posición es ${worst.ticker} con ${worst.gainPct.toFixed(1)}%. Antes de cerrarla, revisá si la tesis sigue intacta — caída de precio sin cambio de fundamentals puede ser oportunidad, no señal de salida.`;
    }
    return `No te puedo dar consejo de comprar/vender directo. Lo que sí veo: toda tu cartera está en verde hoy. Tomar ganancias parciales en la posición más grande (${top.ticker}, ${topPct.toFixed(0)}% del book) es una opción que muchos inversores usan para mantener disciplina.`;
  }

  if (m.includes("comprar") || m.includes("compro") || m.includes("agregar")) {
    return `No te puedo recomendar qué comprar, pero mirando tu cartera actual: estás con ${sectorPct.toFixed(0)}% en ${sectorName}. Para diversificar más podrías mirar otra categoría — si no tenés bonos o ETFs, esos son los más comunes para balancear.`;
  }

  if (m.includes("hola") || m.includes("buenas") || m.includes("hi") || m.length < 8) {
    return `¡Hola! Tu cartera tiene ${holdings.length} posiciones por ${totalLabel}. ¿Qué querés saber? Puedo hablarte de concentración, rendimiento, sectores, o de alguna posición puntual.`;
  }

  // Default catch-all — return a sensible portfolio summary.
  return `Tu cartera de ${totalLabel}: ${holdings.length} posiciones, mayor peso en ${top.ticker} (${topPct.toFixed(0)}%), categoría dominante ${sectorName} (${sectorPct.toFixed(0)}%). Retorno ponderado ${weightedGain >= 0 ? "+" : ""}${weightedGain.toFixed(1)}%. ¿Querés que profundice en alguna parte?`;
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
    const rl = await consumeRateLimit(makeAdminClient(), {
      bucket: buildBucket("chat-portfolio", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!rl.allowed) return rateLimit429(rl, corsHeaders);

    // --- parse body (size-checked) ---
    let body: { messages?: unknown };
    try {
      body = await readJsonBody(req) as { messages?: unknown };
    } catch (e) {
      const ve = validationErrorResponse(e, corsHeaders);
      if (ve) return ve;
      throw e;
    }
    const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
    // Sanitize each message: cap content to 2000 chars; reject any
    // role that isn't user/assistant.
    const messages = rawMessages
      .filter((m: unknown) => m && typeof m === "object")
      .map((m: { role?: unknown; content?: unknown }) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: sanitizeString(m.content, 2000),
      }))
      .filter((m: { content: string }) => m.content.length > 0);
    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Cap conversation history to last 12 turns to keep prompt size
    // bounded and Claude responsive. The system prompt + portfolio
    // context already takes ~2K tokens; 12 turns adds maybe another
    // 4-6K. Plenty of headroom under Haiku's context window.
    const trimmed = messages.slice(-12).filter((msg: { role: string; content: string }) =>
      msg && (msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string" && msg.content.trim()
    );
    const lastUser = [...trimmed].reverse().find((m) => m.role === "user");
    if (!lastUser) {
      return new Response(JSON.stringify({ error: "no hay mensaje del usuario" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- read holdings (RLS-scoped via JWT) ---
    const { data: holdings } = await userClient
      .from("holdings")
      .select("ticker, qty, avg_cost, currency");

    const enriched: EnrichedHolding[] = (holdings || [])
      .filter((h) => Number(h.qty) > 0)
      .map((h) => {
        const meta = ASSETS[h.ticker] || { name: h.ticker, category: "OTROS", currency: h.currency || "USD", price: Number(h.avg_cost) || 0, changePct: 0 };
        const qty = Number(h.qty) || 0;
        const avgCost = Number(h.avg_cost) || 0;
        const valueLocal = qty * meta.price;
        const valueUsd = meta.currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
        const gainPct = avgCost > 0 ? ((meta.price - avgCost) / avgCost) * 100 : 0;
        return {
          ticker: h.ticker, name: meta.name, category: meta.category,
          qty, avgCost,
          currentPrice: meta.price, valueUsd,
          pctOfBook: 0, gainPct,
        };
      });
    const totalUsd = enriched.reduce((acc, h) => acc + h.valueUsd, 0);
    enriched.forEach((h) => { h.pctOfBook = totalUsd > 0 ? (h.valueUsd / totalUsd) * 100 : 0; });

    // --- LLM path (or templated) ---
    if (!ANTHROPIC_API_KEY) {
      console.log("[chat-portfolio] no API key — templated reply");
      return new Response(JSON.stringify({
        reply: templatedReply(lastUser.content, enriched),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build the system prompt with portfolio context. We re-inject
    // it on every call so the model never operates on stale data
    // (the user might have placed a trade between turns).
    const portfolioJson = enriched.map((h) => ({
      ticker:     h.ticker,
      name:       h.name,
      category:   h.category,
      qty:        h.qty,
      currency:   h.category === "ACCION" ? "ARS" : "USD",
      valueUsd:   Math.round(h.valueUsd),
      pctOfBook:  Number(h.pctOfBook.toFixed(1)),
      gainPct:    Number(h.gainPct.toFixed(1)),
    }));

    const systemPrompt = [
      `Sos SAMAS, una asistente de inversiones que ayuda a un inversor argentino retail a entender su cartera.`,
      ``,
      `Reglas de comportamiento:`,
      `- Hablás voseo (vos), no usted.`,
      `- Profesional pero cercano. Cero hype, cero emojis, cero hashtags.`,
      `- Respuestas CORTAS — máximo 4 oraciones, idealmente 2-3.`,
      `- No das consejo legal, fiscal, ni recomendación directa de comprar/vender un activo. Sí podés discutir tesis, riesgo, concentración, sectores, performance.`,
      `- Cuando referencias un ticker en tu respuesta, usás formato $TICKER.`,
      `- Si te preguntan algo fuera de finanzas/inversiones, redirigí amablemente: "Eso está fuera de mi área — pero si querés hablamos de tu cartera."`,
      ``,
      `Cartera del usuario (valor total: US$${Math.round(totalUsd).toLocaleString("en-US")}):`,
      enriched.length > 0 ? JSON.stringify(portfolioJson, null, 2) : "(cartera vacía — sin posiciones activas)",
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
        max_tokens: 600,
        system: systemPrompt,
        messages: trimmed,
      }),
    }, 18000);
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn(`[chat-portfolio] anthropic ${r.status}:`, txt.slice(0, 300));
      // Soft-fail to templated.
      return new Response(JSON.stringify({
        reply: templatedReply(lastUser.content, enriched),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const json = await r.json();
    const reply = String(json?.content?.[0]?.text || "").trim();
    if (!reply) {
      return new Response(JSON.stringify({
        reply: templatedReply(lastUser.content, enriched),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ reply: reply.slice(0, 1200) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[chat-portfolio] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
