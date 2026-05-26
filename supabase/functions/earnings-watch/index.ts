// ============================================================
// earnings-watch — upcoming earnings + AI position-impact note
// ============================================================
// Reads the user's holdings, picks the upcoming earnings dates for
// held tickers from a deterministic per-ticker calendar (synthetic
// for the prototype — would come from a market-data API in
// production), returns up to 5 closest events with:
//   - countdown days
//   - position size (% of book, est USD value)
//   - AI-written one-line note about what to watch
//
// Request body: {}
// Response:
//   {
//     items: [
//       {
//         ticker:    string,
//         name:      string,
//         daysOut:   number,           // 0 = today, 1 = tomorrow, ...
//         eventDate: string,            // ISO YYYY-MM-DD
//         pctOfBook: number,
//         valueUsd:  number,
//         note:      string,            // 1 sentence AI/templated
//       },
//       ...
//     ],
//     summary:    string,                // 1-line overview
//     generatedAt: string,
//   }
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy earnings-watch
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

const ASSETS: Record<string, { name: string; category: string; currency: string; price: number; }> = {
  AAPL: { name: "Apple",            category: "CEDEAR", currency: "USD", price: 215.40 },
  NVDA: { name: "NVIDIA",           category: "CEDEAR", currency: "USD", price: 892.15 },
  TSLA: { name: "Tesla",            category: "CEDEAR", currency: "USD", price: 248.30 },
  MSFT: { name: "Microsoft",        category: "CEDEAR", currency: "USD", price: 432.10 },
  GOOGL:{ name: "Alphabet",         category: "CEDEAR", currency: "USD", price: 184.20 },
  GGAL: { name: "Grupo Galicia",    category: "ACCION", currency: "ARS", price: 4250 },
  YPF:  { name: "YPF",              category: "ACCION", currency: "ARS", price: 38500 },
  PAMP: { name: "Pampa Energía",    category: "ACCION", currency: "ARS", price: 5820 },
  MMARS:  { name: "SAMAS Money Market ARS", category: "FCI", currency: "ARS", price: 100.42 },
  MMUSD:  { name: "SAMAS Money Market USD", category: "FCI", currency: "USD", price: 102.18 },
  RFAR:  { name: "SAMAS Renta Fija", category: "FCI", currency: "USD", price: 105.83 },
  MIXTO:  { name: "SAMAS Mixta", category: "FCI", currency: "USD", price: 112.4 },
  EQUITY:  { name: "SAMAS Renta Variable", category: "FCI", currency: "USD", price: 128.95 },
  IBIT:  { name: "iShares Bitcoin Trust", category: "CEDEAR", currency: "USD", price: 62.4 },
  COIN:  { name: "Coinbase", category: "CEDEAR", currency: "USD", price: 247.3 },
  MSTR:  { name: "MicroStrategy", category: "CEDEAR", currency: "USD", price: 358.4 },
  MARA:  { name: "Marathon Digital", category: "CEDEAR", currency: "USD", price: 18.2 },
  RIOT:  { name: "Riot Platforms", category: "CEDEAR", currency: "USD", price: 11.85 },
};

const ARS_TO_USD = 1 / 1245;

// Deterministic per-ticker offsets (days from "now") that fall in
// the 1-30 day window we want to show in the watch list. Hand-picked
// so the demo always has 3-5 upcoming earnings if the user holds a
// reasonable mix. Update annually as earnings cycles roll over.
//
// In production these come from a market-data API (Finnhub,
// Polygon, etc.). For the prototype + Cohen demo, deterministic
// synthetic gives us a stable, believable demo state.
const EARNINGS_OFFSETS_DAYS: Record<string, number> = {
  AAPL: 4,
  NVDA: 12,
  TSLA: 7,
  MSFT: 28,
  GOOGL: 30,
  GGAL: 18,
  YPF: 22,
  PAMP: 35,   // > 30 days → filtered out below
};

// Average post-earnings move per ticker (absolute %). Used in the
// templated note to give the user a sense of expected volatility.
// Values reflect typical historical implied / realized moves.
const EARNINGS_AVG_MOVE: Record<string, number> = {
  AAPL: 4.2,
  NVDA: 7.8,
  TSLA: 9.5,
  MSFT: 3.6,
  GOOGL: 4.4,
  GGAL: 5.0,
  YPF: 6.5,
  PAMP: 4.8,
};

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

function isoDateNDaysOut(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type EnrichedItem = {
  ticker: string;
  name: string;
  daysOut: number;
  eventDate: string;
  pctOfBook: number;
  valueUsd: number;
  qty: number;
  avgMove: number;
};

// Templated one-line note built from real position data. Picks one
// of a few angles so consecutive items don't read identically.
function templatedNote(item: EnrichedItem): string {
  const sign = (n: number) => `±${n.toFixed(1)}%`;
  if (item.daysOut === 0) {
    return `Hoy reporta. Movimiento esperado ${sign(item.avgMove)}, tenés ${item.pctOfBook.toFixed(0)}% del book acá.`;
  }
  if (item.daysOut === 1) {
    return `Mañana reporta. Histórico: mueve ${sign(item.avgMove)} post-earnings. Tu posición es ${item.pctOfBook.toFixed(0)}% del book.`;
  }
  if (item.pctOfBook >= 25) {
    return `${item.pctOfBook.toFixed(0)}% de tu cartera está en este ticker. Movimiento ${sign(item.avgMove)} histórico — impacto material si reportan distinto a lo esperado.`;
  }
  if (item.pctOfBook < 5) {
    return `Posición chica (${item.pctOfBook.toFixed(0)}% del book). Volatilidad histórica ${sign(item.avgMove)}, impacto limitado en tu PnL.`;
  }
  return `Posición ${item.pctOfBook.toFixed(0)}% del book. Movimiento histórico ${sign(item.avgMove)} post-earnings.`;
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
      bucket: buildBucket("earnings-watch", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    // --- read holdings ---
    const { data: rawHoldings } = await userClient
      .from("holdings").select("ticker, qty").gt("qty", 0);
    const holdings = (rawHoldings || []).map((h) => {
      const meta = ASSETS[h.ticker];
      const qty = Number(h.qty) || 0;
      const valueLocal = meta ? qty * meta.price : 0;
      const valueUsd = meta?.currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
      return {
        ticker: h.ticker,
        name: meta?.name || h.ticker,
        qty,
        valueUsd,
        hasEarnings: h.ticker in EARNINGS_OFFSETS_DAYS,
      };
    });

    if (holdings.length === 0) {
      return new Response(JSON.stringify({
        items: [],
        summary: "Sin posiciones para vigilar todavía. Volvé después de tu primera compra.",
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const totalUsd = holdings.reduce((acc, h) => acc + h.valueUsd, 0);

    // Build the upcoming-earnings list — only tickers with a
    // calendar entry in the 1-30 day window.
    const items: EnrichedItem[] = holdings
      .filter((h) => h.hasEarnings)
      .map((h) => {
        const offset = EARNINGS_OFFSETS_DAYS[h.ticker];
        return {
          ticker:    h.ticker,
          name:      h.name,
          daysOut:   offset,
          eventDate: isoDateNDaysOut(offset),
          pctOfBook: totalUsd > 0 ? (h.valueUsd / totalUsd) * 100 : 0,
          valueUsd:  h.valueUsd,
          qty:       h.qty,
          avgMove:   EARNINGS_AVG_MOVE[h.ticker] || 5,
        };
      })
      .filter((it) => it.daysOut >= 0 && it.daysOut <= 30)
      .sort((a, b) => a.daysOut - b.daysOut)
      .slice(0, 5);

    if (items.length === 0) {
      return new Response(JSON.stringify({
        items: [],
        summary: "Ninguna de tus posiciones reporta resultados en los próximos 30 días. Tranquilo.",
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- LLM path (or templated) ---
    if (!ANTHROPIC_API_KEY) {
      const itemsWithNotes = items.map((it) => ({
        ticker: it.ticker, name: it.name,
        daysOut: it.daysOut, eventDate: it.eventDate,
        pctOfBook: Number(it.pctOfBook.toFixed(1)),
        valueUsd: Math.round(it.valueUsd),
        note: templatedNote(it),
      }));
      const summary = items.length === 1
        ? `${items[0].ticker} reporta en ${items[0].daysOut === 0 ? "hoy" : items[0].daysOut === 1 ? "mañana" : `${items[0].daysOut} días`}.`
        : `${items.length} posiciones reportan en los próximos 30 días. La más cerca: ${items[0].ticker} en ${items[0].daysOut === 0 ? "hoy" : items[0].daysOut === 1 ? "mañana" : `${items[0].daysOut} días`}.`;
      return new Response(JSON.stringify({
        items: itemsWithNotes, summary,
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // LLM-enhanced version: ask Claude to refine each note + the
    // top-line summary. Tickers + dates + numbers stay deterministic
    // (we send them in, expect them back unchanged).
    const itemsForPrompt = items.map((it, i) => ({
      i,
      ticker: it.ticker,
      name: it.name,
      daysOut: it.daysOut,
      pctOfBook: Number(it.pctOfBook.toFixed(1)),
      qty: it.qty,
      valueUsd: Math.round(it.valueUsd),
      avgHistMovePct: it.avgMove,
    }));

    const userPrompt = [
      `Sos SAMAS, asistente de inversiones para retail argentino. Tenés una lista de earnings próximos para las posiciones del usuario. Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{`,
      `  "summary": "1 oración resumen, máximo 130 caracteres",`,
      `  "notes":   ["array con la note refinada para cada item, en el MISMO orden, máximo 130 caracteres cada una"]`,
      `}`,
      ``,
      `Reglas:`,
      `- Voseo (vos), profesional y cercano. Cero emojis, cero hype.`,
      `- En cada note mencioná concretamente: cuándo (días), tamaño relativo de la posición (% del book), volatilidad histórica esperada, y un ángulo accionable.`,
      `- "notes" debe tener exactamente ${items.length} elementos.`,
      `- No hablás de "buy/sell" directamente.`,
      ``,
      `Lista de earnings:`,
      JSON.stringify(itemsForPrompt, null, 2),
    ].join("\n");

    const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL, max_tokens: 700,
        messages: [{ role: "user", content: userPrompt }],
      }),
    }, 12000);
    if (!r.ok) {
      const itemsWithNotes = items.map((it) => ({
        ticker: it.ticker, name: it.name,
        daysOut: it.daysOut, eventDate: it.eventDate,
        pctOfBook: Number(it.pctOfBook.toFixed(1)),
        valueUsd: Math.round(it.valueUsd),
        note: templatedNote(it),
      }));
      return new Response(JSON.stringify({
        items: itemsWithNotes,
        summary: `${items.length} posición${items.length > 1 ? "es" : ""} con earnings en los próximos 30 días.`,
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const json = await r.json();
    const text = json?.content?.[0]?.text || "";
    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: { summary?: string; notes?: string[] };
    try { parsed = JSON.parse(stripped); } catch { parsed = {}; }

    const itemsWithNotes = items.map((it, i) => ({
      ticker: it.ticker, name: it.name,
      daysOut: it.daysOut, eventDate: it.eventDate,
      pctOfBook: Number(it.pctOfBook.toFixed(1)),
      valueUsd: Math.round(it.valueUsd),
      note: (Array.isArray(parsed.notes) && parsed.notes[i])
        ? String(parsed.notes[i]).slice(0, 200)
        : templatedNote(it),
    }));

    return new Response(JSON.stringify({
      items: itemsWithNotes,
      summary: String(parsed.summary || `${items.length} posición${items.length > 1 ? "es" : ""} con earnings en los próximos 30 días.`).slice(0, 200),
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[earnings-watch] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
