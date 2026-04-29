// ============================================================
// DEMO SEED — populate the user's account with starter holdings.
// ============================================================
// Triggered from Settings → Demo section. Inserts a curated mix of
// holdings + watchlists into Supabase so a fresh account doesn't
// land on empty-state screens during a walkthrough.
//
// 0.0.76: migrated from localStorage to real Supabase tables. The
// seed now lands in public.holdings (RLS-scoped to the caller) so
// uninstalling/reinstalling the app preserves the seeded portfolio
// instead of losing it. Same intent, durable storage.
//
// resetDemoAccount() does the inverse: deletes every holding +
// transaction the user has so the next render shows the empty-
// state onboarding. Profile / preferences / social state stay put.
// ============================================================

import { supabase } from "./supabase.js";

// Seven holdings: three ARG stocks, three US CEDEARs, one BTC. Avg
// prices are set slightly below the live ASSETS quotes in
// src/v2/api/broker.js so PnL renders positive across the board —
// matters for any screenshot / walkthrough where the user expects
// to see green numbers as a baseline state.
const DEMO_HOLDINGS = [
  { ticker: "GGAL", qty: 500,  avgCost: 4150    , currency: "ARS" },
  { ticker: "YPF",  qty: 120,  avgCost: 38000   , currency: "ARS" },
  { ticker: "PAMP", qty: 800,  avgCost: 5600    , currency: "ARS" },
  { ticker: "AAPL", qty: 60,   avgCost: 200.00  , currency: "USD" },
  { ticker: "NVDA", qty: 25,   avgCost: 850.00  , currency: "USD" },
  { ticker: "MSFT", qty: 40,   avgCost: 420.00  , currency: "USD" },
  { ticker: "BTC",  qty: 0.05, avgCost: 90000.00, currency: "USD" },
];

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error("Sesión no encontrada.");
  return data.user.id;
}

/**
 * seedDemoAccount() — bulk-upsert the demo holdings onto the
 * caller's account. Idempotent: re-running replaces each holding's
 * qty + avg_cost with the seed values (re-tapping the button in
 * Settings doesn't compound). Reloads the page on success so
 * Wallet / Broker re-fetch the new state on mount.
 */
export async function seedDemoAccount() {
  try {
    const userId = await currentUserId();
    const rows = DEMO_HOLDINGS.map((h) => ({
      user_id: userId,
      ticker:  h.ticker,
      qty:     h.qty,
      avg_cost: h.avgCost,
      currency: h.currency,
      updated_at: new Date().toISOString(),
    }));
    // onConflict on the (user_id, ticker) composite PK so re-runs
    // overwrite cleanly rather than duplicating rows.
    const { error } = await supabase
      .from("holdings")
      .upsert(rows, { onConflict: "user_id,ticker" });
    if (error) throw new Error(error.message);

    // Reload so any cached state in the v2 broker (none today, but
    // future caching layers might) gets a clean re-fetch on mount.
    setTimeout(() => window.location.reload(), 200);
  } catch (e) {
    console.error("[demoSeed] seed failed:", e);
    alert(`No pudimos cargar los datos demo: ${e?.message || e}`);
  }
}

/**
 * resetDemoAccount() — the inverse: drops every holding + trade
 * transaction for the caller. Profile / posts / follows / DMs /
 * preferences are intentionally NOT touched (those are durable
 * social state, not "demo portfolio"). For full account deletion
 * use Settings → Mi cuenta → Borrar mi cuenta (0.0.63).
 */
export async function resetDemoAccount() {
  try {
    const userId = await currentUserId();
    // Holdings — delete every row keyed to me.
    const { error: hErr } = await supabase
      .from("holdings").delete().eq("user_id", userId);
    if (hErr) throw new Error(hErr.message);
    // Transactions — drop trade-related rows. Aportes / dividends
    // (when wired) stay; this is scoped to broker activity only.
    await supabase.from("transactions").delete()
      .eq("user_id", userId)
      .in("kind", ["trade_buy", "trade_sell"]);
    // Orders — RLS lacks DELETE policy so we leave orders as
    // historical record (insert-only ledger). They'll show as
    // "filled" against now-zero positions; that's acceptable for
    // an audit log.
    setTimeout(() => window.location.reload(), 200);
  } catch (e) {
    console.error("[demoSeed] reset failed:", e);
    alert(`No pudimos vaciar la cuenta: ${e?.message || e}`);
  }
}
