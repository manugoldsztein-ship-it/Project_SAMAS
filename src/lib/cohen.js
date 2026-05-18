// ============================================================
// COHEN — client for the samas-cohen-api bridge service
// ============================================================
// samas-cohen-api is a separate backend (Java / Spring Boot) that
// wraps Cohen's "Api Connect" broker platform. The app never talks
// to Cohen directly — it calls this service, which validates the
// Supabase JWT, attaches Cohen's own bearer token, and returns
// clean SAMAS-shaped JSON.
//
// Base URL comes from VITE_COHEN_API_BASE (e.g. http://localhost:8080
// for a local run, or the Fly.io URL once the service is deployed).
// While it is unset every call throws — this module stays dormant
// until the service is reachable, so importing it changes nothing.
//
// Endpoints (all require the user's Supabase session):
//   getComitentes()                  -> GET  /v1/comitentes
//   getPositions(comitenteId)        -> GET  /v1/positions
//   getMovements(comitenteId, opts)  -> GET  /v1/movements
//   getPerformance(comitenteId, per) -> GET  /v1/performance
//   getPnl(comitenteId, date)        -> GET  /v1/pnl
//   getInstrument(id)                -> GET  /v1/instruments/{id}
//   getOrderTypes()                  -> GET  /v1/orders/types
//   placeOrder(order)                -> POST /v1/orders
// ============================================================

import { SUPABASE_URL } from "./supabase";

const COHEN_API_BASE = (import.meta.env.VITE_COHEN_API_BASE || "").replace(/\/+$/, "");

// True once VITE_COHEN_API_BASE is set. Callers can branch on this to
// keep the existing (simulated) broker as the fallback.
export const cohenConfigured = !!COHEN_API_BASE;

// Read the Supabase access token straight from localStorage — same
// SDK-bypass pattern as news.js (supabase.auth.getSession() hangs
// intermittently on this build). The service validates this JWT
// against Supabase's JWKS, so a fresh token is all it needs.
async function authToken() {
  try {
    const ref = (SUPABASE_URL.match(/https:\/\/([^.]+)\./) || [])[1];
    if (!ref || typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    return JSON.parse(raw)?.access_token || null;
  } catch {
    return null;
  }
}

async function fetchTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Core request helper: attaches the bearer token, decodes JSON, and
// turns a non-2xx into a thrown Error carrying the service's
// ProblemDetail message when there is one.
async function cohenFetch(path, { method = "GET", body } = {}) {
  if (!COHEN_API_BASE) {
    throw new Error("Cohen API no configurada (falta VITE_COHEN_API_BASE).");
  }
  const token = await authToken();
  if (!token) throw new Error("No hay sesión activa.");

  const resp = await fetchTimeout(`${COHEN_API_BASE}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    // The service returns RFC-7807 ProblemDetail JSON on errors.
    const detail = await resp.json().catch(() => null);
    const msg = detail?.detail || detail?.title || `HTTP ${resp.status}`;
    throw new Error(`Cohen: ${msg}`);
  }
  if (resp.status === 204) return null;
  return resp.json();
}

// Build a ?query=string from an object, dropping empty values.
function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

// --- Accounts -------------------------------------------------

// The brokerage accounts (comitentes) the signed-in user can see.
// -> [{ id, name, active }]
export async function getComitentes() {
  return cohenFetch("/v1/comitentes");
}

// --- Portfolio ------------------------------------------------

// Current holdings for a comitente.
// -> [{ ticker, description, quantity, price, marketValue, currency, instrumentType }]
export async function getPositions(comitenteId) {
  return cohenFetch(`/v1/positions${qs({ comitenteId })}`);
}

// Movement / transaction history. opts: { from, to, instrumentId }, all optional.
// -> [{ id, date, description, ticker, amount, quantity, price, balance, currency, type }]
export async function getMovements(comitenteId, opts = {}) {
  return cohenFetch(`/v1/movements${qs({ comitenteId, ...opts })}`);
}

// Portfolio evolution + monthly returns. periodo is Cohen's 0-5 period enum.
// -> { evolution: [...], monthlyReturns: [...] }
export async function getPerformance(comitenteId, periodo) {
  return cohenFetch(`/v1/performance${qs({ comitenteId, periodo })}`);
}

// Realized + unrealized P&L. date (yyyy-MM-dd) optional, defaults to today.
// -> { currency, realized: [...], unrealized: [...] }
export async function getPnl(comitenteId, date) {
  return cohenFetch(`/v1/pnl${qs({ comitenteId, date })}`);
}

// --- Instruments ----------------------------------------------

// Detail for one instrument by Cohen instrument id.
// -> { symbol, description, isin, type, currency }
export async function getInstrument(id) {
  return cohenFetch(`/v1/instruments/${encodeURIComponent(id)}`);
}

// --- Orders ---------------------------------------------------

// Available order types (market / limit / ...).
// -> [{ id, code, description, fixCode }]
export async function getOrderTypes() {
  return cohenFetch("/v1/orders/types");
}

// Place a buy/sell. order: { currencyId, symbol, quantity, price, sell }.
// -> { ok, messages: [...] }
export async function placeOrder(order) {
  return cohenFetch("/v1/orders", { method: "POST", body: order });
}
