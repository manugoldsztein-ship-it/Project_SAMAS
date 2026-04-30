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
