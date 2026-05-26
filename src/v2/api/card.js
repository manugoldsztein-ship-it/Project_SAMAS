// ============================================================
// SAMAS v2 — Card API (virtual prepaid debit card)
// ============================================================
// Owns: the user's virtual SAMAS card. Returns metadata (last 4,
// expiry, status), the full PAN/CVV when explicitly asked
// (revealCard()), and card-specific transactions.
//
// PRODUCTION INTEGRATION TARGET — Pomelo (Argentina)
//   Pomelo is the dominant fintech-card-issuer-as-a-service in AR.
//   They expose:
//     POST /cards                       create a card for a user
//     GET  /cards/{id}                  card metadata (last 4, status, ...)
//     GET  /cards/{id}/sensitive_data   full PAN + CVV (auth-gated, short TTL)
//     POST /cards/{id}/freeze
//     POST /cards/{id}/unfreeze
//     GET  /cards/{id}/transactions     auth's, settlements
//
//   The mock below mirrors that shape so swapping is trivial.
//
// SECURITY NOTE — full PAN handling
//   Real Pomelo doesn't return the PAN unless you call sensitive_data
//   with an OTP / fresh auth. The mock skips that step for demo. When
//   wiring real API: gate revealCard() behind a Face ID / PIN prompt.
// ============================================================

import { jitter, maybeFail, genId, relativeStamp } from "./_mock.js";

const STORAGE_KEY = "samas_v2_card_mock";

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
  // Mock card. Real Pomelo PAN is generated server-side; we never
  // store it client-side. For the demo we just hardcode something
  // recognizable but obviously fake.
  return {
    id: "mock_card_001",
    last4: "1234",
    pan: "4242 4242 4242 1234",     // Stripe's classic test PAN — easy to spot in screenshots.
    cvv: "123",
    expMonth: 12,
    expYear: 30,
    holderName: "MANUEL GOLDSZTEIN",
    network: "visa",                 // "visa" | "mastercard"
    status: "active",                // "active" | "frozen" | "blocked"
    createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    transactions: seedCardTxns(),
  };
}

function seedCardTxns() {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  return [
    { id: genId(), merchant: "Café Martínez",  amount: 4_800_00,  ccy: "ARS", at: now - 3 * hour,        status: "settled" },
    { id: genId(), merchant: "Spotify",        amount: 7_990_00,  ccy: "ARS", at: now - 24 * hour,       status: "settled" },
    { id: genId(), merchant: "Uber",           amount: 5_400_00,  ccy: "ARS", at: now - 30 * hour,       status: "settled" },
    { id: genId(), merchant: "Apple Music",    amount: 4_99,      ccy: "USD", at: now - 4 * 24 * hour,   status: "settled" },
    { id: genId(), merchant: "Netflix",        amount: 4_899_00,  ccy: "ARS", at: now - 7 * 24 * hour,   status: "settled" },
  ];
}

let state = loadState();

// ----------------------------------------------------------
// Public API
// ----------------------------------------------------------

/**
 * getCard() — non-sensitive card metadata. Safe to call on every
 * page load.
 *
 * Production: GET /cards/{id} on Pomelo (or whoever).
 *
 * @returns {Promise<{
 *   id: string,
 *   last4: string,
 *   expMonth: number,
 *   expYear: number,
 *   holderName: string,
 *   network: "visa" | "mastercard",
 *   status: "active" | "frozen" | "blocked",
 * }>}
 */
export async function getCard() {
  await jitter();
  return {
    id: state.id,
    last4: state.last4,
    expMonth: state.expMonth,
    expYear: state.expYear,
    holderName: state.holderName,
    network: state.network,
    status: state.status,
  };
}

/**
 * revealCard() — full PAN + CVV. **Only call after a fresh user
 * confirmation** (Face ID / PIN). Never cache the result; let it
 * stay in component state with an auto-clear timer (e.g. hide
 * after 30 s).
 *
 * Production: POST /cards/{id}/sensitive_data with a recent auth
 * token. Pomelo returns short-TTL credentials.
 *
 * @returns {Promise<{ pan: string, cvv: string, expMonth: number, expYear: number }>}
 */
export async function revealCard() {
  await jitter(300, 700);
  await maybeFail(0.02, "No pudimos mostrar la tarjeta. Probá de nuevo.");
  return {
    pan: state.pan,
    cvv: state.cvv,
    expMonth: state.expMonth,
    expYear: state.expYear,
  };
}

/**
 * freezeCard() / unfreezeCard() — toggle ability to authorize new
 * charges. Existing pending auths still settle.
 *
 * Production: POST /cards/{id}/freeze | /unfreeze.
 *
 * @returns {Promise<{ status: "active" | "frozen" }>}
 */
export async function freezeCard() {
  await jitter();
  await maybeFail();
  saveState({ ...state, status: "frozen" });
  return { status: "frozen" };
}
export async function unfreezeCard() {
  await jitter();
  await maybeFail();
  saveState({ ...state, status: "active" });
  return { status: "active" };
}

/**
 * getCardTransactions({ limit }) — settlements + auths on the card.
 * Distinct from wallet.getTransactions() which is wallet-rail only;
 * card transactions are a separate stream from the issuer.
 *
 * Production: GET /cards/{id}/transactions?limit=50.
 */
export async function getCardTransactions({ limit = 50 } = {}) {
  await jitter();
  return state.transactions.slice(0, limit).map((t) => ({
    id: t.id,
    merchant: t.merchant,
    amount: t.amount / 100,
    ccy: t.ccy,
    at: t.at,
    atLabel: relativeStamp(t.at),
    status: t.status,
  }));
}

// ----------------------------------------------------------
// Demo helpers
// ----------------------------------------------------------
export function _resetDemo() {
  saveState(seed());
}
