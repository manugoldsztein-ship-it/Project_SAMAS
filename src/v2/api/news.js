// ============================================================
// SAMAS v2 — News API
// ============================================================
// Owns: market news (categorized, ticker-targeted, featured).
//
// PRODUCTION INTEGRATION TARGET — keep what we have
//   The legacy app already pulls news from a Supabase Edge Function
//   `fetch-news` (Finnhub for international + RSS fallback for AR
//   sources like Ámbito, La Nación, Bloomberg). That feed works.
//
//   This module is a thin abstraction on top of the same edge func
//   so the v2 News tab uses the same data source. Real swap = wire
//   `getCategorizedNews()` to call the existing edge func.
// ============================================================

import { jitter } from "./_mock.js";
// Real news comes from the existing Supabase Edge Function `fetch-news`
// that we shipped in the legacy app — Finnhub for global tickers, RSS
// fallback for Argentine sources, all cached server-side. Same wrapper
// the legacy MobileApp used. We keep the v2 mock as a fallback for
// when there's no auth session yet (demo mode).
import { fetchNewsForTicker, fetchNewsForTickers } from "../../lib/news.js";
// Pull the user's holdings + watchlists so we can ask for news about
// tickers they actually care about. Same broker mock everywhere else
// uses — when the real broker API lands, this swaps automatically.
import * as brokerApi from "./broker.js";

// ----------------------------------------------------------
// Mock catalog. The Categorized list mirrors the design's filter
// pills (Todo / Mercados / Argentina / Cripto / Tech / Energía).
// ----------------------------------------------------------
const NOW = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const NEWS = [
  {
    id: "n_1", category: "Mercados", at: NOW - 12 * MIN, hot: true,
    title: "Wall Street abre en verde tras datos de inflación de EE.UU.",
    summary: "El S&P 500 sube 0,8% en pre-market después de que el CPI viniera por debajo de lo esperado. Los traders descuentan dos recortes de la Fed este año.",
    tickers: ["SPX", "QQQ"], source: "Bloomberg",
  },
  {
    id: "n_2", category: "Argentina", at: NOW - 1 * HOUR,
    title: "BCRA mantiene la tasa y proyecta inflación de 2,1% para abril",
    summary: "La autoridad monetaria sostiene su política gradualista. Los bonos en pesos reaccionaron al alza, en particular el TX26.",
    tickers: ["AL30", "GD30"], source: "Ámbito",
  },
  {
    id: "n_3", category: "Renta Fija", at: NOW - 2 * HOUR,
    title: "Bonos hard-dollar argentinos cierran en alza por sexta rueda",
    summary: "AL30 y GD30 lideran las subas con +1.4% promedio. Los analistas atribuyen el flujo a expectativas de acuerdo con el FMI.",
    tickers: ["AL30", "GD30"], source: "Cronista",
  },
  {
    id: "n_4", category: "Tech", at: NOW - 3 * HOUR,
    title: "NVIDIA confirma fecha de earnings: 28 de mayo",
    summary: "El consenso espera EPS de $0,87 y revenue de $43.5B. La acción acumula +12% en lo que va del mes.",
    tickers: ["NVDA"], source: "Reuters",
  },
  {
    id: "n_5", category: "Energía", at: NOW - 5 * HOUR,
    title: "YPF sorprende con resultados: producción +8% interanual",
    summary: "Vaca Muerta sigue siendo el motor. La empresa anunció además un programa de recompra de acciones por USD 250M.",
    tickers: ["YPF"], source: "La Nación",
  },
  {
    id: "n_6", category: "Mercados", at: NOW - 7 * HOUR,
    title: "El S&P 500 cierra en máximo histórico por primera vez en 2 meses",
    summary: "Los sectores tecnología y consumo discrecional lideraron la suba. El VIX cayó por debajo de 14.",
    tickers: ["SPX"], source: "Reuters",
  },
];

const TICKER_BAR = [
  { sym: "MERVAL", value: "1,847,250",  changePct:  1.20 },
  { sym: "S&P 500", value: "5,471.23",  changePct:  0.62 },
  { sym: "MEP",    value: "1,245",      changePct:  0.40 },
  { sym: "OFICIAL",value: "1,012",      changePct:  0.12 },
  { sym: "OIL",    value: "78.30",      changePct: -0.73 },
];

// ----------------------------------------------------------
// Public API
// ----------------------------------------------------------

/**
 * getCategorizedNews({ category, limit }) — real news from the
 * fetch-news Edge Function, bucketed into the v2 category model.
 *
 * The legacy Edge Function fetches per-ticker (Finnhub for global +
 * RSS for AR sources). We feed it the user's holdings + every ticker
 * across their watchlists, then bucket each article by ticker class:
 *
 *    GGAL / YPF / PAMP / BBAR... → Argentina
 *    AAPL / NVDA / MSFT / ...    → Tech
 *    USO / GLD / SLV / YPF       → Energía
 *    SPY / QQQ / IWM / EWZ       → Mercados
 *    AL30 / GD30 / ...           → Renta Fija
 *    everything else              → Mercados
 *
 * If the Edge Function fails (no session, network down, demo mode) we
 * silently fall back to the curated mock catalog so the tab still has
 * something to show.
 *
 * DEFENSIVE TIMEOUTS (samas-0.0.37)
 *   The original implementation could hang indefinitely if either
 *   the broker getPortfolio call or the Edge Function never resolved
 *   (we observed this on iOS where the WebView's network stack can
 *   stall after backgrounding). We now wrap each step in a hard
 *   timeout so the worst case is N seconds → mockFeed → tab shows
 *   the curated catalog. Two timeouts:
 *     - tickerLookupRaceMs (3s): broker portfolio + watchlists. If
 *       these hang we just use the macro basket.
 *     - realFetchRaceMs (10s): the Edge Function call. Edge Function
 *       internal timeout is 25s but we don't need to wait that long
 *       on the user-facing path; on cache miss the user sees the
 *       mock and the next pull-to-refresh gets the real result.
 */
const NEWS_TICKER_LOOKUP_TIMEOUT_MS = 3000;
const NEWS_REAL_FETCH_TIMEOUT_MS = 10000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label || "op"} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function getCategorizedNews({ category = "Todo", limit = 30 } = {}) {
  // Build the universe of "tickers I care about". Holdings come via
  // getPortfolio (which enriches each holding with live data) and
  // watchlists are flat ticker arrays. Both are wrapped in a tight
  // timeout so a stuck broker mock can't block the news tab.
  let tickers = [];
  try {
    const [portfolio, watchlists] = await withTimeout(
      Promise.all([
        brokerApi.getPortfolio ? brokerApi.getPortfolio() : Promise.resolve({ holdings: [] }),
        brokerApi.getWatchlists ? brokerApi.getWatchlists() : Promise.resolve([]),
      ]),
      NEWS_TICKER_LOOKUP_TIMEOUT_MS,
      "broker ticker lookup",
    );
    const set = new Set();
    (portfolio?.holdings || []).forEach((h) => h?.ticker && set.add(h.ticker));
    (watchlists || []).forEach((w) =>
      (w?.tickers || []).forEach((t) => t && set.add(t))
    );
    tickers = Array.from(set);
  } catch (e) {
    // Hung or threw — fall through to the macro basket below.
    console.warn("[news] ticker lookup failed:", e?.message);
  }

  // No tickers (fresh demo account or lookup failed) → use a default
  // macro basket so the news feed is alive on first open. SPY / QQQ
  // / GLD give a reasonable cross-section of US equities + commodities.
  // The user's own holdings will replace this once they buy something.
  if (tickers.length === 0) {
    tickers = ["SPY", "QQQ", "GLD"];
  }

  let real = [];
  try {
    real = await withTimeout(
      fetchNewsForTickers(tickers),
      NEWS_REAL_FETCH_TIMEOUT_MS,
      "fetch-news",
    );
  } catch (e) {
    console.warn("[news] real fetch failed, using mock:", e?.message);
    return mockFeed({ category, limit });
  }
  if (!real || real.length === 0) {
    return mockFeed({ category, limit });
  }

  // Map from Edge Function shape -> v2 NewsItem shape, bucketed by category.
  const items = real.map((a, i) => {
    const tk = (a.ticker || "").toUpperCase();
    const cat = bucketCategory(tk);
    const at = a.published_at ? +new Date(a.published_at) : Date.now();
    return {
      id: a.url || `n_real_${i}`,
      category: cat,
      title: a.title || "",
      summary: a.summary || "",
      tickers: [tk].filter(Boolean),
      source: a.source || "",
      url: a.url || null,
      imageUrl: a.image_url || null,
      hot: false,
      at,
      timeLabel: relativeTimeShort(at),
    };
  });

  const filtered = category === "Todo"
    ? items
    : items.filter((n) => n.category === category);
  return filtered.slice(0, limit);
}

// ----------------------------------------------------------
// Fallback for demo mode / no tickers / fetch failure.
// ----------------------------------------------------------
async function mockFeed({ category, limit }) {
  await jitter(150, 350);
  let rows = NEWS;
  if (category && category !== "Todo") {
    rows = rows.filter((n) => n.category === category);
  }
  return rows.slice(0, limit).map((n) => ({
    id: n.id,
    category: n.category,
    title: n.title,
    summary: n.summary,
    tickers: [...n.tickers],
    source: n.source,
    hot: !!n.hot,
    at: n.at,
    timeLabel: relativeTimeShort(n.at),
  }));
}

// Bucket a ticker into the v2 News tab's category set. Hardcoded per
// ticker class because the Edge Function doesn't return a category.
// CRYPTO_TICKERS removed in samas-0.4.21 — Cohen doesn't operate
// crypto, so we don't surface a Cripto category nor route any
// ticker into one.
const AR_TICKERS = new Set(["GGAL", "YPF", "PAMP", "BBAR", "ALUA", "MIRG", "EDN", "TGSU2"]);
const RENTA_FIJA_TICKERS = new Set(["AL30", "GD30", "AL35", "GD35", "AE38", "AL29", "BPOA7", "BPOB7", "BPOC7", "BPOD7"]);
const TECH_TICKERS = new Set(["AAPL", "NVDA", "TSLA", "MSFT", "GOOGL", "AMZN", "META", "NFLX"]);
const ENERGY_TICKERS = new Set(["USO", "GLD", "SLV", "YPF", "PAMP", "EDN", "XOM", "CVX"]);
const ETF_TICKERS = new Set(["SPY", "QQQ", "IWM", "EWZ", "DIA", "EFA"]);
function bucketCategory(ticker) {
  const t = (ticker || "").toUpperCase();
  if (RENTA_FIJA_TICKERS.has(t)) return "Renta Fija";
  if (AR_TICKERS.has(t))     return "Argentina";
  if (TECH_TICKERS.has(t))   return "Tech";
  if (ENERGY_TICKERS.has(t)) return "Energía";
  if (ETF_TICKERS.has(t))    return "Mercados";
  return "Mercados";
}

/**
 * searchNewsByTicker(query) — fetch fresh news from the Edge Function
 * for an arbitrary ticker the user typed in the search box. Same
 * route as the merged feed, but explicit per-ticker so users can
 * look up "NVDA" / "TSLA" / "GGAL" without having to add them to a
 * watchlist first. Falls back to mock filtering if the function
 * fails or the user has no session.
 */
export async function searchNewsByTicker(query) {
  const raw = (query || "").trim();
  if (!raw) return [];
  // Resolve "NVIDIA" / "Apple" / "Tesla" to their tickers. Some users
  // type the company name instead of the symbol — the Edge Function
  // only understands symbols, so we normalize before calling it.
  let ticker = raw.toUpperCase();
  try {
    if (brokerApi.getAssets) {
      const assets = await brokerApi.getAssets();
      const upperRaw = raw.toUpperCase();
      // Exact ticker match first (typical case: user typed "NVDA").
      const exact = assets.find((a) => a.ticker.toUpperCase() === upperRaw);
      if (exact) ticker = exact.ticker;
      else {
        // Name match — case-insensitive contains. "Nvidia" → NVDA,
        // "Apple Inc" → AAPL, "tesla" → TSLA, "galicia" → GGAL, etc.
        const byName = assets.find((a) =>
          (a.name || "").toLowerCase().includes(raw.toLowerCase())
        );
        if (byName) ticker = byName.ticker;
      }
    }
  } catch { /* fall through with raw uppercase */ }

  let real = [];
  try {
    real = await fetchNewsForTicker(ticker);
  } catch (e) {
    console.warn("[news] ticker search failed, using mock:", e?.message);
  }
  if (real && real.length) {
    return real.map((a, i) => {
      const at = a.published_at ? +new Date(a.published_at) : Date.now();
      return {
        id: a.url || `n_search_${i}`,
        category: bucketCategory(ticker),
        title: a.title || "",
        summary: a.summary || "",
        tickers: [ticker],
        source: a.source || "",
        url: a.url || null,
        imageUrl: a.image_url || null,
        hot: false,
        at,
        timeLabel: relativeTimeShort(at),
      };
    });
  }
  // Fallback: mock catalog filtered by ticker substring (handy in
  // demo mode so you can still see something for "NVDA").
  await jitter(120, 280);
  return NEWS
    .filter((n) => n.tickers.some((t) => t.toUpperCase().includes(ticker)))
    .map((n) => ({
      id: n.id, category: n.category, title: n.title, summary: n.summary,
      tickers: [...n.tickers], source: n.source, hot: !!n.hot, at: n.at,
      timeLabel: relativeTimeShort(n.at),
    }));
}

/**
 * getNewsForTickers(tickers) — news that mention any of the tickers.
 * Used inside AssetDetail to surface relevant headlines.
 */
export async function getNewsForTickers(tickers) {
  await jitter();
  if (!tickers || !tickers.length) return [];
  const set = new Set(tickers.map((t) => t.toUpperCase()));
  return NEWS
    .filter((n) => n.tickers.some((t) => set.has(t.toUpperCase())))
    .slice(0, 10)
    .map((n) => ({
      id: n.id, title: n.title, summary: n.summary,
      source: n.source, at: n.at,
      timeLabel: relativeTimeShort(n.at),
    }));
}

/**
 * getMarketTicker() — the small horizontal-scroll bar at the top of
 * the News tab (MERVAL / S&P / MEP / OFICIAL / OIL).
 */
export async function getMarketTicker() {
  await jitter(80, 200);
  return TICKER_BAR.map((t) => ({ ...t }));
}

/**
 * getCategories() — list of category pill labels for the filter UI.
 */
export async function getCategories() {
  return ["Todo", "Mercados", "Argentina", "Cripto", "Tech", "Energía"];
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------
// Compact relative timestamp like "12 min" / "2h" / "Lun 14:32".
function relativeTimeShort(ts) {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MIN))} min`;
  if (diff < 24 * HOUR) return `${Math.round(diff / HOUR)}h`;
  const d = new Date(ts);
  return d.toLocaleString("es-AR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}
