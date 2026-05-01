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

// Sentinel for the daily AI quota (samas-0.2.6). Free users get N
// user-initiated AI calls per UTC day. When this fires, callers
// dispatch samas:open-pro-upsell with reason="quota" so the Plus
// pricing sheet pops with quota-specific copy.
export class AIQuotaExceededError extends Error {
  constructor(payload = {}) {
    super("AI quota exceeded");
    this.name = "AIQuotaExceededError";
    this.count = payload.count ?? 0;
    this.limit = payload.limit ?? 5;
  }
}

async function gateOnConsent() {
  const ok = await ensureAIConsent();
  if (!ok) throw new AIConsentDeniedError();
}

// Atomic quota check + increment for user-initiated AI surfaces.
// Plus users always pass through (server returns allowed:true with
// is_plus:true and no limit). Free users hit the SQL function which
// atomically upserts the day's counter; if they're over the limit
// the increment is rolled back server-side so a blocked attempt
// doesn't burn future quota.
//
// On RPC failure (e.g. migration not run yet) we fail OPEN — the AI
// call proceeds. Better UX during rollout than blocking everyone
// when the migration hasn't landed in their environment.
async function gateOnQuota() {
  let allowed = true;
  let payload = null;
  try {
    const { data, error } = await supabase.rpc("consume_ai_quota");
    if (error) {
      // RPC missing or unreachable → fail open. Log only.
      console.warn("[ai-quota] consume_ai_quota error:", error.message);
      return;
    }
    if (data && data.allowed === false) {
      allowed = false;
      payload = { count: data.count, limit: data.limit };
    } else if (data) {
      // Successful consume → broadcast the new count so any mounted
      // QuotaPill / indicator can refresh without re-polling the RPC.
      payload = { count: data.count, limit: data.limit, isPlus: !!data.is_plus };
    }
  } catch (e) {
    // Network / transport issue → fail open.
    console.warn("[ai-quota] gate threw, failing open:", e?.message);
    return;
  }
  // Broadcast the change either way (consumed OR blocked) so indicators
  // re-render with the latest count from the server.
  try {
    window.dispatchEvent(new CustomEvent("samas:ai-quota-changed", {
      detail: payload || {},
    }));
  } catch (_) { /* SSR / no window */ }
  if (!allowed) {
    // Pop the Plus upsell modal globally before throwing so components
    // that just bubble the error up still trigger the conversion UX.
    try {
      window.dispatchEvent(new CustomEvent("samas:open-pro-upsell", {
        detail: { reason: "quota", count: payload?.count, limit: payload?.limit },
      }));
    } catch (_) { /* SSR / no window */ }
    throw new AIQuotaExceededError(payload || {});
  }
}

// Read-only quota status — used by UI to show "3/5 IA hoy" without
// consuming a credit. Returns { isPlus, count, limit } or null on
// failure. Components treat null as "data unavailable" and hide
// the indicator silently.
export async function getAIQuotaStatus() {
  try {
    const { data, error } = await supabase.rpc("get_ai_quota_status");
    if (error || !data) return null;
    return {
      isPlus: !!data.is_plus,
      count: Number(data.count) || 0,
      limit: data.limit == null ? null : Number(data.limit),
    };
  } catch (_e) { return null; }
}

// Activate Plus — prototype tap-to-flip. Production replaces this
// with server-side Apple IAP receipt verification.
export async function activatePlus() {
  const { data, error } = await supabase.rpc("activate_plus");
  if (error) throw new Error(`Plus activation falló: ${error.message}`);
  // Broadcast so any QuotaPill / indicator hides itself immediately
  // without waiting for the next render cycle.
  try {
    window.dispatchEvent(new CustomEvent("samas:ai-quota-changed", {
      detail: { isPlus: true, count: 0, limit: null },
    }));
  } catch (_) { /* SSR */ }
  return data;
}

// Cancel Plus — prototype tap-to-flip. Production: Apple StoreKit
// handles cancellation in iOS Settings → Subscriptions; we receive
// the DID-CHANGE-RENEWAL-STATUS webhook and flip is_plus server-side.
export async function cancelPlus() {
  const { data, error } = await supabase.rpc("cancel_plus");
  if (error) throw new Error(`Plus cancel falló: ${error.message}`);
  // Re-read current quota status so the indicator picks up the new
  // free-tier count immediately (server returns 0 since no calls
  // were made today as Plus, but be safe and broadcast unknown).
  try {
    const status = await getAIQuotaStatus();
    if (status) {
      window.dispatchEvent(new CustomEvent("samas:ai-quota-changed", {
        detail: status,
      }));
    }
  } catch (_) { /* ignore */ }
  return data;
}

// Helper for AI-calling components. Catches the two sentinels we
// expect: AIConsentDenied → silent (consent modal already explained)
// and AIQuotaExceeded → opens the Plus upsell modal globally and
// returns true so callers can no-op without surfacing an error toast.
// Returns false (= not handled) for other errors so the caller can
// surface them.
export function handleAIError(e) {
  if (!e) return false;
  if (e.name === "AIConsentDeniedError") return true;
  if (e.name === "AIQuotaExceededError") {
    try {
      window.dispatchEvent(new CustomEvent("samas:open-pro-upsell", {
        detail: { reason: "quota", count: e.count, limit: e.limit },
      }));
    } catch (_) { /* SSR / no window */ }
    return true;
  }
  return false;
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
  await gateOnQuota(); // user-initiated → counts toward daily limit
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
// chatPortfolio is quota'd per message. Each user prompt consumes
// one credit. Plus removes the cap.
export async function chatPortfolio({ messages }) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Mensajes requeridos.");
  }
  await gateOnConsent();
  await gateOnQuota(); // each chat message = 1 credit
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
// tradeCoach is FREE for both tiers (safety feature — runs at order
// confirmation, paywalling protection looks predatory).
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
 * scoreRisk() — POST /functions/v1/score-risk
 *
 * Server reads holdings, computes deterministic 1-10 risk score per
 * ticker (category baseline + volatility + concentration + drawdown),
 * asks Claude Haiku to refine the per-ticker reasons. Tickers + scores
 * stay deterministic so the LLM can't hallucinate them.
 *
 * Returns:
 *   {
 *     scores: { [ticker]: { score, level: "low"|"medium"|"high", reason } },
 *     summary: string,
 *     generatedAt: string,
 *   }
 */
export async function scoreRisk() {
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("score-risk", {
    body: {},
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Risk IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Risk IA falló: ${data.error}`);
  return data;
}

/**
 * quarterlyReview() — POST /functions/v1/quarterly-review
 *
 * Server reads holdings + orders for the trailing 90 days, computes
 * winners / losers / activity stats / sector mix, and asks Claude
 * to write a 3-4 paragraph markdown narrative + a 1-line headline.
 * Templated fallback when no API key (uses the same numbers, just
 * skeleton prose).
 *
 * Returns:
 *   {
 *     period: { from, to, days: 90 },
 *     stats:  { ... full computed stats ... },
 *     narrative: string,    // markdown
 *     headline:  string,
 *     generatedAt: string,
 *   }
 */
export async function quarterlyReview() {
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("quarterly-review", {
    body: {},
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Review IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Review IA falló: ${data.error}`);
  return data;
}

/**
 * validateThesis({ thesisId | ticker }) — POST /functions/v1/validate-thesis
 *
 * Server reads the user's active thesis for the ticker (or by id),
 * pulls current asset state + cost basis + recent news, asks Claude
 * to render a verdict ('holds' | 'weakened' | 'broken') with a
 * 1-2 sentence reason and an accionable suggestion. Caches the
 * verdict on the theses row so the AssetSheet can render the last
 * verdict without re-running the LLM.
 *
 * USER-INITIATED → consumes quota. Templated fallback when no API
 * key (verdict purely based on price move since cost basis).
 */
export async function validateThesis({ thesisId, ticker } = {}) {
  await gateOnConsent();
  await gateOnQuota();
  const { data, error } = await supabase.functions.invoke("validate-thesis", {
    body: { thesisId, ticker },
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Tesis IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Tesis IA falló: ${data.error}`);
  return data;
}

// Direct DB helpers for theses — these are NOT AI calls (no quota,
// no consent) so they go around the gate. RLS scopes to caller.
export async function saveThesis({ ticker, text }) {
  if (!ticker || !text || !text.trim()) throw new Error("ticker + text required");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");
  const { data, error } = await supabase
    .from("theses")
    .insert({ user_id: user.id, ticker: ticker.toUpperCase(), thesis_text: text.trim() })
    .select("id, ticker, thesis_text, status, last_verdict, last_reason, last_validated_at, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function getActiveThesis(ticker) {
  if (!ticker) return null;
  const { data, error } = await supabase
    .from("theses")
    .select("id, ticker, thesis_text, status, last_verdict, last_reason, last_validated_at, created_at")
    .eq("ticker", ticker.toUpperCase())
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * positionSize({ ticker, side }) — POST /functions/v1/position-size
 *
 * Server reads holdings + cash balance, computes 3 deterministic
 * position-size buckets (conservador / estandar / agresivo) for a
 * BUY, or 3 take-fractions (un_tercio / la_mitad / todo) for a SELL,
 * and returns:
 *   {
 *     suggestions: [{ label, displayLabel, qty, pctOfBook, valueUsd, rationale }, ...],
 *     summary: string,
 *     side: "buy" | "sell",
 *     generatedAt: string,
 *   }
 *
 * Numbers stay deterministic; Claude refines each rationale.
 * Templated fallback when no API key.
 */
export async function positionSize({ ticker, side = "buy" }) {
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("position-size", {
    body: { ticker, side },
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Sizing IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Sizing IA falló: ${data.error}`);
  return data;
}

/**
 * newsDigest() — POST /functions/v1/news-digest
 *
 * Server reads holdings, pulls cached articles for the top 5
 * weighted tickers, asks Claude to write a 2-3 sentence digest
 * naming concrete headlines + impact. Returns:
 *   {
 *     digest: string,
 *     headlines: [{ ticker, name, title, source, url, publishedAt, pctOfBook }, ...],
 *     coveredTickers: string[],
 *     generatedAt: string,
 *   }
 *
 * FREE in both tiers — auto-loaded surface, no quota consumed.
 * Templated fallback when no API key.
 */
export async function newsDigest() {
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("news-digest", {
    body: {},
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Digest IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Digest IA falló: ${data.error}`);
  return data;
}

/**
 * proactiveInsights() — POST /functions/v1/proactive-insights
 *
 * Server scans the user's holdings for actionable signals
 * (concentration, big drawdown, big gain, earnings soon, cash
 * drag), dedupes against the last 24h of inserted insights, and
 * writes up to 5 fresh notifications (kind='insight'). Returns:
 *   { inserted: number, summary: string, kinds: string[] }
 *
 * AI refines title + body for each insight; underlying signals
 * stay deterministic. Templated fallback when no API key.
 *
 * Designed to be called on-demand from the bell-icon inbox
 * "Refresh insights" button. Could also run from pg_cron daily
 * via service-role looping all users (future migration).
 */
// proactiveInsights consumes quota — manual "Generar" button on the
// inbox is user-initiated. (Future cron-driven daily push, when wired,
// will run server-side and won't consume client quota.)
export async function proactiveInsights() {
  await gateOnConsent();
  await gateOnQuota();
  const { data, error } = await supabase.functions.invoke("proactive-insights", {
    body: {},
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Insights IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Insights IA falló: ${data.error}`);
  return data;
}

/**
 * earningsWatch() — POST /functions/v1/earnings-watch
 *
 * Server reads the user's holdings, picks upcoming earnings dates
 * for held tickers (within 30 days) from a deterministic per-
 * ticker calendar, returns:
 *   {
 *     items: [{ ticker, name, daysOut, eventDate, pctOfBook, valueUsd, note }, ...],
 *     summary: string,
 *     generatedAt: string,
 *   }
 *
 * AI refines each note + the summary; tickers/dates/percentages
 * stay deterministic (server doesn't trust the LLM with the
 * numeric fields). Templated fallback when no API key.
 */
export async function earningsWatch() {
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("earnings-watch", {
    body: {},
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Earnings IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Earnings IA falló: ${data.error}`);
  return data;
}

/**
 * compareBenchmark() — POST /functions/v1/compare-benchmark
 *
 * Server reads holdings, computes value-weighted portfolio gain%,
 * compares to deterministic benchmark returns (Merval / S&P / BTC),
 * asks Claude Haiku for a 1-2 sentence verdict.
 *
 * Returns:
 *   {
 *     portfolio:   { gainPct, totalUsd },
 *     benchmarks:  [{ id, name, gainPct, beat }],
 *     verdict:     string,
 *     generatedAt: string,
 *   }
 *
 * Server-side templated fallback rotates verdict sentences based on
 * how many benchmarks the portfolio beats.
 */
export async function compareBenchmark() {
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("compare-benchmark", {
    body: {},
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Comparación IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Comparación IA falló: ${data.error}`);
  return data;
}

/**
 * dailyBrief() — POST /functions/v1/daily-brief
 *
 * Server reads the user's holdings, computes book total + weighted
 * day delta + top mover, and asks Claude Haiku for a "good morning"
 * 2-3 sentence brief that headlines the Wallet on every app open.
 *
 * Returns:
 *   {
 *     headline:    string,
 *     brief:       string,
 *     totalUsd:    number,
 *     gainPct:     number,
 *     topMover:    { ticker, changePct } | null,
 *     generatedAt: string,
 *   }
 *
 * Server-side templated fallback (deterministic sentence templates
 * with real numbers) when ANTHROPIC_API_KEY isn't set.
 */
export async function dailyBrief() {
  await gateOnConsent();
  const { data, error } = await supabase.functions.invoke("daily-brief", {
    body: {},
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Brief IA falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Brief IA falló: ${data.error}`);
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
// rebalancePortfolio consumes quota — heavyweight tap-to-run.
export async function rebalancePortfolio(profile = "balanced") {
  if (!["conservative", "balanced", "aggressive"].includes(profile)) {
    throw new Error("Perfil inválido.");
  }
  await gateOnConsent();
  await gateOnQuota();
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
// suggestWatchlist consumes quota — user types a theme + taps generate.
export async function suggestWatchlist(theme) {
  if (!theme || !theme.trim()) throw new Error("Indicá un tema.");
  await gateOnConsent();
  await gateOnQuota();
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
// explainNews consumes quota — per-article tap.
export async function explainNews({ title, summary, tickers, source }) {
  await gateOnConsent();
  await gateOnQuota();
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
// draftPost consumes quota — composer assistance is user-initiated.
export async function draftPost() {
  await gateOnConsent();
  await gateOnQuota();
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
// analyzeAsset consumes quota — deep AI analysis on a single asset,
// triggered by user tapping "Análisis IA" in the AssetSheet.
export async function analyzeAsset(ticker) {
  if (!ticker) throw new Error("Ticker requerido.");
  await gateOnConsent();
  await gateOnQuota();
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
