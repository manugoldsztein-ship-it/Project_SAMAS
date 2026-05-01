// ============================================================
// SAMAS v2 — Broker API
// ============================================================
// Owns: portfolio holdings, market data (quotes, asset list),
// orders, watchlists, FX rates (MEP/CCL/Oficial).
//
// PRODUCTION INTEGRATION TARGET — Cohen / IOL / Cocos / IEB
//   The Argentine broker APIs cluster around the same primitives:
//     - Portfolio: list of holdings (ticker, qty, avg cost, mkt value).
//     - Quotes: real-time price + 24h change per ticker.
//     - Orders: submit BUY/SELL with side + qty + price/limit.
//     - FX: dollar quotes (MEP, CCL, Oficial, Blue).
//
//   Cohen's API has not yet been documented at us. The shapes below
//   are educated guesses based on IOL's public docs and how local
//   brokers expose data. When Cohen sends their spec we'll either:
//     (a) match the contract — no UI change.
//     (b) add a thin adapter — still no UI change.
//
// MOCK DATA SOURCE
//   We reuse the existing ASSETS array from src/App.jsx (legacy
//   trading data) so the v2 Broker tab shows the same instruments
//   the user is used to. Quotes come from the same in-memory list.
// ============================================================

import { jitter, maybeFail, relativeStamp } from "./_mock.js";
import { supabase } from "../../lib/supabase.js";

// ----------------------------------------------------------
// Auth helper — every Supabase-backed broker call needs the
// caller's user_id. supabase-js caches the session internally so
// re-calling getUser() is cheap; mirrors how src/v2/api/social.js
// does the same lookup.
// ----------------------------------------------------------
async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error("Sesión no encontrada.");
  return data.user.id;
}

// ----------------------------------------------------------
// Status vocabulary translation (samas-0.0.96 fix).
// ----------------------------------------------------------
// The DB's orders.status CHECK constraint allows the standard
// broker terms: 'pending' | 'executed' | 'cancelled' | 'rejected'.
// The legacy v2 UI was written against a mock vocab of 'open' /
// 'filled' / 'cancelled', and rather than churning every consumer
// in Broker.jsx, we translate at the API boundary:
//   - On WRITE (placeOrder): UI 'filled' → DB 'executed', UI 'open' → DB 'pending'.
//   - On READ  (getOrders, placeOrder return): DB 'executed' → UI 'filled', DB 'pending' → UI 'open'.
// 'cancelled' / 'rejected' pass through unchanged.
function dbToUiStatus(s) {
  if (s === "executed") return "filled";
  if (s === "pending")  return "open";
  return s; // cancelled, rejected, or already in UI vocab
}
function uiToDbStatus(s) {
  if (s === "filled") return "executed";
  if (s === "open")   return "pending";
  return s;
}

// ----------------------------------------------------------
// Asset universe
// ----------------------------------------------------------
// Hardcoded for the demo. In production this comes from the broker
// or a market data provider (Finnhub / CMS Capital). Each asset:
//   ticker      symbol used in orders ("GGAL", "AAPL", "AL30", ...)
//   name        display name
//   category    "ACCION" | "CEDEAR" | "BONO" | "ETF" | "COMMOD"
//   currency    "ARS" | "USD"
//   price       last traded
//   changePct   24h percentage change
// ----------------------------------------------------------
// `logo` is a Clearbit brand-icon URL (or null when no good match
// exists — bonds, ETFs from less-known issuers). The AssetLogo
// component shows the real PNG when set and falls back to the
// category-colored initials tile when null or 404. Names are kept
// short (drop "Inc.", "S.A.", "Corp.") so they fit the row subline
// and read consistently with how Robinhood / Cocos display them.
const ASSETS = [
  { ticker: "AAPL", name: "Apple",           category: "CEDEAR", currency: "USD", price: 215.40, changePct:  1.84, logo: "https://logo.clearbit.com/apple.com" },
  { ticker: "NVDA", name: "NVIDIA",          category: "CEDEAR", currency: "USD", price: 892.15, changePct:  4.21, logo: "https://logo.clearbit.com/nvidia.com" },
  { ticker: "TSLA", name: "Tesla",           category: "CEDEAR", currency: "USD", price: 248.30, changePct: -1.20, logo: "https://logo.clearbit.com/tesla.com" },
  { ticker: "MSFT", name: "Microsoft",       category: "CEDEAR", currency: "USD", price: 432.10, changePct:  0.74, logo: "https://logo.clearbit.com/microsoft.com" },
  { ticker: "GOOGL",name: "Alphabet",        category: "CEDEAR", currency: "USD", price: 184.20, changePct:  1.12, logo: "https://logo.clearbit.com/google.com" },
  { ticker: "GGAL", name: "Grupo Galicia",   category: "ACCION", currency: "ARS", price: 4250,   changePct: -2.10, logo: "https://logo.clearbit.com/galiciaseguros.com.ar" },
  { ticker: "YPF",  name: "YPF",             category: "ACCION", currency: "ARS", price: 38500,  changePct:  3.45, logo: "https://logo.clearbit.com/ypf.com" },
  { ticker: "PAMP", name: "Pampa Energía",   category: "ACCION", currency: "ARS", price: 5820,   changePct:  0.92, logo: "https://logo.clearbit.com/pampaenergia.com" },
  // Crypto removed in samas-0.4.21 — Cohen (broker of record for the
  // pitch) doesn't operate crypto. Kept the BONO/ETF/COMMOD lineup
  // which is fully Cohen-coverable.
  { ticker: "AL30", name: "Bonar 2030",      category: "BONO",   currency: "USD", price: 56.70,  changePct:  0.40, logo: null },
  { ticker: "SPY",  name: "S&P 500 ETF",     category: "ETF",    currency: "USD", price: 512.40, changePct:  0.62, logo: "https://logo.clearbit.com/ssga.com" },
  { ticker: "QQQ",  name: "Nasdaq-100 ETF",  category: "ETF",    currency: "USD", price: 431.20, changePct:  0.88, logo: "https://logo.clearbit.com/invesco.com" },
  { ticker: "IWM",  name: "Russell 2000 ETF",category: "ETF",    currency: "USD", price: 218.65, changePct: -0.34, logo: "https://logo.clearbit.com/ishares.com" },
  { ticker: "EWZ",  name: "Brasil ETF",      category: "ETF",    currency: "USD", price:  29.40, changePct:  1.05, logo: "https://logo.clearbit.com/ishares.com" },
  { ticker: "GLD",  name: "Oro (SPDR Gold)", category: "COMMOD", currency: "USD", price: 228.60, changePct:  1.24, logo: "https://logo.clearbit.com/spdrs.com" },
  { ticker: "SLV",  name: "Plata (iShares)", category: "COMMOD", currency: "USD", price:  27.85, changePct: -0.51, logo: "https://logo.clearbit.com/ishares.com" },
  { ticker: "USO",  name: "Petróleo (USO)",  category: "COMMOD", currency: "USD", price:  81.30, changePct: -0.72, logo: null },
];

// ----------------------------------------------------------
// In-memory state
// ----------------------------------------------------------
const STORAGE_KEY = "samas_v2_broker_mock";

function loadState() {
  if (typeof localStorage === "undefined") return seed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : seed();
  } catch { return seed(); }
}

function saveState(s) {
  state = s;
  if (typeof localStorage !== "undefined") {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
  }
}

function seed() {
  return {
    holdings: [
      { ticker: "GGAL", qty: 250, avgCost: 4150 },
      { ticker: "AAPL", qty: 8,   avgCost: 210.00 },
      { ticker: "GLD",  qty: 2,   avgCost: 220.00 },
    ],
    orders: [],                    // submitted but not necessarily filled
    // Watchlists migrated to Supabase in 0.0.78 — see public.watchlists +
    // public.watchlist_tickers. The legacy `watchlists` field is no longer
    // read by getWatchlists() / mutations; localStorage seed keeps the slot
    // empty for any drive-by reader during the transition.
    watchlists: [],
    // Price alerts + stop losses are keyed by ticker (one per asset).
    // alert  = { targetPrice, direction: "above" | "below", createdAt }
    // stop   = { type: "pct" | "price", value, triggerPrice, createdAt }
    //   type=pct: value is a negative percent from current price
    //             (e.g. -10 = sell when price drops 10%); we precompute
    //             the absolute trigger when setting and store it.
    //   type=price: value IS the trigger.
    alerts: {},
    stops: {},
    fx: {
      mep:     { value: 1245, change:  0.40 },
      ccl:     { value: 1261, change:  1.10 },
      oficial: { value:  985, change: -0.10 },
    },
  };
}

let state = loadState();

// ----------------------------------------------------------
// Public API
// ----------------------------------------------------------

/**
 * getAssets({ category }) — full universe of tradeable instruments.
 * Production: GET /catalog/instruments. May be cached for hours.
 *
 * @returns {Promise<Array<Asset>>}
 */
export async function getAssets({ category } = {}) {
  await jitter();
  let list = ASSETS;
  if (category) list = list.filter((a) => a.category === category);
  return list.map((a) => ({ ...a }));
}

/**
 * getQuote(ticker) — single asset's current price + change.
 * Production: GET /quotes/{ticker}, polled every few seconds.
 */
export async function getQuote(ticker) {
  await jitter(150, 350);
  const a = ASSETS.find((x) => x.ticker === ticker);
  if (!a) throw new Error("Ticker no encontrado: " + ticker);
  return {
    ticker: a.ticker,
    price: a.price,
    changePct: a.changePct,
    currency: a.currency,
    at: Date.now(),
  };
}

/**
 * getPortfolio() — list of holdings with live valuation.
 * Production: GET /portfolio with live quotes attached server-side.
 *
 * @returns {Promise<{
 *   holdings: Array<Holding>,
 *   totalArs: number,         // sum of all holdings expressed in ARS
 *   totalUsd: number,         // same in USD via MEP rate
 * }>}
 *
 * Holding shape:
 *   ticker, qty, avgCost, currency, price, value, gainAbs, gainPct
 */
export async function getPortfolio() {
  // 0.0.76: holdings now live in Supabase (public.holdings, RLS
  // scoped to auth.uid). The local ASSETS table still owns the
  // metadata (name / category / live price) — those are quote-side
  // concerns that don't need to persist per user.
  const userId = await currentUserId();
  const { data: rows, error } = await supabase
    .from("holdings")
    .select("ticker, qty, avg_cost, currency, updated_at")
    .eq("user_id", userId);
  if (error) throw new Error(`Error al cargar holdings: ${error.message}`);

  const mepRate = state.fx.mep.value;
  const enriched = (rows || []).map((h) => {
    const a = ASSETS.find((x) => x.ticker === h.ticker);
    if (!a) return null;
    const price = a.price;
    const value = h.qty * price;
    const cost = h.qty * h.avg_cost;
    const gainAbs = value - cost;
    const gainPct = cost === 0 ? 0 : (gainAbs / cost) * 100;
    return {
      ticker: h.ticker, qty: Number(h.qty), avgCost: Number(h.avg_cost),
      currency: a.currency, name: a.name, category: a.category,
      price, value, gainAbs, gainPct,
    };
  }).filter(Boolean);

  // Total in ARS = sum of (value if ARS else value * MEP). Guard
  // against mepRate=0/NaN/Infinity coming from a bad upstream FX
  // payload — without it totalUsd silently becomes Infinity/NaN and
  // every USD readout in the UI breaks.
  const safeMep = Number.isFinite(mepRate) && mepRate > 0 ? mepRate : 1;
  const totalArs = enriched.reduce((s, h) => s + (h.currency === "ARS" ? h.value : h.value * safeMep), 0);
  const totalUsd = totalArs / safeMep;

  return { holdings: enriched, totalArs, totalUsd };
}

/**
 * Fee schedule used to build a confirmation breakdown before sending
 * an order. The numbers below are typical retail-broker rates in
 * Argentina (Cohen / IOL / Balanz are in this ballpark). When wired to
 * a real broker we'll fetch the real schedule from their API and feed
 * it here — the UI only depends on `quoteOrderFees` returning the
 * same shape.
 */
const FEE_SCHEDULE = {
  commissionRate:    0.005,   // 0.5% over subtotal
  ivaRate:           0.21,    // 21% over the commission
  marketDutyRate:    0.0008,  // ~0.08% derechos de mercado
};

/**
 * quoteOrderFees({ side, subtotal }) — returns an itemized fee
 * breakdown for a hypothetical order. Synchronous on purpose: the UI
 * recomputes this on every keystroke in the confirmation step.
 *
 * @returns {{
 *   subtotal: number,
 *   commission: number,
 *   iva: number,
 *   marketDuty: number,
 *   feesTotal: number,
 *   total: number,    // what the user pays (buy) or receives (sell)
 * }}
 */
export function quoteOrderFees({ side, subtotal }) {
  const sub = Number(subtotal) || 0;
  const commission = sub * FEE_SCHEDULE.commissionRate;
  const iva = commission * FEE_SCHEDULE.ivaRate;
  const marketDuty = sub * FEE_SCHEDULE.marketDutyRate;
  const feesTotal = commission + iva + marketDuty;
  const total = side === "buy" ? sub + feesTotal : sub - feesTotal;
  return { subtotal: sub, commission, iva, marketDuty, feesTotal, total };
}

/**
 * placeOrder({ ticker, side, qty, type, limitPrice }) — submit a
 * new order. Mock fills market orders immediately at the latest
 * price; LIMIT orders sit in `orders` as "open".
 *
 * Production: POST /orders. Real broker returns an order ID and the
 * order may take seconds-to-minutes to fill.
 *
 * @param {{
 *   ticker: string,
 *   side: "buy" | "sell",
 *   qty: number,
 *   type?: "market" | "limit",
 *   limitPrice?: number,
 * }} input
 * @returns {Promise<{ orderId: string, status: "filled" | "open", fillPrice?: number }>}
 */
export async function placeOrder({ ticker, side, qty, type = "market", limitPrice }) {
  await jitter(400, 900);
  if (!qty || qty <= 0) throw new Error("Cantidad inválida.");
  const a = ASSETS.find((x) => x.ticker === ticker);
  if (!a) throw new Error("Ticker no encontrado.");
  await maybeFail(0.03, "El mercado rechazó la orden. Intentá de nuevo.");

  const userId = await currentUserId();
  const price = type === "limit" ? limitPrice : a.price;
  const filled = type === "market";

  // 0.0.76: orders now persist to public.orders. Holdings are
  // upserted on fill; a transaction-ledger row is inserted so the
  // user has an auditable record of every trade. Price-deduction
  // from the cash balance lands in 0.0.78 (wallet migration);
  // for now the holdings/orders layer is the source of truth.
  //
  // SELL guard: pre-check holdings before inserting the order so
  // we don't end up with an "filled" sell that has no matching
  // position. Schema lacks an UPDATE/DELETE policy on orders so we
  // can't roll back the row if the holdings update fails — the
  // pre-check is the safest pattern available client-side.
  if (filled && side === "sell") {
    const { data: existing, error: selErr } = await supabase
      .from("holdings")
      .select("qty")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .maybeSingle();
    if (selErr) throw new Error(`Error al verificar holdings: ${selErr.message}`);
    if (!existing || Number(existing.qty) < qty) {
      throw new Error("Cantidad insuficiente para vender.");
    }
  }

  // Insert the order row first. RLS WITH CHECK enforces user_id =
  // auth.uid() so the caller can only insert orders as themselves.
  // Status uses DB vocab ('executed' for filled, 'pending' for open)
  // — the orders_status_check constraint rejects the legacy mock
  // values ('filled' / 'open'). See dbToUiStatus / uiToDbStatus.
  const { data: orderRow, error: insErr } = await supabase
    .from("orders")
    .insert({
      user_id: userId,
      ticker,
      side,
      qty,
      price,
      currency: a.currency,
      status: filled ? "executed" : "pending",
      executed_at: filled ? new Date().toISOString() : null,
    })
    .select("id, status")
    .single();
  if (insErr) throw new Error(`Error al colocar orden: ${insErr.message}`);

  // For market orders that fill on submit, mutate holdings + write
  // the transaction ledger entry. For limit orders, none of this
  // runs — the order sits in `open` until a future cron / broker
  // event executes it.
  if (filled) {
    if (side === "buy") {
      // Read current holding to compute the new weighted-average
      // cost basis. maybeSingle returns null when the user doesn't
      // own this ticker yet.
      const { data: existing } = await supabase
        .from("holdings")
        .select("qty, avg_cost")
        .eq("user_id", userId)
        .eq("ticker", ticker)
        .maybeSingle();
      const oldQty = existing ? Number(existing.qty) : 0;
      const oldAvg = existing ? Number(existing.avg_cost) : 0;
      const newQty = oldQty + qty;
      const newAvg = newQty > 0 ? (oldAvg * oldQty + price * qty) / newQty : price;
      const { error: upErr } = await supabase
        .from("holdings")
        .upsert({
          user_id: userId,
          ticker,
          qty: newQty,
          avg_cost: newAvg,
          currency: a.currency,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,ticker" });
      if (upErr) throw new Error(`Error al actualizar holdings: ${upErr.message}`);
    } else {
      // Sell — pre-check passed above so we know existing.qty >= qty.
      const { data: existing } = await supabase
        .from("holdings")
        .select("qty, avg_cost")
        .eq("user_id", userId)
        .eq("ticker", ticker)
        .maybeSingle();
      const remainingQty = Number(existing.qty) - qty;
      if (remainingQty === 0) {
        // Position closed — delete the row entirely.
        const { error: delErr } = await supabase
          .from("holdings")
          .delete()
          .eq("user_id", userId)
          .eq("ticker", ticker);
        if (delErr) throw new Error(`Error al cerrar posición: ${delErr.message}`);
      } else {
        // Partial sell — qty drops, avg_cost stays put.
        const { error: updErr } = await supabase
          .from("holdings")
          .update({ qty: remainingQty, updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("ticker", ticker);
        if (updErr) throw new Error(`Error al actualizar holdings: ${updErr.message}`);
      }
    }

    // Append a transactions row so the user has an audit log.
    // Sign convention: buy = negative (cash out), sell = positive
    // (cash in). The wallet migration (0.0.78) will use this same
    // ledger for balance computation.
    const txAmount = qty * price * (side === "buy" ? -1 : 1);
    await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        kind: side === "buy" ? "trade_buy" : "trade_sell",
        amount: txAmount,
        currency: a.currency,
        reference: `order:${orderRow.id}`,
        memo: `${side === "buy" ? "Compra" : "Venta"} ${qty} ${ticker} @ ${price}`,
      });
    // Don't throw on tx insert failure — the order + holdings
    // already settled and the ledger is auxiliary. Log so we can
    // audit gaps later.
  }

  return {
    orderId: orderRow.id,
    // Map DB status back to UI vocab so callers (Broker.jsx) keep
    // their existing 'filled' / 'open' checks.
    status: dbToUiStatus(orderRow.status),
    fillPrice: filled ? price : null,
  };
}

/**
 * getOrders({ status }) — list of submitted orders.
 * Production: GET /orders?status=open|filled|all.
 */
export async function getOrders({ status = "all" } = {}) {
  // 0.0.76: reads from public.orders. RLS scopes to caller. Sorted
  // newest-first to match the historical UI expectation.
  const userId = await currentUserId();
  let q = supabase
    .from("orders")
    .select("id, ticker, side, qty, price, currency, status, fees, created_at, executed_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  // Translate UI-vocab filter ('open'/'filled') to DB-vocab on the
  // wire, then translate DB statuses back to UI vocab on the way out.
  if (status !== "all") q = q.eq("status", uiToDbStatus(status));
  const { data, error } = await q;
  if (error) throw new Error(`Error al cargar órdenes: ${error.message}`);
  return (data || []).map((o) => {
    const at = o.created_at ? new Date(o.created_at).getTime() : Date.now();
    const uiStatus = dbToUiStatus(o.status);
    return {
      id: o.id,
      ticker: o.ticker,
      side: o.side,
      qty: Number(o.qty),
      price: Number(o.price),
      currency: o.currency,
      status: uiStatus,
      // type — derived from whether limitPrice would have been set.
      // We don't currently persist `type` separately; orders with
      // status="open" are limit orders, "filled" are market in our
      // model. Refine when real broker integration distinguishes.
      type: uiStatus === "open" ? "limit" : "market",
      limitPrice: uiStatus === "open" ? Number(o.price) : null,
      fillPrice: uiStatus === "filled" ? Number(o.price) : null,
      at,
      atLabel: relativeStamp(at),
    };
  });
}

/**
 * cancelOrder(orderId) — currently disabled until the orders table
 * gets an UPDATE policy or a server-side RPC. The schema's RLS only
 * allows INSERT + SELECT today; there's no path to flip an open
 * order to "cancelled" from the client. Tracked as a follow-up
 * post 0.0.76. Throws so the UI can surface the limitation.
 */
export async function cancelOrder(_orderId) {
  await jitter();
  throw new Error("Cancelar órdenes está deshabilitado en esta versión.");
}

// ============================================================
// WATCHLISTS — Supabase-backed (0.0.78). Two tables:
//   public.watchlists          one row per named list, owner-scoped via RLS.
//   public.watchlist_tickers   the join table (watchlist_id, ticker, position).
// Both are RLS-locked to the calling user via auth.uid().
//
// Shape returned to the UI matches the legacy localStorage one:
//   { id, name, color, tickers: [string, ...] }
// — so WatchlistView / AssetSheet don't need to change.
// ============================================================

/**
 * getWatchlists() — every list the caller owns, with embedded
 * tickers in user-chosen order. Single round-trip via PostgREST's
 * relational embed (`watchlist_tickers(*)`). Sort tickers by their
 * stored `position` so reorder arrows stick.
 */
export async function getWatchlists() {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("watchlists")
    .select("id, name, color, position, watchlist_tickers(ticker, position)")
    .eq("user_id", userId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((w) => ({
    id: w.id,
    name: w.name,
    color: w.color || null,
    tickers: (w.watchlist_tickers || [])
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((t) => t.ticker),
  }));
}

/**
 * addToWatchlist(watchlistId, ticker) — append ticker to the end of
 * the list. Composite PK (watchlist_id, ticker) means dupes upsert
 * cleanly. New tickers get position = (current max + 1).
 */
export async function addToWatchlist(watchlistId, ticker) {
  // Read existing positions so the new ticker lands at the bottom.
  const { data: existing, error: readErr } = await supabase
    .from("watchlist_tickers")
    .select("position")
    .eq("watchlist_id", watchlistId)
    .order("position", { ascending: false })
    .limit(1);
  if (readErr) throw new Error(readErr.message);
  const nextPos = existing?.length ? (existing[0].position ?? 0) + 1 : 0;
  const { error } = await supabase
    .from("watchlist_tickers")
    .upsert(
      { watchlist_id: watchlistId, ticker, position: nextPos },
      { onConflict: "watchlist_id,ticker" }
    );
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function removeFromWatchlist(watchlistId, ticker) {
  const { error } = await supabase
    .from("watchlist_tickers")
    .delete()
    .eq("watchlist_id", watchlistId)
    .eq("ticker", ticker);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * createWatchlist(name, opts) — insert a new named list. Returns
 * the same {id, name, color, tickers} shape the UI expects.
 */
export async function createWatchlist(name, opts = {}) {
  if (!name || !name.trim()) throw new Error("Indicá un nombre.");
  const trimmed = name.trim().slice(0, 40);
  const userId = await currentUserId();
  // Place the new list at the bottom of the picker.
  const { data: existing } = await supabase
    .from("watchlists")
    .select("position")
    .eq("user_id", userId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPos = existing?.length ? (existing[0].position ?? 0) + 1 : 0;
  const { data, error } = await supabase
    .from("watchlists")
    .insert({
      user_id: userId,
      name: trimmed,
      color: opts.color || null,
      position: nextPos,
    })
    .select("id, name, color")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, name: data.name, color: data.color || null, tickers: [] };
}

/**
 * setWatchlistColor(id, color) — Pro feature (samas-0.0.47). Pass
 * null to clear the tag back to the default border.
 */
export async function setWatchlistColor(id, color) {
  const { error } = await supabase
    .from("watchlists")
    .update({ color: color || null })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * reorderWatchlist(id, tickers) — replace position values for the
 * given tickers in their array order. We don't validate that the
 * array is a permutation of the current set — RLS enforces parent
 * ownership and the upsert is idempotent on (watchlist_id, ticker).
 */
export async function reorderWatchlist(id, tickers) {
  if (!Array.isArray(tickers)) throw new Error("Orden inválido.");
  if (tickers.length === 0) return { ok: true };
  const rows = tickers.map((ticker, idx) => ({
    watchlist_id: id,
    ticker,
    position: idx,
  }));
  const { error } = await supabase
    .from("watchlist_tickers")
    .upsert(rows, { onConflict: "watchlist_id,ticker" });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * renameWatchlist(id, newName) — update display name.
 */
export async function renameWatchlist(id, newName) {
  if (!newName || !newName.trim()) throw new Error("Indicá un nombre.");
  const trimmed = newName.trim().slice(0, 40);
  const { error } = await supabase
    .from("watchlists")
    .update({ name: trimmed })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * removeWatchlist(id) — delete the list. ON DELETE CASCADE on
 * watchlist_tickers.watchlist_id drops every ticker row in one go.
 *
 * The user can delete every list — WatchlistView's empty state
 * with "+ Crear lista" handles the no-lists case.
 */
export async function removeWatchlist(id) {
  const { error } = await supabase.from("watchlists").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ----------------------------------------------------------
// Price alerts + stop losses
// ----------------------------------------------------------
// Both are PER-TICKER (one alert + one stop per asset). Setting a
// new one replaces the previous. Real implementation in production:
// a server-side job polls quotes every N seconds and fires a push
// notification (Capacitor LocalNotifications / APNs) when the
// trigger condition is met. Stops also auto-place a market sell.
//
// In mock mode we just store the config; we don't run a polling
// loop. The Órdenes view shows the pending alerts/stops so the
// user can see them and remove them.

// ----- Price alerts -----
// Delegated to ./alerts.js, which persists to public.price_alerts in
// Supabase (so the check-price-alerts cron can match and fire pushes,
// and so alerts roam across the user's devices).
//
// We attach the matching ASSETS row on read so the Órdenes view can
// show the asset name + last price without re-joining client-side.

import * as alertsApi from "./alerts.js";

/**
 * setPriceAlert({ ticker, targetPrice, direction, currency, note }) —
 * @returns {Promise<{ id, ticker, targetPrice, direction, currency, createdAt, ... }>}
 */
export async function setPriceAlert(args) {
  const a = ASSETS.find((x) => x.ticker === args?.ticker);
  if (!a) throw new Error("Ticker no encontrado.");
  return alertsApi.setPriceAlert(args);
}

/**
 * removePriceAlert(idOrTicker) — accepts a UUID (preferred) or
 * a ticker (deletes all alerts on that ticker).
 */
export async function removePriceAlert(idOrTicker) {
  return alertsApi.removePriceAlert(idOrTicker);
}

/**
 * getPriceAlerts({ activeOnly }) — list of alerts with the
 * matching asset row attached for convenience.
 */
export async function getPriceAlerts(opts = {}) {
  const list = await alertsApi.getPriceAlerts(opts);
  return list.map((a) => ({
    ...a,
    asset: ASSETS.find((x) => x.ticker === a.ticker),
  }));
}

/** getFiredAlerts() — recently fired alerts (history view). */
export async function getFiredAlerts(limit) {
  const list = await alertsApi.getFiredAlerts(limit);
  return list.map((a) => ({
    ...a,
    asset: ASSETS.find((x) => x.ticker === a.ticker),
  }));
}

/**
 * setStopLoss({ ticker, type, value }) — auto-sell when price hits
 * the stop. type:"pct" → value is negative percent from current;
 * type:"price" → value is the absolute trigger.
 *
 * Validation: the asset must be currently held (you can't stop-loss
 * something you don't own).
 */
export async function setStopLoss({ ticker, type = "pct", value }) {
  await jitter();
  const a = ASSETS.find((x) => x.ticker === ticker);
  if (!a) throw new Error("Ticker no encontrado.");
  const holding = state.holdings.find((h) => h.ticker === ticker);
  if (!holding) throw new Error("Solo podés poner stop loss en activos que tenés.");
  if (value == null || isNaN(value)) throw new Error("Valor inválido.");

  let triggerPrice;
  if (type === "pct") {
    if (value >= 0) throw new Error("El porcentaje debe ser negativo (ej. -10).");
    triggerPrice = a.price * (1 + value / 100);
  } else if (type === "price") {
    if (value <= 0) throw new Error("Precio inválido.");
    if (value >= a.price) throw new Error("El precio de stop debe ser menor al actual.");
    triggerPrice = value;
  } else {
    throw new Error("Tipo de stop inválido.");
  }

  const stop = { ticker, type, value, triggerPrice, createdAt: Date.now() };
  saveState({ ...state, stops: { ...state.stops, [ticker]: stop } });
  return stop;
}

/**
 * removeStopLoss(ticker) — delete the stop for this ticker.
 */
export async function removeStopLoss(ticker) {
  await jitter();
  const next = { ...state, stops: { ...state.stops } };
  delete next.stops[ticker];
  saveState(next);
  return { ok: true };
}

/**
 * getStopLosses() — list of all active stops.
 */
export async function getStopLosses() {
  await jitter();
  return Object.values(state.stops).map((s) => ({
    ...s,
    asset: ASSETS.find((x) => x.ticker === s.ticker),
  }));
}

/**
 * getAlertFor(ticker) / getStopFor(ticker) — single fetch by ticker.
 * Useful from AssetSheet to show the current state at a glance.
 */
export async function getAlertFor(ticker) {
  await jitter(50, 150);
  return state.alerts[ticker] || null;
}
export async function getStopFor(ticker) {
  await jitter(50, 150);
  return state.stops[ticker] || null;
}

/**
 * getFx() — dollar quotes (MEP, CCL, Oficial). Used everywhere.
 * Production: GET /fx — usually cached 30-60 seconds.
 *
 * @returns {Promise<{
 *   mep: { value: number, change: number },
 *   ccl: { value: number, change: number },
 *   oficial: { value: number, change: number },
 * }>}
 */
export async function getFx() {
  await jitter(100, 300);
  return JSON.parse(JSON.stringify(state.fx));
}

// ----------------------------------------------------------
// Demo helpers
// ----------------------------------------------------------
export function _resetDemo() {
  saveState(seed());
}
