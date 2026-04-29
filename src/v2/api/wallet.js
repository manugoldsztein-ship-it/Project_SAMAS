// ============================================================
// SAMAS v2 — Wallet API (Supabase-backed since samas-0.0.80)
// ============================================================
// Owns: ARS + USD cash balance, deposits, withdrawals, swaps, the
// transactions ledger. Does NOT own: invested holdings (broker.js),
// card movements (card.js), social interactions (social.js).
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
// 0.0.80 — moved from in-memory mock to Supabase tables:
//   public.accounts       (user_id, currency)  →  numeric balance per pair
//   public.transactions   (id, user_id, kind, amount, currency, reference, memo, created_at)
//
// CVU + alias are still static synthetic strings — they're fake (no
// real wallet rail wired) and only exist so the UI has something to
// render in the "Cómo recibir" section. When a real partner lands
// these come from the partner's onboarding response.
// ============================================================

import { jitter, maybeFail, relativeStamp } from "./_mock.js";
import { supabase } from "../../lib/supabase.js";

// Static synthetic CVU/alias. Same values for every user during
// the prototype phase — replace with a per-user issuance call when
// MP/MODO is wired.
const DEMO_CVU   = "0000003100012345678901";
const DEMO_ALIAS = "samas.santi.wallet";

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error("Sesión no encontrada.");
  return data.user.id;
}

// ----------------------------------------------------------
// Row mapping — DB transactions row → UI Transaction shape.
// ----------------------------------------------------------
// DB schema:
//   { id, user_id, kind, amount (signed), currency, reference, memo, created_at }
// UI shape (preserved from the legacy mock so PaymentsView /
// WalletPage / TransactionsList don't have to change):
//   { id, type, who, amount (positive), ccy, note, cat, at, atLabel }
// ----------------------------------------------------------
function txRowToUi(r) {
  const amount = Number(r.amount || 0);
  const at = r.created_at ? new Date(r.created_at).getTime() : Date.now();
  // Type: signed amount drives in/out; swap stays as its own type so
  // the UI can render the dual-arrow icon.
  const type = r.kind === "swap" ? "swap" : (amount >= 0 ? "in" : "out");
  // Category: maps DB kind → UI category bucket.
  const cat = (() => {
    switch (r.kind) {
      case "deposit":     return "income";
      case "withdrawal":  return "transfer";
      case "trade_buy":
      case "trade_sell":
      case "dividend":    return "invest";
      case "swap":        return "swap";
      case "fee":         return "fee";
      default:            return "transfer";
    }
  })();
  // Counter-party label: reference is the canonical slot for this
  // (e.g. "Mercado Pago", "AAPL", "ARS → USD"). Falls back to a
  // sensible default per kind.
  const who = r.reference || (() => {
    switch (r.kind) {
      case "deposit":     return "Depósito";
      case "withdrawal":  return "Retiro";
      case "trade_buy":   return "Compra";
      case "trade_sell":  return "Venta";
      case "swap":        return r.currency === "USD" ? "ARS → USD" : "USD → ARS";
      case "dividend":    return "Dividendo";
      default:            return "Movimiento";
    }
  })();
  return {
    id: r.id,
    type,
    who,
    amount: Math.abs(amount),
    ccy: r.currency,
    note: r.memo || "",
    cat,
    at,
    atLabel: relativeStamp(at),
  };
}

// ----------------------------------------------------------
// Public API
// ----------------------------------------------------------

/**
 * getBalance() — current ARS + USD cash balance.
 *
 * Reads two rows from public.accounts (one per currency). Missing
 * rows default to 0 — first-time users won't have any account row
 * until they deposit / get seeded.
 *
 * @returns {Promise<{ ars: number, usd: number, cvu: string, alias: string }>}
 */
export async function getBalance() {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("accounts")
    .select("currency, balance")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const map = Object.fromEntries((data || []).map((r) => [r.currency, Number(r.balance) || 0]));
  return {
    ars: map.ARS || 0,
    usd: map.USD || 0,
    cvu: DEMO_CVU,
    alias: DEMO_ALIAS,
  };
}

/**
 * getTransactions({ limit, before }) — newest-first movement list.
 *
 * Pulls every kind from the ledger (cash in/out, swaps, trade fills
 * from broker.js placeOrder, dividends when wired). The `before`
 * cursor uses created_at for keyset pagination — pass the at value
 * from the last row of the previous page to fetch the next one.
 */
export async function getTransactions({ limit = 50, before } = {}) {
  const userId = await currentUserId();
  let q = supabase
    .from("transactions")
    .select("id, kind, amount, currency, reference, memo, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (before) q = q.lt("created_at", new Date(before).toISOString());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(txRowToUi);
}

// ----------------------------------------------------------
// Internal helper — atomically apply a balance delta + ledger row.
// ----------------------------------------------------------
// We don't have a single SQL transaction here; supabase-js doesn't
// expose multi-statement transactions on the client. The order is:
//   1. Read current balance (default 0).
//   2. Compute new balance.
//   3. Upsert account row.
//   4. Insert transaction row.
// If step 4 fails the balance change is already in place, which is
// the wrong direction for atomicity. Acceptable for the prototype —
// when we wire a partner rail the partner's settlement webhook is
// the source of truth and we'll re-derive both. A real production
// implementation would call a Postgres function via RPC that wraps
// both writes in a single transaction.
async function applyLedgerEntry({ userId, currency, delta, kind, reference, memo }) {
  // Read current.
  const { data: cur, error: rErr } = await supabase
    .from("accounts")
    .select("balance")
    .eq("user_id", userId)
    .eq("currency", currency)
    .maybeSingle();
  if (rErr) throw new Error(rErr.message);
  const currentBalance = Number(cur?.balance || 0);
  const newBalance = Number((currentBalance + delta).toFixed(2));
  // Upsert account.
  const { error: aErr } = await supabase
    .from("accounts")
    .upsert(
      { user_id: userId, currency, balance: newBalance, updated_at: new Date().toISOString() },
      { onConflict: "user_id,currency" }
    );
  if (aErr) throw new Error(aErr.message);
  // Insert ledger row. amount is SIGNED — positive for inflow,
  // negative for outflow — so a SUM(amount) over the ledger
  // reconciles the balance trivially.
  const { data: tx, error: tErr } = await supabase
    .from("transactions")
    .insert({
      user_id: userId,
      kind,
      amount: delta,
      currency,
      reference: reference || null,
      memo: memo || null,
    })
    .select("id, created_at")
    .single();
  if (tErr) throw new Error(tErr.message);
  return { txId: tx.id, newBalance };
}

/**
 * deposit({ amount, ccy, source }) — credit cash to the user's
 * account and write a deposit row to the ledger.
 *
 * Mock semantics: lands instantly. Real semantics: returns a
 * payment intent (MP checkout URL etc.) and the partner's webhook
 * actually credits when the money clears.
 */
export async function deposit({ amount, ccy = "ARS", source = "mp", note }) {
  await jitter(400, 900);
  if (!amount || amount <= 0) throw new Error("Monto inválido.");
  if (ccy !== "ARS" && ccy !== "USD") throw new Error("Moneda inválida.");
  await maybeFail(0.05, "El depósito fue rechazado por el banco. Probá de nuevo.");

  const userId = await currentUserId();
  const reference = source === "mp" ? "Mercado Pago" : "Transferencia";
  const memo = note || (source === "mp" ? "Depósito MP" : "Transferencia entrante");

  const { txId, newBalance } = await applyLedgerEntry({
    userId,
    currency: ccy,
    delta: amount,
    kind: "deposit",
    reference,
    memo,
  });

  return {
    txnId: txId,
    newBalance,
    redirectUrl: source === "mp" ? `https://mock.mp/checkout/${txId}` : undefined,
  };
}

/**
 * withdraw({ amount, ccy, destinationCbu, destinationAlias }) — debit
 * cash + write a withdrawal row.
 *
 * Validates balance ≥ amount client-side (the read-then-write race is
 * acceptable for a prototype — RLS still prevents cross-user mischief,
 * and a real partner would re-validate).
 */
export async function withdraw({ amount, ccy = "ARS", destinationCbu, destinationAlias, note }) {
  await jitter(400, 900);
  if (!amount || amount <= 0) throw new Error("Monto inválido.");
  if (!destinationCbu && !destinationAlias) throw new Error("Indicá CBU o alias destino.");

  const userId = await currentUserId();
  // Read current balance to enforce sufficient funds.
  const { data: cur } = await supabase
    .from("accounts")
    .select("balance")
    .eq("user_id", userId).eq("currency", ccy)
    .maybeSingle();
  if ((Number(cur?.balance || 0)) < amount) throw new Error("Saldo insuficiente.");

  await maybeFail(0.04, "El retiro fue rechazado. El destinatario no es válido.");

  const reference = destinationAlias || (destinationCbu ? destinationCbu.slice(0, 6) + "…" : "Retiro");
  const memo = note || `Retiro a ${destinationAlias || "CBU"}`;

  const { txId, newBalance } = await applyLedgerEntry({
    userId,
    currency: ccy,
    delta: -amount,                // outflow → negative
    kind: "withdrawal",
    reference,
    memo,
  });

  return { txnId: txId, newBalance };
}

/**
 * swap({ from, to, amountFrom, rate }) — convert ARS↔USD.
 *
 * One swap = TWO ledger rows (the outgoing leg in `from` currency +
 * the incoming leg in `to` currency). Both are kind='swap' so the
 * UI shows them as a single swap entry per leg. Balances on both
 * accounts move atomically (per the same caveat as applyLedgerEntry).
 */
export async function swap({ from, to, amountFrom, rate }) {
  await jitter();
  if (from === to) throw new Error("Origen y destino deben diferir.");
  if (!Number.isFinite(amountFrom) || amountFrom <= 0) throw new Error("Monto inválido.");
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Tipo de cambio inválido.");

  const userId = await currentUserId();
  // Sufficient funds in `from`.
  const { data: cur } = await supabase
    .from("accounts")
    .select("balance")
    .eq("user_id", userId).eq("currency", from)
    .maybeSingle();
  if ((Number(cur?.balance || 0)) < amountFrom) throw new Error("Saldo insuficiente.");

  const amountTo = from === "ARS" ? amountFrom / rate : amountFrom * rate;
  const reference = `${from} → ${to}`;
  const memo = `Cambio @ ${rate.toFixed(2)}`;

  // Outgoing leg in `from`.
  await applyLedgerEntry({
    userId, currency: from, delta: -amountFrom,
    kind: "swap", reference, memo,
  });
  // Incoming leg in `to`.
  await applyLedgerEntry({
    userId, currency: to, delta: amountTo,
    kind: "swap", reference, memo,
  });

  // Re-fetch both balances for the response.
  const { data: rows } = await supabase
    .from("accounts").select("currency, balance")
    .eq("user_id", userId);
  const map = Object.fromEntries((rows || []).map((r) => [r.currency, Number(r.balance) || 0]));

  return {
    txnId: `swap-${Date.now()}`,
    amountTo,
    balances: { ars: map.ARS || 0, usd: map.USD || 0 },
  };
}

// ----------------------------------------------------------
// Test helpers — used in dev to reset state. The Supabase-backed
// reset lives in src/lib/demoSeed.js (resetDemoAccount); _resetDemo
// here is a no-op to preserve the export signature for any caller
// that hasn't migrated yet.
// ----------------------------------------------------------
export function _resetDemo() {
  // No-op since 0.0.80 — see resetDemoAccount() in src/lib/demoSeed.js.
}

// ----------------------------------------------------------
// Recurring aporte mensual
// ----------------------------------------------------------
// User schedules a recurring deposit: amount + currency + day of
// month. Persisted server-side in public.recurring_aportes — the
// process-recurring-aportes Edge Function runs daily and credits the
// wallet via wallet_credits. While the user is between phones (or the
// table hasn't been migrated yet) we fall back to a localStorage
// stub so the UI keeps working.
//
// Public shape (unchanged so callers don't need updating):
//   { amount, currency, dayOfMonth, nextAt, lastAt, createdAt }

const APORTE_KEY = "samas_v2_aporte_mock";

function loadAporteLocal() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(APORTE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveAporteLocal(a) {
  if (typeof localStorage !== "undefined") {
    try {
      if (a) localStorage.setItem(APORTE_KEY, JSON.stringify(a));
      else localStorage.removeItem(APORTE_KEY);
    } catch {}
  }
}

// Return the next-monthly DATE (calendar) >= today for a given day-of-
// month. We work in local-time because the user picks days in their
// local frame ("the 5th") — we'll switch to AR time when we go
// production.
function nextDateFor(dayOfMonth) {
  const today = new Date();
  const d = Math.max(1, Math.min(28, Number(dayOfMonth) || 1));
  const candidate = new Date(today.getFullYear(), today.getMonth(), d);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (candidate.getTime() < startOfToday.getTime()) {
    candidate.setMonth(candidate.getMonth() + 1);
  }
  return candidate.getTime();
}

// Convert a YYYY-MM-DD date string (Supabase DATE column) to a JS ms.
function dateStringToMs(s) {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
}
function msToDateString(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Detect the "table doesn't exist" flavour error so we degrade
// gracefully when the migration hasn't been applied yet.
function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const msg = String(error.message || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("schema cache");
}
let _aporteMissingTableWarned = false;
function warnMissingAporteTableOnce() {
  if (_aporteMissingTableWarned) return;
  _aporteMissingTableWarned = true;
  console.warn("[aporte] recurring_aportes table not migrated yet — using local fallback. Apply supabase/recurring_aportes.sql to persist server-side.");
}

function rowToAporte(row) {
  if (!row) return null;
  return {
    amount: Number(row.amount),
    currency: row.currency,
    dayOfMonth: row.day_of_month,
    nextAt: dateStringToMs(row.next_due),
    lastAt: row.last_credited_at ? new Date(row.last_credited_at).getTime() : null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

// nextAt drifts as the calendar advances. Recompute on read so the
// UI doesn't show "next: 5 days ago" if the device was offline.
function rebaseAporte(a) {
  if (!a) return null;
  return { ...a, nextAt: nextDateFor(a.dayOfMonth) };
}

/**
 * getRecurringAporte() — returns the active schedule or null.
 * Shape: { amount, currency, dayOfMonth, nextAt(ms), lastAt(ms|null), createdAt(ms) }
 */
export async function getRecurringAporte() {
  try {
    const { data: u } = await supabase.auth.getUser();
    const userId = u?.user?.id;
    if (!userId) return rebaseAporte(loadAporteLocal());
    const { data, error } = await supabase
      .from("recurring_aportes")
      .select("amount, currency, day_of_month, next_due, last_credited_at, created_at, active")
      .eq("user_id", userId)
      .eq("active", true)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) {
        warnMissingAporteTableOnce();
        return rebaseAporte(loadAporteLocal());
      }
      console.warn("[aporte] get:", error.message);
      return rebaseAporte(loadAporteLocal());
    }
    if (!data) return null;
    const result = rowToAporte(data);
    saveAporteLocal(result);
    return result;
  } catch (e) {
    console.warn("[aporte] get caught:", e?.message);
    return rebaseAporte(loadAporteLocal());
  }
}

/**
 * setRecurringAporte({ amount, currency, dayOfMonth }) — create or
 * replace the schedule. Pass null/undefined to disable.
 */
export async function setRecurringAporte(input) {
  if (!input || !input.amount || input.amount <= 0) {
    return cancelRecurringAporte();
  }
  const currency = input.currency === "USD" ? "USD" : "ARS";
  const dayOfMonth = Math.max(1, Math.min(28, Math.round(Number(input.dayOfMonth) || 1)));
  const amount = Number(input.amount);
  const nextAt = nextDateFor(dayOfMonth);
  const local = {
    amount, currency, dayOfMonth, nextAt,
    lastAt: input.lastAt || null,
    createdAt: input.createdAt || Date.now(),
  };

  try {
    const { data: u } = await supabase.auth.getUser();
    const userId = u?.user?.id;
    if (!userId) {
      saveAporteLocal(local);
      return local;
    }
    const { error } = await supabase
      .from("recurring_aportes")
      .upsert({
        user_id: userId,
        amount,
        currency,
        day_of_month: dayOfMonth,
        next_due: msToDateString(nextAt),
        active: true,
      }, { onConflict: "user_id" });
    if (error) {
      if (isMissingTableError(error)) {
        warnMissingAporteTableOnce();
        saveAporteLocal(local);
        return local;
      }
      throw new Error(error.message);
    }
    saveAporteLocal(local);
    return local;
  } catch (e) {
    console.warn("[aporte] set:", e?.message);
    saveAporteLocal(local);
    return local;
  }
}

/** Disable / cancel the schedule. */
export async function cancelRecurringAporte() {
  try {
    const { data: u } = await supabase.auth.getUser();
    const userId = u?.user?.id;
    if (userId) {
      const { error } = await supabase
        .from("recurring_aportes")
        .update({ active: false })
        .eq("user_id", userId);
      if (error && !isMissingTableError(error)) {
        console.warn("[aporte] cancel:", error.message);
      }
    }
  } catch (e) {
    console.warn("[aporte] cancel caught:", e?.message);
  }
  saveAporteLocal(null);
  return null;
}
