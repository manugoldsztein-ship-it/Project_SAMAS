// ============================================================
// suggest-watchlist — AI builds a watchlist around a theme
// ============================================================
// User types a theme ("AI infrastructure", "dividend stocks",
// "petróleo argentino", "bonos hard-dollar") and the function
// returns:
//   {
//     name:    string,         // suggested watchlist title (≤30 chars)
//     color:   "blue"|"green"|"amber"|"purple"|"red",
//     tickers: string[],       // 5-8 picks from the SAMAS asset universe
//     reason:  string,         // 1-2 sentence rationale, ≤180 chars
//   }
//
// FALLBACK
//   No API key → keyword-routed templated suggestions covering the
//   most common themes (AI/tech, dividend, energy, ETF).
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy suggest-watchlist
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

// Asset universe — same shape as broker.js, kept in sync by hand.
// Sent to the LLM as the menu of allowed tickers (so the model can't
// hallucinate something we don't trade) and used by the templated
// fallback for keyword routing.
const ASSETS: Record<string, { name: string; category: string; currency: string; }> = {
  AAPL: { name: "Apple",            category: "CEDEAR", currency: "USD" },
  NVDA: { name: "NVIDIA",           category: "CEDEAR", currency: "USD" },
  TSLA: { name: "Tesla",            category: "CEDEAR", currency: "USD" },
  MSFT: { name: "Microsoft",        category: "CEDEAR", currency: "USD" },
  GOOGL:{ name: "Alphabet",         category: "CEDEAR", currency: "USD" },
  GGAL: { name: "Grupo Galicia",    category: "ACCION", currency: "ARS" },
  YPF:  { name: "YPF",              category: "ACCION", currency: "ARS" },
  PAMP: { name: "Pampa Energía",    category: "ACCION", currency: "ARS" },
  IBIT:  { name: "iShares Bitcoin Trust", category: "CEDEAR", currency: "USD", price: 62.4 },
  COIN:  { name: "Coinbase", category: "CEDEAR", currency: "USD", price: 247.3 },
  MSTR:  { name: "MicroStrategy", category: "CEDEAR", currency: "USD", price: 358.4 },
  MARA:  { name: "Marathon Digital", category: "CEDEAR", currency: "USD", price: 18.2 },
  RIOT:  { name: "Riot Platforms", category: "CEDEAR", currency: "USD", price: 11.85 },
  AL30: { name: "Bonar 2030",       category: "BONO",   currency: "USD" },
  SPY:  { name: "S&P 500 ETF",      category: "ETF",    currency: "USD" },
  QQQ:  { name: "Nasdaq-100 ETF",   category: "ETF",    currency: "USD" },
  IWM:  { name: "Russell 2000 ETF", category: "ETF",    currency: "USD" },
  EWZ:  { name: "Brasil ETF",       category: "ETF",    currency: "USD" },
  GLD:  { name: "Oro (SPDR Gold)",  category: "COMMOD", currency: "USD" },
  SLV:  { name: "Plata (iShares)",  category: "COMMOD", currency: "USD" },
  USO:  { name: "Petróleo (USO)",   category: "COMMOD", currency: "USD" },
};

// Match the WL_COLORS palette in src/v2/Broker.jsx so the returned
// color id can be applied directly to the watchlists table.
const ALLOWED_COLORS = ["green", "blue", "purple", "pink", "orange", "red", "cyan", "lime"] as const;
type Color = typeof ALLOWED_COLORS[number];

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

// Templated fallback — keyword routing over the theme string.
function templatedWatchlist(theme: string) {
  const t = theme.toLowerCase();
  const TICKERS = Object.keys(ASSETS);

  // Check by category cluster first.
  if (/(\bai\b|inteligencia artificial|tech|tecno)/.test(t)) {
    return {
      name: "Tecnología & IA",
      color: "blue" as Color,
      tickers: ["NVDA", "MSFT", "GOOGL", "AAPL", "QQQ"],
      reason: "Mezcla de las grandes tech expuestas a la ola de IA + un ETF de Nasdaq-100 para ancho de exposición.",
    };
  }
  if (/(dividen|yield|renta)/.test(t)) {
    return {
      name: "Renta y dividendos",
      color: "green" as Color,
      tickers: ["AAPL", "MSFT", "AL30", "SPY", "GLD"],
      reason: "Posiciones grandes con historial de dividendos + bono soberano para piso de yield + ETF + oro como ancla.",
    };
  }
  // crypto/cripto theme removed in samas-0.4.21 — Cohen doesn't
  // operate crypto so we don't surface a watchlist for it. Falls
  // through to default templated picks below if user types it.
  if (/(petroleo|petróleo|energ|oil|combust)/.test(t)) {
    return {
      name: "Energía",
      color: "red" as Color,
      tickers: ["YPF", "PAMP", "USO"],
      reason: "Exposición local (Vaca Muerta vía YPF / PAMP) más un ETF de crudo USA para diversificar la apuesta energética.",
    };
  }
  if (/(arg|local|merval)/.test(t)) {
    return {
      name: "Argentina",
      color: "green" as Color,
      tickers: ["GGAL", "YPF", "PAMP", "AL30"],
      reason: "Las acciones líderes del Merval más el bono soberano dolar más líquido.",
    };
  }
  if (/(etf|index|índice|indice|pasiv)/.test(t)) {
    return {
      name: "ETFs core",
      color: "cyan" as Color,
      tickers: ["SPY", "QQQ", "IWM", "EWZ"],
      reason: "Exposición pasiva a EE.UU. (large + tech + small cap) más Brasil para diversificar geográficamente.",
    };
  }
  if (/(commod|oro|plata|gold|silver)/.test(t)) {
    return {
      name: "Commodities",
      color: "orange" as Color,
      tickers: ["GLD", "SLV", "USO"],
      reason: "Oro + plata como refugio + petróleo como ciclo. Los tres commodities líquidos del universo.",
    };
  }
  // Default — generic diversified pick.
  return {
    name: theme.slice(0, 30) || "Watchlist IA",
    color: "purple" as Color,
    tickers: TICKERS.slice(0, 6),
    reason: "Selección diversificada — no encontré un sesgo claro en el tema; ajustá manualmente desde acá.",
  };
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
      bucket: buildBucket("suggest-watchlist", { userId: user.id }),
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
    const theme = String(body?.theme || "").trim().slice(0, 200);
    if (!theme) {
      return new Response(JSON.stringify({ error: "theme requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- LLM path (or templated) ---
    if (!ANTHROPIC_API_KEY) {
      console.log(`[suggest-watchlist] no API key — templated for "${theme}"`);
      return new Response(JSON.stringify({
        ...templatedWatchlist(theme),
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const universeJson = Object.entries(ASSETS).map(([t, m]) => ({
      ticker: t, name: m.name, category: m.category, currency: m.currency,
    }));

    const userPrompt = [
      `Sos SAMAS, una asistente de inversiones para retail argentino. El usuario te pidió armar una watchlist sobre un tema. Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{`,
      `  "name":    "título corto, máximo 30 caracteres, en español",`,
      `  "color":   "green" | "blue" | "purple" | "pink" | "orange" | "red" | "cyan" | "lime",`,
      `  "tickers": ["array de 5 a 8 tickers, EXCLUSIVAMENTE del universo permitido"],`,
      `  "reason":  "1-2 oraciones explicando la lógica de la selección, máximo 180 caracteres"`,
      `}`,
      ``,
      `Reglas estrictas:`,
      `- Solo usá tickers del universo de abajo. NO inventes tickers nuevos.`,
      `- Si el tema no calza con ningún ticker disponible, elegí los más cercanos y explicalo en "reason".`,
      `- Voseo (vos), profesional, cero hype.`,
      `- Color razonable para el tema (verde para renta, ámbar para commodities, azul para tech, etc).`,
      ``,
      `Universo permitido:`,
      JSON.stringify(universeJson, null, 2),
      ``,
      `Tema del usuario: "${theme}"`,
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
        messages: [{ role: "user", content: userPrompt }],
      }),
    }, 12000);
    if (!r.ok) {
      console.warn(`[suggest-watchlist] anthropic ${r.status}`);
      return new Response(JSON.stringify({
        ...templatedWatchlist(theme),
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const json = await r.json();
    const text = json?.content?.[0]?.text || "";
    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: { name?: string; color?: string; tickers?: string[]; reason?: string };
    try { parsed = JSON.parse(stripped); } catch {
      console.warn("[suggest-watchlist] non-JSON response");
      return new Response(JSON.stringify({
        ...templatedWatchlist(theme),
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Validate + sanitize: tickers must come from our universe; bad
    // tickers get dropped, not silently substituted. Color must be in
    // the allow-list.
    const cleanTickers = (Array.isArray(parsed.tickers) ? parsed.tickers : [])
      .map((t) => String(t).toUpperCase().replace(/^\$/, "").trim())
      .filter((t) => t in ASSETS)
      .slice(0, 8);
    const color: Color = ALLOWED_COLORS.includes(parsed.color as Color)
      ? (parsed.color as Color) : "blue";
    if (cleanTickers.length === 0) {
      // Fallback to templated if the LLM didn't return any valid tickers.
      return new Response(JSON.stringify({
        ...templatedWatchlist(theme),
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      name:    String(parsed.name    || theme).slice(0, 30),
      color,
      tickers: cleanTickers,
      reason:  String(parsed.reason  || "").slice(0, 240),
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[suggest-watchlist] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
