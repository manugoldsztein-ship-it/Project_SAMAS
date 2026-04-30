// ============================================================
// AI features — client wrappers around the analyze-portfolio
// Edge Function (samas-0.0.83) and any future AI Edge Functions.
// ============================================================
// Each function here wraps supabase.functions.invoke with the
// project's standard error handling: throw on transport / 5xx
// failures, throw on { error } payloads in 200 responses, return
// the data shape the server documented.
// ============================================================

import { supabase } from "./supabase.js";
import { ensureAIConsent } from "./aiConsent.js";

// Sentinel error so callers can distinguish "user said no thanks"
// from genuine API failures. UIs treat AIConsentDeniedError as
// silent (no error toast) — the consent modal already explained.
export class AIConsentDeniedError extends Error {
  constructor() { super("AI consent denied"); this.name = "AIConsentDeniedError"; }
}

async function gateOnConsent() {
  const ok = await ensureAIConsent();
  if (!ok) throw new AIConsentDeniedError();
}

/**
 * analyzePortfolio() — POST /functions/v1/analyze-portfolio
 *
 * Server reads the caller's holdings (via JWT-scoped RLS), passes
 * them to Claude Haiku, returns:
 *   {
 *     headline:      string,        // one-line summary
 *     bullets:       string[],      // ~3 observations
 *     suggestion:    string,        // one concrete next move
 *     concentration: string,        // dominant ticker / sector
 *     generatedAt:   string,        // ISO timestamp
 *   }
 *
 * Throws on auth failure, transport error, or AI provider down.
 * UI should catch and surface a friendly fallback.
 */
export async function analyzePortfolio() {
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("analyze-portfolio", {
    body: {},
  });
  if (error) {
    // Try to surface the server-side error message if the response
    // body had one — otherwise fall back to the generic transport msg.
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Análisis IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Análisis IA falló: ${data.error}`);
  return data;
}

/**
 * chatPortfolio({ messages }) — POST /functions/v1/chat-portfolio
 *
 * Multi-turn chat with the user's portfolio in context. Pass the
 * full message history so far (up to ~12 turns); server re-injects
 * holdings/transactions data on every call so the model always
 * sees the freshest book.
 *
 * @param {{ messages: Array<{ role: 'user'|'assistant', content: string }> }} input
 * @returns {Promise<{ reply: string }>}
 */
export async function chatPortfolio({ messages }) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Mensajes requeridos.");
  }
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("chat-portfolio", {
    body: { messages },
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Chat IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Chat IA falló: ${data.error}`);
  return data;
}

/**
 * tradeCoach({ ticker, side, qty, price }) — POST /functions/v1/trade-coach
 *
 * Server reads the user's holdings, weighs the pending trade against
 * the current book, returns:
 *   {
 *     verdict:  "go" | "caution" | "flag",
 *     headline: string,
 *     reason:   string,
 *     generatedAt: string,
 *   }
 *
 * Falls back to a deterministic heuristic verdict on the same shape
 * when the Anthropic key isn't set.
 */
export async function tradeCoach({ ticker, side, qty, price }) {
  if (!ticker || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
    throw new Error("Datos de operación inválidos.");
  }
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("trade-coach", {
    body: { ticker, side, qty, price },
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Coach IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Coach IA falló: ${data.error}`);
  return data;
}

/**
 * rebalancePortfolio(profile) — POST /functions/v1/rebalance-portfolio
 *
 * Reads the user's holdings + their requested risk profile
 * ('conservative' | 'balanced' | 'aggressive'), returns a list of
 * concrete buy/sell actions to move the book toward the target
 * category mix.
 *
 * Returns:
 *   {
 *     actions: [{ side, ticker, qty, currency, reason, estUsd }, ...],
 *     summary: string,
 *     targetMix: { CEDEAR: 30, ETF: 30, ... },     // % per category
 *     currentMix: { ... },
 *     generatedAt: string,
 *   }
 *
 * Server runs a deterministic algorithmic rebalance; when the
 * Anthropic key is set, Claude refines the rationale on each
 * action without changing tickers or quantities.
 */
export async function rebalancePortfolio(profile = "balanced") {
  if (!["conservative", "balanced", "aggressive"].includes(profile)) {
    throw new Error("Perfil inválido.");
  }
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("rebalance-portfolio", {
    body: { profile },
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Rebalanceo IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Rebalanceo IA falló: ${data.error}`);
  return data;
}

/**
 * suggestWatchlist(theme) — POST /functions/v1/suggest-watchlist
 *
 * Asks Claude Haiku to build a watchlist around a user-supplied
 * theme. Returns:
 *   {
 *     name:    string,                                       // ≤30 chars
 *     color:   "blue"|"green"|"amber"|"purple"|"red",
 *     tickers: string[],                                     // 5-8 from SAMAS universe
 *     reason:  string,                                       // 1-2 sentences
 *     generatedAt: string,
 *   }
 *
 * Server-side fallback uses keyword routing when the Anthropic key
 * isn't set, so the demo always returns a sensible suggestion.
 */
export async function suggestWatchlist(theme) {
  if (!theme || !theme.trim()) throw new Error("Indicá un tema.");
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("suggest-watchlist", {
    body: { theme: theme.trim() },
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Sugerencia IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Sugerencia IA falló: ${data.error}`);
  return data;
}

/**
 * explainNews({ title, summary, tickers }) — POST /functions/v1/explain-news
 *
 * Server reads the user's holdings, computes the intersection with
 * the article's tickers, and asks Claude Haiku for a 2-3 sentence
 * explanation of how the article relates to the user's portfolio.
 *
 * Returns:
 *   {
 *     relevant: boolean,        // true if any article ticker matches a holding
 *     hits: string[],           // tickers user owns that this article references
 *     explanation: string,      // 2-3 sentence Spanish explanation
 *     generatedAt: string,
 *   }
 *
 * Falls back to a templated explanation server-side when the
 * Anthropic key isn't set, so the demo always returns something.
 */
export async function explainNews({ title, summary, tickers, source }) {
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("explain-news", {
    body: { title, summary, tickers, source },
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Explicación IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Explicación IA falló: ${data.error}`);
  return data;
}

/**
 * draftPost() — POST /functions/v1/draft-post
 *
 * Server reads the caller's holdings + last few trade transactions
 * via JWT-scoped RLS, asks Claude Haiku to draft a SHORT social post
 * (max ~220 chars), returns:
 *   { draft: string, ticker?: string }
 *
 * Falls back to a templated draft built from real portfolio data
 * when the Anthropic key isn't set, so the demo always returns
 * something usable.
 */
export async function draftPost() {
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("draft-post", {
    body: {},
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Sugerencia IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Sugerencia IA falló: ${data.error}`);
  return data;
}

/**
 * analyzeAsset(ticker) — POST /functions/v1/analyze-asset
 *
 * Server reads asset metadata for the requested ticker, passes it
 * to Claude Haiku, returns:
 *   {
 *     headline:    string,
 *     bullets:     string[],   // ~3 observations
 *     thesis:      string,     // concrete takeaway
 *     sentiment:   "bullish" | "neutral" | "bearish",
 *     generatedAt: string,
 *   }
 *
 * Falls back to a templated insight server-side if the Anthropic
 * key isn't set, so the demo always returns a 200 with content.
 */
export async function analyzeAsset(ticker) {
  if (!ticker) throw new Error("Ticker requerido.");
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("analyze-asset", {
    body: { ticker: String(ticker).toUpperCase() },
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Análisis IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Análisis IA falló: ${data.error}`);
  return data;
}
