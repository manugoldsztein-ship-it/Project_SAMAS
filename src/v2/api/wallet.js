// ============================================================
// SAMAS v2 — Wallet API
// ============================================================
// Owns: ARS + USD cash balance, deposits, withdrawals, transactions.
// Does NOT own: invested holdings (broker.js), card movements
// (card.js), social interactions (social.js).
//
// PRODUCTION INTEGRATION TARGET — Argentine wallet rail
//   Likely partners: Mercado Pago Marketplace API, MODO, Geopagos,
//   dLocal. All work the same conceptually:
//     1. We hold a balance per-user in the partner's ledger.
//     2. Deposits = the user transfers to a CVU we issued for them.
//     3. Withdrawals = we instruct the partner to transfer out to a
//        destination CBU/Alias the user provides.
//     4. We register every state change as a "transaction" row in
//        our own DB so the UI list is fast.
//
// The mock implementation below stores everything in memory + a
// localStorage snapshot so a refresh doesn't wipe demo state.
// Replace each function's BODY when the real partner API arrives;
// the SIGNATURE stays the same so the UI keeps working.
// ============================================================

import { jitter, maybeFail, genId, relativeStamp } from "./_mock.js";

// ----------------------------------------------------------
// In-memory state (mirrored to localStorage for demo continuity).
// ----------------------------------------------------------
const STORAGE_KEY = "samas_v2_wallet_mock";

function loadState() {
  if (typeof localStorage === "undefined") return seed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : seed();
  } catch {
    return seed();
  }
}

function saveState(s) {
  state = s;
  if (typeof localStorage !== "undefined") {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
  }
}

function seed() {
  return {
    // Balances are kept in cents/centavos to avoid float drift.
    ars_centavos: 248_735_000,        // $2,487,350.00
    usd_cents: 421_842,               // US$4,218.42
    // CVU we "issued" — used for inbound deposits.
    cvu: "0000003100012345678901",
    alias: "samas.santi.wallet",
    // Last 50 movements. Newer first.
    transactions: seedTransactions(),
  };
}

function seedTransactions() {
  const now = Date.now();
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  return [
    { id: genId(), type: "in",   who: "Manuel G.",     amount: 85_000_00, ccy: "ARS", note: "Asado",                    cat: "transfer", at: now - 2 * hour },
    { id: genId(), type: "out",  who: "Compra AAPL",   amount: 215_40,    ccy: "USD", note: "1 acción @ US$215,40",      cat: "invest",   at: now - 5 * hour },
    { id: genId(), type: "in",   who: "Mercado Pago",  amount: 320_000_00,ccy: "ARS", note: "Cobro freelance",           cat: "income",   at: now - 1 * day },
    { id: genId(), type: "out",  who: "Café Martínez", amount: 4_800_00,  ccy: "ARS", note: "Tarjeta · Palermo",          cat: "card",     at: now - 1 * day - 3 * hour },
    { id: genId(), type: "swap", who: "ARS → USD",     amount: 200_00,    ccy: "USD", note: "Cambio MEP · $249.000",      cat: "swap",     at: now - 2 * day },
    { id: genId(), type: "out",  who: "Lucía P.",      amount: 12_500_00, ccy: "ARS", note: "Cumple Tomi",                cat: "transfer", at: now - 3 * day },
    { id: genId(), type: "in",   who: "Dividendo KO",  amount: 18_40,     ccy: "USD", note: "Coca-Cola Q1 2026",          cat: "invest",   at: now - 4 * day },
  ];
}

let state = loadState();

// ----------------------------------------------------------
// Public API
// ----------------------------------------------------------

/**
 * getBalance() — current ARS + USD cash balance.
 *
 * Production: GET /v1/wallets/{userId}/balance from the wallet rail.
 *
 * @returns {Promise<{
 *   ars: number,            // ARS amount in pesos (NOT centavos)
 *   usd: number,            // USD amount in dollars
 *   cvu: string,            // user's CVU for inbound transfers
 *   alias: string,          // user's alias (also valid for inbound)
 * }>}
 */
export async function getBalance() {
  await jitter();
  return {
    ars: state.ars_centavos / 100,
    usd: state.usd_cents / 100,
    cvu: state.cvu,
    alias: state.alias,
  };
}

/**
 * getTransactions({ limit, before }) — paginated movement list.
 *
 * Production: GET /v1/wallets/{userId}/transactions?limit=50&before=ts
 *
 * @param {{ limit?: number, before?: number }} opts
 * @returns {Promise<Array<Transaction>>}
 *
 * Transaction shape:
 *   id        unique
 *   type      "in" | "out" | "swap"
 *   who       counter-party display name
 *   amount    in major units (pesos / dollars), always positive
 *   ccy       "ARS" | "USD"
 *   note      free-form description
 *   cat       "transfer" | "income" | "card" | "invest" | "swap" | "fee"
 *   at        unix ms timestamp
 *   atLabel   pre-formatted relative stamp ("Hoy 14:32")
 */
export async function getTransactions({ limit = 50, before } = {}) {
  await jitter();
  let rows = state.transactions;
  if (before) rows = rows.filter((t) => t.at < before);
  return rows.slice(0, limit).map((t) => ({
    id: t.id,
    type: t.type,
    who: t.who,
    amount: t.amount / 100,
    ccy: t.ccy,
    note: t.note,
    cat: t.cat,
    at: t.at,
    atLabel: relativeStamp(t.at),
  }));
}

/**
 * deposit({ amount, ccy, source }) — request a deposit.
 *
 * In production this DOES NOT move money on its own. It returns a
 * payment intent (e.g. an MP checkout URL) for amounts coming from
 * the user's bank/MP. The real money lands when the partner notifies
 * us via webhook, at which point we record the transaction. The mock
 * just adds the balance immediately and creates a transaction row.
 *
 * @param {{
 *   amount: number,           // major units, > 0
 *   ccy: "ARS" | "USD",
 *   source: "mp" | "transfer", // mp = Mercado Pago link, transfer = via CVU
 *   note?: string,
 * }} input
 * @returns {Promise<{
 *   txnId: string,
 *   newBalance: number,        // post-deposit balance in `ccy`
 *   redirectUrl?: string,      // present when source==="mp"
 * }>}
 */
export async function deposit({ amount, ccy = "ARS", source = "mp", note }) {
  await jitter(400, 900);
  if (!amount || amount <= 0) throw new Error("Monto inválido.");
  await maybeFail(0.05, "El depósito fue rechazado por el banco. Probá de nuevo.");

  const cents = Math.round(amount * 100);
  const next = { ...state };
  if (ccy === "ARS") next.ars_centavos += cents;
  else if (ccy === "USD") next.usd_cents += cents;
  else throw new Error("Moneda inválida.");

  const txn = {
    id: genId(), type: "in",
    who: source === "mp" ? "Mercado Pago" : "Transferencia",
    amount: cents, ccy,
    note: note || (source === "mp" ? "Depósito MP" : "Transferencia entrante"),
    cat: "income",
    at: Date.now(),
  };
  next.transactions = [txn, ...next.transactions].slice(0, 50);
  saveState(next);

  return {
    txnId: txn.id,
    newBalance: ccy === "ARS" ? next.ars_centavos / 100 : next.usd_cents / 100,
    redirectUrl: source === "mp" ? `https://mock.mp/checkout/${txn.id}` : undefined,
  };
}

/**
 * withdraw({ amount, ccy, destinationCbu, destinationAlias }) — push
 * funds out to a user-supplied CBU or alias.
 *
 * Production: POST /v1/transfers with the destination + amount. The
 * partner clears it within seconds (on Coelsa/CCE rails).
 *
 * Validation we do client-side: balance ≥ amount, CBU has 22 digits
 * OR alias is non-empty. Server-side validation in production should
 * also check the destination is reachable.
 *
 * @param {{
 *   amount: number,
 *   ccy: "ARS" | "USD",
 *   destinationCbu?: string,    // 22-digit CBU
 *   destinationAlias?: string,  // free-form alias (max 30 chars)
 *   note?: string,
 * }} input
 * @returns {Promise<{ txnId: string, newBalance: number }>}
 */
export async function withdraw({ amount, ccy = "ARS", destinationCbu, destinationAlias, note }) {
  await jitter(400, 900);
  if (!amount || amount <= 0) throw new Error("Monto inválido.");
  if (!destinationCbu && !destinationAlias) throw new Error("Indicá CBU o alias destino.");

  const balance = ccy === "ARS" ? state.ars_centavos : state.usd_cents;
  const cents = Math.round(amount * 100);
  if (cents > balance) throw new Error("Saldo insuficiente.");

  await maybeFail(0.04, "El retiro fue rechazado. El destinatario no es válido.");

  const next = { ...state };
  if (ccy === "ARS") next.ars_centavos -= cents;
  else next.usd_cents -= cents;

  const txn = {
    id: genId(), type: "out",
    who: destinationAlias || destinationCbu.slice(0, 6) + "…",
    amount: cents, ccy,
    note: note || `Retiro a ${destinationAlias || "CBU"}`,
    cat: "transfer",
    at: Date.now(),
  };
  next.transactions = [txn, ...next.transactions].slice(0, 50);
  saveState(next);

  return { txnId: txn.id, newBalance: ccy === "ARS" ? next.ars_centavos / 100 : next.usd_cents / 100 };
}

/**
 * swap({ from, to, amountFrom, rate }) — convert ARS↔USD inside the
 * wallet at a given rate. The UI gets the rate from broker.getQuote()
 * (MEP rate) and passes it here.
 *
 * @param {{
 *   from: "ARS" | "USD",
 *   to: "ARS" | "USD",
 *   amountFrom: number,
 *   rate: number,         // ARS per USD (e.g. 1245)
 * }} input
 * @returns {Promise<{ txnId: string, amountTo: number, balances: { ars: number, usd: number } }>}
 */
export async function swap({ from, to, amountFrom, rate }) {
  await jitter();
  if (from === to) throw new Error("Origen y destino deben diferir.");
  if (!amountFrom || amountFrom <= 0) throw new Error("Monto inválido.");
  if (!rate || rate <= 0) throw new Error("Tipo de cambio inválido.");

  const fromCents = Math.round(amountFrom * 100);
  const fromKey = from === "ARS" ? "ars_centavos" : "usd_cents";
  if (fromCents > state[fromKey]) throw new Error("Saldo insuficiente.");

  const amountTo = from === "ARS" ? amountFrom / rate : amountFrom * rate;
  const toCents = Math.round(amountTo * 100);

  const next = { ...state };
  next[fromKey] -= fromCents;
  next[from === "ARS" ? "usd_cents" : "ars_centavos"] += toCents;

  const txn = {
    id: genId(), type: "swap",
    who: `${from} → ${to}`,
    amount: toCents, ccy: to,
    note: `Cambio @ ${rate.toFixed(2)}`,
    cat: "swap",
    at: Date.now(),
  };
  next.transactions = [txn, ...next.transactions].slice(0, 50);
  saveState(next);

  return {
    txnId: txn.id,
    amountTo,
    balances: { ars: next.ars_centavos / 100, usd: next.usd_cents / 100 },
  };
}

// ----------------------------------------------------------
// Test helpers — used in dev to reset the demo state. Not part of
// the production contract; remove when wiring real APIs.
// ----------------------------------------------------------
export function _resetDemo() {
  saveState(seed());
}

// ----------------------------------------------------------
// Recurring aporte mensual
// ----------------------------------------------------------
// User schedules a recurring deposit: amount + currency + day of
// month. We persist locally (samas_v2_aporte_mock) and the UI shows
// "next: <date>" and "last credited: <date>".
//
// Production: store in a recurring_deposits table, with a daily cron
// (Supabase scheduled function or external) that on day-of-month creates
// the deposit + buy split.
const APORTE_KEY = "samas_v2_aporte_mock";

function loadAporte() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(APORTE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveAporte(a) {
  if (typeof localStorage !== "undefined") {
    try {
      if (a) localStorage.setItem(APORTE_KEY, JSON.stringify(a));
      else localStorage.removeItem(APORTE_KEY);
    } catch {}
  }
}

/** Return the next-monthly date >= today for a given day-of-month. */
function nextDateFor(dayOfMonth) {
  const today = new Date();
  const d = Math.max(1, Math.min(28, Number(dayOfMonth) || 1));
  const candidate = new Date(today.getFullYear(), today.getMonth(), d);
  if (candidate.getTime() < today.setHours(0, 0, 0, 0)) {
    candidate.setMonth(candidate.getMonth() + 1);
  }
  return candidate.getTime();
}

/**
 * getRecurringAporte() — returns the active schedule or null.
 *
 * Shape: { amount: number, currency: "ARS"|"USD", dayOfMonth: number,
 *          nextAt: number(ms), lastAt: number(ms)|null, createdAt: number }
 */
export async function getRecurringAporte() {
  await jitter(80, 200);
  const a = loadAporte();
  if (!a) return null;
  // Recompute nextAt in case the day passed.
  return { ...a, nextAt: nextDateFor(a.dayOfMonth) };
}

/**
 * setRecurringAporte({ amount, currency, dayOfMonth }) — create or
 * replace the schedule. Pass null/undefined to disable.
 */
export async function setRecurringAporte(input) {
  await jitter(120, 280);
  if (!input || !input.amount || input.amount <= 0) {
    saveAporte(null);
    return null;
  }
  const currency = input.currency === "USD" ? "USD" : "ARS";
  const dayOfMonth = Math.max(1, Math.min(28, Math.round(Number(input.dayOfMonth) || 1)));
  const next = {
    amount: Number(input.amount),
    currency,
    dayOfMonth,
    nextAt: nextDateFor(dayOfMonth),
    lastAt: input.lastAt || null,
    createdAt: input.createdAt || Date.now(),
  };
  saveAporte(next);
  return next;
}

/** Disable / cancel the schedule. */
export async function cancelRecurringAporte() {
  await jitter(80, 180);
  saveAporte(null);
  return null;
}
