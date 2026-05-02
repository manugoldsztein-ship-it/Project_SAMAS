// ============================================================
// uva.js (samas-0.4.26) — UVA-adjusted value helpers
// ============================================================
// UVA (Unidad de Valor Adquisitivo) is BCRA's inflation-indexed
// reference unit. Updated daily based on CER. Argentinians use it
// to express savings/loans/rents in real terms — a balance of "709
// UVA" is independent of the nominal-peso treadmill.
//
// SAMAS exposes UVA as a third unit alongside ARS and USD on the
// Wallet hero, portfolio peek, and key Pro Wallet cards. Cohen's
// asesor channel will recognize this immediately — it's how every
// AR financial advisor explains "real" returns to a retail client.
// Zero competing brokers expose this natively.
//
// PRODUCTION DATA SOURCE
//   BCRA publishes UVA daily at:
//   https://api.bcra.gob.ar/estadisticas/v3.0/Monetarias/27
//   In production, an Edge Function fetches this once per day,
//   caches in a public.fx_rates table (or extends the existing
//   one), and the client reads from there. For the prototype we
//   hardcode realistic values pinned to the demo's "current date"
//   (CLAUDE.md says today = 2026-05-01). Swap the constants below
//   when wiring real data — UI doesn't change.
//
// VALUES BELOW are illustrative. Real UVA in mid-2026 will likely
// trade 2-4x higher; we tune for visual coherence with the demo's
// other numbers (balance ~ARS 1-5M, portfolio ~ARS 1-10M).
// ============================================================

// Current UVA value in ARS. Demo-grade. ~140% accumulated inflation
// since 2023's UVA=200 baseline gives a present value around 2200,
// with month-over-month drift modest (~1-2%) reflecting the slowing
// 2025-2026 inflation regime per the demo storyline.
export const UVA_NOW = 2240; // ARS per UVA, as of demo "today"

// Reference values for the timeline comparison shown on the Wallet
// hero when UVA mode is active. Each is the UVA value N months ago
// — used to compute "your real value vs N months ago".
export const UVA_HISTORY = {
  m1:  2195,  // 1 month ago
  m3:  2060,  // 3 months ago
  m6:  1880,  // 6 months ago
  m12: 1480,  // 12 months ago
};

// Convert ARS → UVA at the current rate.
export function arsToUva(amountArs) {
  if (typeof amountArs !== "number" || !isFinite(amountArs)) return 0;
  if (UVA_NOW <= 0) return 0;
  return amountArs / UVA_NOW;
}

// Format a UVA value for display. UVA conventionally shown with
// 0-2 decimals depending on size — like "709 UVA" or "0.34 UVA".
export function fmtUva(uva) {
  if (typeof uva !== "number" || !isFinite(uva)) return "—";
  const abs = Math.abs(uva);
  // For tiny amounts (<10 UVA), show 2 decimals; otherwise round to
  // whole units (UVAs are large enough that decimals are noise).
  const decimals = abs < 10 ? 2 : 0;
  return uva.toLocaleString("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Compute "real value vs N months ago" given the user's CURRENT
// nominal ARS balance and a reference period.
//
// The math: if the user had balance B today (in ARS), their CURRENT
// real-value is B/UVA_NOW. Their balance N months ago — if it was
// B_then ARS — represented B_then / UVA_HISTORY[period] UVA. We
// compare those two numbers to surface "you actually lost/gained
// real purchasing power."
//
// This function is intentionally simple — we don't have a balance
// history yet (would require a snapshot table), so we approximate
// "your N-months-ago balance" using the SAME nominal balance and
// just changing the UVA divisor. The comparison still tells a
// meaningful story: "if you've been holding nominal ARS for N
// months, here's how much real value you lost to inflation."
export function uvaVsHistoryMessage(balanceArs, period = "m6") {
  if (!balanceArs || balanceArs <= 0) return null;
  const past = UVA_HISTORY[period];
  if (!past) return null;
  const nowUva = balanceArs / UVA_NOW;
  const pastUva = balanceArs / past;
  const lossPct = (nowUva / pastUva - 1) * 100;
  return { nowUva, pastUva, lossPct, period };
}

// Date label for the period — used in i18n vars.
export function periodLabel(period) {
  return ({
    m1:  "1 mes",
    m3:  "3 meses",
    m6:  "6 meses",
    m12: "12 meses",
  })[period] || period;
}
