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
    id: "n_3", category: "Cripto", at: NOW - 2 * HOUR,
    title: "Bitcoin supera los $92.000 tras flujos de ETFs",
    summary: "BlackRock IBIT registró su mayor ingreso semanal del año. Los analistas técnicos apuntan a un test de resistencia en $95k.",
    tickers: ["BTC", "ETH"], source: "CoinDesk",
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
  { sym: "BTC",    value: "92,450",     changePct:  0.92 },
  { sym: "MEP",    value: "1,245",      changePct:  0.40 },
  { sym: "OIL",    value: "78.30",      changePct: -0.73 },
];

// ----------------------------------------------------------
// Public API
// ----------------------------------------------------------

/**
 * getCategorizedNews({ category, limit }) — paginated news list.
 *
 * Production: calls the existing `fetch-news` edge function with the
 * category as a filter.
 *
 * @returns {Promise<Array<NewsItem>>}
 */
export async function getCategorizedNews({ category = "Todo", limit = 30 } = {}) {
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
 * the News tab (MERVAL / S&P / BTC / MEP / OIL).
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
