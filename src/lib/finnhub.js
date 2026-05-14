// ============================================================
// SAMAS — Finnhub real-time quotes (samas-0.4.89)
// ============================================================
// Free tier = 60 req/min, realtime US equities/ETFs durante el horario
// del mercado, último close fuera de horario. No cubre BCBA — los
// tickers ARS/CEDEAR-locales se quedan en mock.
//
// Caché in-memory 30s + inflight dedup: si la UI hace 5 polls del
// mismo ticker en una misma ventana, sale UN solo fetch.
//
// La key se inyecta desde VITE_FINNHUB_API_KEY (.env.local, NO
// committeado). Si la env var falta en build time, getQuote()
// devuelve null y los assets caen a sus precios mock — la UI no
// rompe. Vite inlinea env vars en el bundle: aunque no esté en
// source code, sí termina embebida en el JS final.
// ============================================================

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_API_KEY || "";
const FINNHUB_BASE = "https://finnhub.io/api/v1";
const CACHE_TTL_MS = 30_000;

const cache = new Map();    // ticker -> { ticker, price, changePct, at }
const inflight = new Map(); // ticker -> Promise<quote|null>

// Set explícito de tickers que SAMAS sabe que existen en Finnhub.
// Cualquier otro (GGAL/YPF/PAMP/AL30/SAMAS funds) se queda con su
// precio mock. Mantener sincronizado con ASSETS en broker.js.
export const FINNHUB_TICKERS = new Set([
  // CEDEAR underlyings
  "AAPL", "NVDA", "TSLA", "MSFT", "GOOGL",
  // Crypto-exposure CEDEARs
  "IBIT", "COIN", "MSTR", "MARA", "RIOT",
  // ETFs
  "SPY", "QQQ", "IWM", "EWZ",
  // Commodities (via SPDR/iShares wrappers)
  "GLD", "SLV", "USO",
]);

export function isFinnhubTicker(ticker) {
  return FINNHUB_TICKERS.has(ticker);
}

/**
 * Single-ticker quote. Returns { ticker, price, changePct, at } or null
 * if Finnhub returned no data (rate limit, network error, unknown ticker).
 * NEVER throws — callers can use the mock fallback safely.
 */
export async function getQuote(ticker) {
  if (!isFinnhubTicker(ticker)) return null;
  if (!FINNHUB_KEY) return null;

  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;

  const pending = inflight.get(ticker);
  if (pending) return pending;

  const p = (async () => {
    try {
      const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
      const data = await res.json();
      // Finnhub returns c=0 for unknown tickers / off-hours weirdness.
      if (!data || typeof data.c !== "number" || data.c <= 0) return null;
      const out = {
        ticker,
        price: data.c,
        changePct: typeof data.dp === "number" ? data.dp : 0,
        at: Date.now(),
      };
      cache.set(ticker, out);
      return out;
    } catch (e) {
      console.warn(`[finnhub] ${ticker}:`, e?.message || e);
      return null;
    } finally {
      inflight.delete(ticker);
    }
  })();
  inflight.set(ticker, p);
  return p;
}

/**
 * Batch fetch — paraleliza con Promise.all. Returns Map(ticker → quote).
 * Tickers con error / no soportados simplemente faltan del Map.
 */
export async function getQuotes(tickers) {
  const results = await Promise.all(tickers.map((t) => getQuote(t).catch(() => null)));
  const out = new Map();
  for (const q of results) if (q) out.set(q.ticker, q);
  return out;
}
