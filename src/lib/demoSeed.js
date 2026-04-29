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

// Three demo watchlists with tags + curated tickers. Color tags
// (Pro feature, 0.0.47) make the picker pop visually. Order matters
// — first list shows up first in the WatchlistView selector.
const DEMO_WATCHLISTS = [
  { name: "Tecnología US",     color: "blue",   tickers: ["AAPL", "NVDA", "MSFT", "GOOGL", "TSLA"] },
  { name: "Acciones argentinas", color: "green", tickers: ["GGAL", "YPF", "PAMP"] },
  { name: "Cripto",            color: "amber",  tickers: ["BTC", "ETH"] },
];

// Wallet seed (0.0.80) — a starter cash balance + a few transaction
// rows so the Wallet tab renders something on a fresh demo account.
// Amounts roughly match what the legacy localStorage seed had in
// pesos/dollars, give-or-take. We seed transactions backdated by a
// few hours/days so the "Movimientos" list looks real.
const DEMO_BALANCE_ARS = 2_487_350.00;
const DEMO_BALANCE_USD = 4_218.42;
const DEMO_TRANSACTIONS = [
  { kind: "deposit",    amount:   320_000.00, currency: "ARS", reference: "Mercado Pago",   memo: "Cobro freelance",   ageHours: 24 },
  { kind: "deposit",    amount:    85_000.00, currency: "ARS", reference: "Manuel G.",      memo: "Asado",             ageHours: 2 },
  { kind: "swap",       amount:       200.00, currency: "USD", reference: "ARS → USD",     memo: "Cambio MEP",         ageHours: 48 },
  { kind: "swap",       amount:  -249_000.00, currency: "ARS", reference: "ARS → USD",     memo: "Cambio MEP",         ageHours: 48 },
  { kind: "withdrawal", amount:   -12_500.00, currency: "ARS", reference: "Lucía P.",       memo: "Cumple Tomi",       ageHours: 72 },
  { kind: "dividend",   amount:        18.40, currency: "USD", reference: "KO",             memo: "Coca-Cola Q1 2026", ageHours: 96 },
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

    // Watchlists — wipe any existing demo lists and recreate so
    // re-runs are idempotent (positions stay clean instead of
    // accumulating). We match by name to avoid touching user-
    // created lists. ON DELETE CASCADE drops the joined tickers.
    const demoNames = DEMO_WATCHLISTS.map((w) => w.name);
    await supabase
      .from("watchlists")
      .delete()
      .eq("user_id", userId)
      .in("name", demoNames);
    for (let i = 0; i < DEMO_WATCHLISTS.length; i++) {
      const wl = DEMO_WATCHLISTS[i];
      const { data: created, error: cErr } = await supabase
        .from("watchlists")
        .insert({
          user_id: userId,
          name: wl.name,
          color: wl.color,
          position: i,
        })
        .select("id")
        .single();
      if (cErr) throw new Error(cErr.message);
      const tickerRows = wl.tickers.map((ticker, idx) => ({
        watchlist_id: created.id,
        ticker,
        position: idx,
      }));
      if (tickerRows.length) {
        const { error: tErr } = await supabase
          .from("watchlist_tickers")
          .insert(tickerRows);
        if (tErr) throw new Error(tErr.message);
      }
    }

    // Wallet (0.0.80) — seed cash balance + transactions ledger so
    // the Wallet tab isn't empty either. Idempotent: balance upsert
    // overwrites; transactions get cleared by reference matching.
    await supabase.from("accounts").upsert([
      { user_id: userId, currency: "ARS", balance: DEMO_BALANCE_ARS, updated_at: new Date().toISOString() },
      { user_id: userId, currency: "USD", balance: DEMO_BALANCE_USD, updated_at: new Date().toISOString() },
    ], { onConflict: "user_id,currency" });
    // Wipe prior demo tx rows (matched by memo) before re-inserting
    // so re-running the seed doesn't compound the ledger.
    const demoMemos = DEMO_TRANSACTIONS.map((t) => t.memo);
    await supabase.from("transactions").delete()
      .eq("user_id", userId).in("memo", demoMemos);
    const txRows = DEMO_TRANSACTIONS.map((t) => ({
      user_id:    userId,
      kind:       t.kind,
      amount:     t.amount,
      currency:   t.currency,
      reference:  t.reference,
      memo:       t.memo,
      created_at: new Date(Date.now() - t.ageHours * 60 * 60 * 1000).toISOString(),
    }));
    const { error: txErr } = await supabase.from("transactions").insert(txRows);
    if (txErr) console.warn("[demoSeed] tx insert:", txErr.message);

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
    // Transactions — wipe ALL rows so the Wallet tab lands on the
    // empty-state onboarding (same intent as wiping holdings).
    // Pre-0.0.80 we only dropped trade rows; now we own the whole
    // ledger so the seed/reset semantics need to match.
    await supabase.from("transactions").delete().eq("user_id", userId);
    // Accounts — zero out cash balances (0.0.80).
    await supabase.from("accounts").delete().eq("user_id", userId);
    // Watchlists — drop every list (and cascade-drops every ticker
    // row). Same intent as wiping holdings: empty-state onboarding.
    await supabase.from("watchlists").delete().eq("user_id", userId);
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
