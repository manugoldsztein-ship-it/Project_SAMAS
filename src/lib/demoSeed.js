// ============================================================
// DEMO SEED — populate the app with a realistic demo state.
// ============================================================
// SAMAS is shown to investors as a working prototype. A fresh signup
// lands on the empty-state onboarding screen, which is the wrong UX
// to show — the surfaces people are paying to see (Wallet hero,
// 30-day sparkline, holdings table, broker PnL, plan progress) only
// render once there's data behind them.
//
// seedDemoAccount() drops a curated mix of holdings + balance + a
// synthetic 30-day portfolio history into localStorage, then reloads
// the page so usePersistedState rehydrates from the new values on
// next mount. Triggered from the Demo section of SettingsSheet.
//
// resetDemoAccount() does the inverse: removes the user-facing state
// keys so the next render returns to the empty-state onboarding.
// Settings (theme, language, view mode, app shell) are left alone —
// those are personal preferences, not demo data.
// ============================================================

// Seven holdings: three ARG stocks, three US CEDEARs, one BTC. Avg
// prices are set slightly below the live ASSETS quotes (in App.jsx)
// so PnL renders positive across the board — matters for screenshots
// and demo flow ("look at the green numbers"). When Finnhub isn't
// wired (no key), the simulator uses these avg prices as the live
// quote, so PnL will read 0% — that's fine, the holdings table still
// looks fully populated.
const DEMO_HOLDINGS = [
  { ticker: "GGAL", qty: 500,  avg: 7800    },
  { ticker: "YPF",  qty: 120,  avg: 38000   },
  { ticker: "ALUA", qty: 800,  avg: 1600    },
  { ticker: "AAPL", qty: 60,   avg: 16200   },
  { ticker: "NVDA", qty: 25,   avg: 54000   },
  { ticker: "MSFT", qty: 40,   avg: 46000   },
  { ticker: "BTC",  qty: 0.05, avg: 7500000 },
];

// 5M ARS in idle balance — enough to demo the "buy" flow without
// looking like the user is broke, and modest enough to feel
// realistic for a retail Argentine account.
const DEMO_BALANCE = 5_000_000;

// Watchlist seed — a small, recognizable mix that lets the user open
// AssetDetail on any tab and see useful chrome (chart, news, etc.)
// without first having to add tickers manually.
const DEMO_WATCHLISTS = [
  { id: "default", name: "Mi Watchlist", tickers: ["SPY", "BTC", "GGAL", "NVDA"] },
];

// Build a synthetic 30-day portfolio history. Linear ramp from ~88%
// of target → target, with small daily noise (±1%) so the sparkline
// reads as "real" rather than perfectly straight. Target is a rough
// estimate of the live portfolio value (sum of qty * avg) so the
// hero card's ARS total roughly matches the holdings sum on first
// render. Real value comes from quotes once Finnhub is wired.
function buildDemoPortfolioHistory(days = 30) {
  const today = new Date();
  const target = 13_500_000; // ≈ sum(DEMO_HOLDINGS.qty * avg) + balance
  const start = target * 0.88;
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const progress = (days - 1 - i) / (days - 1); // 0 → 1
    const noise = (Math.random() - 0.5) * 0.02;   // ±1%
    const value = Math.round(start + (target - start) * progress * (1 + noise));
    out.push({ date: d.toISOString().slice(0, 10), value });
  }
  return out;
}

export function seedDemoAccount() {
  try {
    localStorage.setItem("samas_holdings", JSON.stringify(DEMO_HOLDINGS));
    localStorage.setItem("samas_balance",  JSON.stringify(DEMO_BALANCE));
    localStorage.setItem("samas_portfolio_history", JSON.stringify(buildDemoPortfolioHistory(30)));
    localStorage.setItem("samas_watchlists", JSON.stringify(DEMO_WATCHLISTS));
    // Reload so usePersistedState picks up the new values on mount.
    // The 200ms delay lets any closing modal / haptic finish first.
    setTimeout(() => window.location.reload(), 200);
  } catch (e) {
    console.error("[demoSeed] seed failed:", e);
  }
}

export function resetDemoAccount() {
  try {
    // Clear user-facing portfolio state so the app falls back to the
    // empty-state onboarding. Personal prefs (theme, language, view
    // mode, app shell) are intentionally preserved.
    localStorage.removeItem("samas_holdings");
    localStorage.removeItem("samas_balance");
    localStorage.removeItem("samas_portfolio_history");
    localStorage.removeItem("samas_orders");
    localStorage.removeItem("samas_stop_losses");
    localStorage.removeItem("samas_price_alerts");
    localStorage.removeItem("samas_plan");
    localStorage.removeItem("samas_recurring_aporte");
    setTimeout(() => window.location.reload(), 200);
  } catch (e) {
    console.error("[demoSeed] reset failed:", e);
  }
}
