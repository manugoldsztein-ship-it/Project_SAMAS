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

import { jitter, maybeFail, genId, relativeStamp } from "./_mock.js";

// ----------------------------------------------------------
// Asset universe
// ----------------------------------------------------------
// Hardcoded for the demo. In production this comes from the broker
// or a market data provider (Finnhub / CMS Capital). Each asset:
//   ticker      symbol used in orders ("GGAL", "AAPL", "BTC", ...)
//   name        display name
//   category    "ACCION" | "CEDEAR" | "BONO" | "CRYPTO" | "ETF" | ...
//   currency    "ARS" | "USD"
//   price       last traded
//   changePct   24h percentage change
// ----------------------------------------------------------
const ASSETS = [
  { ticker: "AAPL", name: "Apple Inc.",       category: "CEDEAR", currency: "USD", price: 215.40, changePct:  1.84 },
  { ticker: "NVDA", name: "NVIDIA",           category: "CEDEAR", currency: "USD", price: 892.15, changePct:  4.21 },
  { ticker: "TSLA", name: "Tesla",            category: "CEDEAR", currency: "USD", price: 248.30, changePct: -1.20 },
  { ticker: "GGAL", name: "Grupo Galicia",    category: "ACCION", currency: "ARS", price: 4250,   changePct: -2.10 },
  { ticker: "YPF",  name: "YPF S.A.",         category: "ACCION", currency: "ARS", price: 38500,  changePct:  3.45 },
  { ticker: "PAMP", name: "Pampa Energía",    category: "ACCION", currency: "ARS", price: 5820,   changePct:  0.92 },
  { ticker: "BTC",  name: "Bitcoin",          category: "CRYPTO", currency: "USD", price: 92450,  changePct:  0.92 },
  { ticker: "ETH",  name: "Ethereum",         category: "CRYPTO", currency: "USD", price: 2845,   changePct:  2.18 },
  { ticker: "AL30", name: "Bonar 2030",       category: "BONO",   currency: "USD", price: 56.70,  changePct:  0.40 },
  { ticker: "SPY",  name: "S&P 500 ETF",      category: "ETF",    currency: "USD", price: 512.40, changePct:  0.62 },
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
      { ticker: "BTC",  qty: 0.018, avgCost: 89000 },
    ],
    orders: [],                    // submitted but not necessarily filled
    watchlists: [
      { id: "wl_main", name: "Mi watchlist", tickers: ["NVDA", "TSLA", "ETH"] },
    ],
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
  await jitter();
  const mepRate = state.fx.mep.value;
  const enriched = state.holdings.map((h) => {
    const a = ASSETS.find((x) => x.ticker === h.ticker);
    if (!a) return null;
    const price = a.price;
    const value = h.qty * price;
    const cost = h.qty * h.avgCost;
    const gainAbs = value - cost;
    const gainPct = cost === 0 ? 0 : (gainAbs / cost) * 100;
    return {
      ticker: h.ticker, qty: h.qty, avgCost: h.avgCost,
      currency: a.currency, name: a.name, category: a.category,
      price, value, gainAbs, gainPct,
    };
  }).filter(Boolean);

  // Total in ARS = sum of (value if ARS else value * MEP)
  const totalArs = enriched.reduce((s, h) => s + (h.currency === "ARS" ? h.value : h.value * mepRate), 0);
  const totalUsd = totalArs / mepRate;

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

  const price = type === "limit" ? limitPrice : a.price;

  // Mock: market orders fill instantly. Limit orders stay open.
  const filled = type === "market";
  const order = {
    id: genId(), ticker, side, qty, type,
    limitPrice: limitPrice || null,
    status: filled ? "filled" : "open",
    fillPrice: filled ? price : null,
    at: Date.now(),
  };

  const next = { ...state, orders: [order, ...state.orders] };
  if (filled) {
    // Adjust holdings
    const idx = next.holdings.findIndex((h) => h.ticker === ticker);
    if (side === "buy") {
      if (idx >= 0) {
        const h = next.holdings[idx];
        const newQty = h.qty + qty;
        const newCost = (h.avgCost * h.qty + price * qty) / newQty;
        next.holdings[idx] = { ...h, qty: newQty, avgCost: newCost };
      } else {
        next.holdings.push({ ticker, qty, avgCost: price });
      }
    } else {
      if (idx < 0 || next.holdings[idx].qty < qty) throw new Error("Cantidad insuficiente para vender.");
      const h = next.holdings[idx];
      const remaining = h.qty - qty;
      if (remaining === 0) next.holdings.splice(idx, 1);
      else next.holdings[idx] = { ...h, qty: remaining };
    }
  }
  saveState(next);

  return { orderId: order.id, status: order.status, fillPrice: order.fillPrice };
}

/**
 * getOrders({ status }) — list of submitted orders.
 * Production: GET /orders?status=open|filled|all.
 */
export async function getOrders({ status = "all" } = {}) {
  await jitter();
  let rows = state.orders;
  if (status !== "all") rows = rows.filter((o) => o.status === status);
  return rows.map((o) => ({
    ...o,
    atLabel: relativeStamp(o.at),
  }));
}

/**
 * cancelOrder(orderId) — remove an open order.
 * Production: DELETE /orders/{id}.
 */
export async function cancelOrder(orderId) {
  await jitter();
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Orden no encontrada.");
  if (order.status !== "open") throw new Error("La orden no se puede cancelar.");
  saveState({ ...state, orders: state.orders.map((o) => o.id === orderId ? { ...o, status: "cancelled" } : o) });
  return { ok: true };
}

/**
 * getWatchlists() — user's saved watchlists.
 * Production: GET /watchlists.
 */
export async function getWatchlists() {
  await jitter();
  return state.watchlists.map((w) => ({ ...w, tickers: [...w.tickers] }));
}

/**
 * Watchlist mutations — addTicker / removeTicker / create / rename / remove.
 * Production: standard REST patterns on /watchlists.
 */
export async function addToWatchlist(watchlistId, ticker) {
  await jitter();
  const wl = state.watchlists.find((w) => w.id === watchlistId);
  if (!wl) throw new Error("Watchlist no encontrada.");
  if (wl.tickers.includes(ticker)) return { ok: true };
  saveState({ ...state, watchlists: state.watchlists.map((w) => w.id === watchlistId ? { ...w, tickers: [...w.tickers, ticker] } : w) });
  return { ok: true };
}
export async function removeFromWatchlist(watchlistId, ticker) {
  await jitter();
  saveState({ ...state, watchlists: state.watchlists.map((w) => w.id === watchlistId ? { ...w, tickers: w.tickers.filter((t) => t !== ticker) } : w) });
  return { ok: true };
}
export async function createWatchlist(name) {
  await jitter();
  if (!name || !name.trim()) throw new Error("Indicá un nombre.");
  const trimmed = name.trim().slice(0, 40);
  const wl = { id: genId(), name: trimmed, tickers: [] };
  saveState({ ...state, watchlists: [...state.watchlists, wl] });
  return wl;
}

/**
 * renameWatchlist(id, newName) — update display name.
 */
export async function renameWatchlist(id, newName) {
  await jitter();
  if (!newName || !newName.trim()) throw new Error("Indicá un nombre.");
  const trimmed = newName.trim().slice(0, 40);
  const next = {
    ...state,
    watchlists: state.watchlists.map((w) => w.id === id ? { ...w, name: trimmed } : w),
  };
  saveState(next);
  return { ok: true };
}

/**
 * removeWatchlist(id) — delete the list and all its tickers. Server
 * should verify ownership via RLS in production.
 *
 * The user can delete every list — the WatchlistView shows an empty
 * state with a "+ Crear lista" button when watchlists is empty, so
 * we no longer require keeping at least one around.
 */
export async function removeWatchlist(id) {
  await jitter();
  saveState({ ...state, watchlists: state.watchlists.filter((w) => w.id !== id) });
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

/**
 * setPriceAlert({ ticker, targetPrice, direction }) — fire when
 * the asset's price crosses targetPrice in `direction`.
 * @returns {Promise<{ ticker, targetPrice, direction, createdAt }>}
 */
export async function setPriceAlert({ ticker, targetPrice, direction = "above" }) {
  await jitter();
  const a = ASSETS.find((x) => x.ticker === ticker);
  if (!a) throw new Error("Ticker no encontrado.");
  if (!targetPrice || targetPrice <= 0) throw new Error("Precio objetivo inválido.");
  if (direction !== "above" && direction !== "below") throw new Error("Dirección inválida.");

  const alert = { ticker, targetPrice, direction, createdAt: Date.now() };
  saveState({ ...state, alerts: { ...state.alerts, [ticker]: alert } });
  return alert;
}

/**
 * removePriceAlert(ticker) — delete the alert for this ticker.
 */
export async function removePriceAlert(ticker) {
  await jitter();
  const next = { ...state, alerts: { ...state.alerts } };
  delete next.alerts[ticker];
  saveState(next);
  return { ok: true };
}

/**
 * getPriceAlerts() — flat list of all active alerts.
 */
export async function getPriceAlerts() {
  await jitter();
  return Object.values(state.alerts).map((a) => ({
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
