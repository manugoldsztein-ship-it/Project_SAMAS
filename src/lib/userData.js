// ============================================================
// USER DATA — Supabase ↔ React glue for portfolio state
// ============================================================
// Until now `holdings`, `orders`, and `balance` lived in
// localStorage (cache only). This module lifts them into Supabase
// so the same user sees the same data across devices.
//
// Shape mismatch:
//   - LocalStorage holdings: [{ ticker, qty, avg }, ...]
//   - DB holdings: { user_id, ticker, qty, avg_cost, currency, updated_at }
//   - LocalStorage orders:  [{ ticker, side, qty, price }, ...]   (append-only,
//      newest first)
//   - DB orders: { id, user_id, ticker, side, qty, price, currency,
//      status, created_at, ... }
//   - LocalStorage balance: number (ARS)
//   - DB accounts: { user_id, currency, balance, updated_at }
//
// We translate at the edges. Local format stays the same so the
// rest of the UI doesn't change.
//
// Strategy: localStorage acts as the synchronous cache for instant
// renders. On mount (once we know the user) we load from DB and
// override local. On every change we fire-and-forget a write to DB.
// If the network drops, local stays consistent; when it comes back
// the next change will sync.
// ============================================================

import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase";

const ARS = "ARS";

// -----------------------------------------------------------
// RAW-FETCH HELPERS — used by all profile-column writes below
// because the SDK's `.from('profiles').update(...)` builder
// occasionally hangs on this build (same workaround as the
// ui_mode toggle and 2FA enroll). Wrapping fetch with
// AbortController surfaces a real failure instead of an
// indefinite spinner.
// -----------------------------------------------------------
async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function authToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

async function patchProfile(userId, patch) {
  const token = await authToken();
  if (!token) throw new Error("No hay sesión activa.");
  const resp = await fetchWithTimeout(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
    {
      method: "PATCH",
      headers: {
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        ...patch,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`profiles PATCH ${resp.status}: ${txt}`);
  }
}

// -----------------------------------------------------------
// HOLDINGS
// -----------------------------------------------------------
export async function loadHoldings(userId) {
  const { data, error } = await supabase
    .from("holdings")
    .select("ticker, qty, avg_cost")
    .eq("user_id", userId);
  if (error) throw error;
  return (data || []).map((r) => ({
    ticker: r.ticker,
    qty: Number(r.qty) || 0,
    avg: Math.round(Number(r.avg_cost) || 0),
  }));
}

// We replace the whole holdings set with a single transaction-ish
// operation: delete missing ones, upsert the rest. "Transaction-ish"
// because PostgREST doesn't expose multi-statement transactions —
// but Postgres still serializes per-call so concurrent writes from
// the same user will linearize.
export async function saveHoldings(userId, holdings) {
  const tickers = holdings.map((h) => h.ticker);
  // Drop rows for tickers that are no longer in the holdings list.
  if (tickers.length > 0) {
    const { error: delErr } = await supabase
      .from("holdings")
      .delete()
      .eq("user_id", userId)
      .not("ticker", "in", `(${tickers.map((t) => `"${t}"`).join(",")})`);
    if (delErr) throw delErr;
  } else {
    // Empty holdings — wipe all rows.
    const { error: wipeErr } = await supabase
      .from("holdings")
      .delete()
      .eq("user_id", userId);
    if (wipeErr) throw wipeErr;
  }
  if (holdings.length === 0) return;
  const rows = holdings.map((h) => ({
    user_id: userId,
    ticker: h.ticker,
    qty: h.qty,
    avg_cost: h.avg || 0,
    currency: ARS,
    updated_at: new Date().toISOString(),
  }));
  const { error: upErr } = await supabase
    .from("holdings")
    .upsert(rows, { onConflict: "user_id,ticker" });
  if (upErr) throw upErr;
}

// -----------------------------------------------------------
// ORDERS — append-only ledger of trades
// -----------------------------------------------------------
export async function loadOrders(userId) {
  const { data, error } = await supabase
    .from("orders")
    .select("ticker, side, qty, price, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []).map((r) => ({
    ticker: r.ticker,
    // DB stores 'buy' / 'sell' (lowercase per the constraint).
    // Local UI uses 'Compra' / 'Venta'. Translate.
    side: r.side === "buy" ? "Compra" : "Venta",
    qty: Number(r.qty) || 0,
    price: Number(r.price) || 0,
    ts: r.created_at,
  }));
}

export async function appendOrder(userId, order) {
  const { error } = await supabase.from("orders").insert({
    user_id: userId,
    ticker: order.ticker,
    side: order.side === "Compra" ? "buy" : "sell",
    qty: order.qty,
    price: order.price,
    currency: ARS,
    status: "executed",
    executed_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// -----------------------------------------------------------
// BALANCE — single ARS cash row in accounts
// -----------------------------------------------------------
export async function loadBalance(userId) {
  const { data, error } = await supabase
    .from("accounts")
    .select("balance")
    .eq("user_id", userId)
    .eq("currency", ARS)
    .maybeSingle();
  if (error) throw error;
  return data ? Math.round(Number(data.balance) || 0) : null;
}

export async function saveBalance(userId, balance) {
  const { error } = await supabase
    .from("accounts")
    .upsert(
      {
        user_id: userId,
        currency: ARS,
        balance: balance,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,currency" },
    );
  if (error) throw error;
}

// -----------------------------------------------------------
// WATCHLISTS — multiple named lists, each with tickers
// -----------------------------------------------------------
// DB: two tables joined on watchlist_id. We rebuild the local
// shape `[{ id, name, tickers: [...] }]` from a single fetch
// using the embedded-resource feature of PostgREST.
export async function loadWatchlists(userId) {
  const { data, error } = await supabase
    .from("watchlists")
    .select("id, name, position, watchlist_tickers(ticker)")
    .eq("user_id", userId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data || []).map((w) => ({
    id: w.id,
    name: w.name,
    tickers: (w.watchlist_tickers || []).map((t) => t.ticker),
  }));
}

// Save with UPSERT + client-generated UUIDs. The previous version
// did delete-all + insert-all, which caused an infinite save loop:
// every save returned new DB UUIDs → setState → another save → new
// UUIDs again → loop. By generating UUIDs client-side and upserting,
// the IDs stay stable across saves, so the effect quiets down after
// the first run.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s) { return typeof s === "string" && UUID_RE.test(s); }
function newUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for ancient browsers.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function saveWatchlists(userId, watchlists) {
  // Normalize: ensure each list has a valid UUID. Lists with legacy
  // string ids ("default") get a fresh UUID — that's the one and
  // only ID change the caller will see.
  const normalized = (watchlists || []).map((w) => ({
    ...w,
    id: isUuid(w.id) ? w.id : newUuid(),
  }));

  // Upsert the watchlist rows (insert or update by id).
  if (normalized.length > 0) {
    const listRows = normalized.map((w, i) => ({
      id: w.id,
      user_id: userId,
      name: w.name,
      position: i,
    }));
    const { error: upErr } = await supabase
      .from("watchlists")
      .upsert(listRows, { onConflict: "id" });
    if (upErr) throw upErr;
  }

  // Delete any DB rows the user removed locally.
  const keepIds = normalized.map((w) => w.id);
  if (keepIds.length > 0) {
    const { error: delErr } = await supabase
      .from("watchlists")
      .delete()
      .eq("user_id", userId)
      .not("id", "in", `(${keepIds.map((i) => `"${i}"`).join(",")})`);
    if (delErr) throw delErr;
  } else {
    const { error: wipeErr } = await supabase
      .from("watchlists")
      .delete()
      .eq("user_id", userId);
    if (wipeErr) throw wipeErr;
  }

  // Tickers: for each list, replace the ticker set. Cheaper than a
  // diff because lists rarely have more than ~20 tickers.
  for (const w of normalized) {
    const { error: tDelErr } = await supabase
      .from("watchlist_tickers")
      .delete()
      .eq("watchlist_id", w.id);
    if (tDelErr) throw tDelErr;
    const tickers = w.tickers || [];
    if (tickers.length > 0) {
      const rows = tickers.map((t) => ({ watchlist_id: w.id, ticker: t }));
      const { error: tInsErr } = await supabase
        .from("watchlist_tickers")
        .insert(rows);
      if (tInsErr) throw tInsErr;
    }
  }

  return normalized;
}

// -----------------------------------------------------------
// SAVED PLAN — wizard output. We keep history (each save is a new
// row), and load the most recent on mount.
// -----------------------------------------------------------
export async function loadLatestPlan(userId) {
  const { data, error } = await supabase
    .from("plans")
    .select("payload, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? data.payload : null;
}

export async function savePlan(userId, plan) {
  if (!plan) return;
  const { error } = await supabase.from("plans").insert({
    user_id: userId,
    payload: plan,
  });
  if (error) throw error;
}

// "Clear plan" doesn't truly delete the history — it just stops
// loading the latest one. For now we hard-delete so the user can
// genuinely start over from the wizard. Easy to revisit later if
// we want a Plan History view.
export async function clearPlans(userId) {
  const { error } = await supabase
    .from("plans")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
}

// -----------------------------------------------------------
// STOP LOSSES + PRICE ALERTS — stored as JSONB columns on profiles.
// Both are small keyed maps that are always read/written whole, so
// a single column each is cleaner than separate tables.
//
//   stop_losses:  { ticker: price, ... }
//   price_alerts: { ticker: { price, direction }, ... }
// -----------------------------------------------------------
export async function loadRiskRules(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("stop_losses, price_alerts")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return {
    stopLosses:  (data && data.stop_losses)  || {},
    priceAlerts: (data && data.price_alerts) || {},
  };
}

export async function saveStopLosses(userId, stopLosses) {
  await patchProfile(userId, { stop_losses: stopLosses || {} });
}

export async function savePriceAlerts(userId, priceAlerts) {
  await patchProfile(userId, { price_alerts: priceAlerts || {} });
}

// -----------------------------------------------------------
// PREFERENCES + RECURRING APORTE + PORTFOLIO HISTORY
// -----------------------------------------------------------
// All of these live on the profiles row. Same lifecycle as risk
// rules — they're small, always read/written whole, and the user
// expects them to follow them across devices.
//
//   recurring_aporte  — { amount, lastApplied } | null
//   portfolio_history — [{ date, value }, ...] | null
//   lang              — 'es' | 'en' | ...
//   show_usd          — boolean
//   ui_dark           — boolean
//   view_mode         — 'mobile' | 'desktop'
// -----------------------------------------------------------
export async function loadPreferences(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("recurring_aporte, portfolio_history, lang, show_usd, ui_dark, view_mode")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      recurringAporte: null,
      portfolioHistory: null,
      lang: null,
      showUSD: null,
      uiDark: null,
      viewMode: null,
    };
  }
  return {
    recurringAporte:  data.recurring_aporte  || null,
    portfolioHistory: data.portfolio_history || null,
    // For scalars we return whatever the DB had — including the
    // server defaults — so the caller can treat null/undefined as
    // "no opinion" and fall back to its local cache.
    lang:     data.lang     ?? null,
    showUSD:  typeof data.show_usd === "boolean" ? data.show_usd : null,
    uiDark:   typeof data.ui_dark  === "boolean" ? data.ui_dark  : null,
    viewMode: data.view_mode ?? null,
  };
}

export async function saveRecurringAporte(userId, recurringAporte) {
  await patchProfile(userId, { recurring_aporte: recurringAporte || null });
}

export async function savePortfolioHistory(userId, history) {
  // Cap the history at the most recent 365 entries so the JSONB
  // doesn't grow unbounded over years of use.
  const trimmed = Array.isArray(history) ? history.slice(-365) : null;
  await patchProfile(userId, { portfolio_history: trimmed });
}

export async function saveLang(userId, lang) {
  if (typeof lang !== "string" || !lang) return;
  await patchProfile(userId, { lang });
}

export async function saveShowUSD(userId, showUSD) {
  await patchProfile(userId, { show_usd: !!showUSD });
}

export async function saveUiDark(userId, uiDark) {
  await patchProfile(userId, { ui_dark: !!uiDark });
}

export async function saveViewMode(userId, viewMode) {
  if (viewMode !== "mobile" && viewMode !== "desktop") return;
  await patchProfile(userId, { view_mode: viewMode });
}

// -----------------------------------------------------------
// Bulk loader — used on mount to hydrate everything in parallel.
// Returns nulls for sections that errored, so partial loads don't
// kill the whole app. Caller decides what to do with each piece.
// -----------------------------------------------------------
// -----------------------------------------------------------
// SESSION MANAGEMENT — list / revoke active auth sessions
// -----------------------------------------------------------
// Both call RPCs defined in supabase/sessions_rpc.sql. The RPCs
// are SECURITY DEFINER so they can read/write the auth schema
// (which is normally locked away from authenticated users). The
// WHERE user_id = auth.uid() inside the RPC body keeps each user
// limited to their own sessions.

export async function listMySessions() {
  const { data, error } = await supabase.rpc("list_my_sessions");
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function revokeMySession(sessionId) {
  const { error } = await supabase.rpc("revoke_my_session", { session_id: sessionId });
  if (error) throw error;
}

export async function loadUserPortfolio(userId) {
  const [holdings, orders, balance, watchlists, plan, risk, prefs] = await Promise.allSettled([
    loadHoldings(userId),
    loadOrders(userId),
    loadBalance(userId),
    loadWatchlists(userId),
    loadLatestPlan(userId),
    loadRiskRules(userId),
    loadPreferences(userId),
  ]);
  const riskVal  = risk.status  === "fulfilled" ? risk.value  : null;
  const prefsVal = prefs.status === "fulfilled" ? prefs.value : null;
  return {
    holdings:    holdings.status   === "fulfilled" ? holdings.value   : null,
    orders:      orders.status     === "fulfilled" ? orders.value     : null,
    balance:     balance.status    === "fulfilled" ? balance.value    : null,
    watchlists:  watchlists.status === "fulfilled" ? watchlists.value : null,
    plan:        plan.status       === "fulfilled" ? plan.value       : null,
    stopLosses:  riskVal ? riskVal.stopLosses  : null,
    priceAlerts: riskVal ? riskVal.priceAlerts : null,
    // Preferences. Each can be null = "DB had no opinion / fetch failed",
    // and the caller should keep its local cache in that case.
    recurringAporte:  prefsVal ? prefsVal.recurringAporte  : null,
    portfolioHistory: prefsVal ? prefsVal.portfolioHistory : null,
    lang:     prefsVal ? prefsVal.lang     : null,
    showUSD:  prefsVal ? prefsVal.showUSD  : null,
    uiDark:   prefsVal ? prefsVal.uiDark   : null,
    viewMode: prefsVal ? prefsVal.viewMode : null,
    errors: [holdings, orders, balance, watchlists, plan, risk, prefs]
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason),
  };
}
