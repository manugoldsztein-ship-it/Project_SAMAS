// ============================================================
// NEWS — client wrapper for the fetch-news Edge Function
// ============================================================
// Single endpoint: POST /functions/v1/fetch-news with { ticker }.
// The function handles the hybrid (Finnhub for global tickers,
// Argentine RSS for local) and the cache layer in articles table.
//
// Two helpers:
//   - fetchNewsForTicker(ticker)  → Promise<Article[]>
//   - fetchNewsForTickers([t1,t2,...]) → Promise<Article[]>
//     (parallel calls + merge + sort newest first; used by the
//     "Noticias" tab default view to mix the user's portfolio.)
//
// Article shape (matches what the Edge Function returns + the DB):
//   { title, summary, url, source, image_url, published_at, ticker }
//
// We always include `ticker` in the returned items even though the
// Edge Function returns it implicitly — the merged/global feed needs
// it to render the chips.
// ============================================================

import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase";

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/fetch-news`;

async function authToken() {
  // Same SDK-bypass pattern as Mfa.jsx: read directly from localStorage.
  // supabase.auth.getSession() hangs intermittently on this build.
  try {
    const ref = (SUPABASE_URL.match(/https:\/\/([^.]+)\./) || [])[1];
    if (!ref || typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    return JSON.parse(raw)?.access_token || null;
  } catch {
    return null;
  }
}

async function fetchTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function fetchNewsForTicker(ticker, lang) {
  if (!ticker) return [];
  const token = await authToken();
  if (!token) throw new Error("No hay sesión activa.");
  const body = { ticker: ticker.trim().toUpperCase() };
  if (lang) body.lang = lang;
  const resp = await fetchTimeout(FUNCTION_URL, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  // Translation upstream takes a few seconds — bump the client
  // timeout from 12s to 25s for the first call to a fresh lang.
  // Subsequent calls hit the translation cache and are fast.
  }, 25000);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`fetch-news ${resp.status}: ${txt}`);
  }
  const json = await resp.json();
  const articles = Array.isArray(json?.articles) ? json.articles : [];
  // Tag each article with its ticker for the merged-feed renderer.
  return articles.map((a) => ({ ...a, ticker: ticker.trim().toUpperCase() }));
}

// Fetch news for many tickers in parallel, dedup by URL, sort newest first.
// Limits to MAX_TICKERS_AT_ONCE to avoid hammering the Edge Function — the
// per-call cache makes this cheap, but no point being wasteful.
const MAX_TICKERS_AT_ONCE = 12;
export async function fetchNewsForTickers(tickers, lang) {
  const list = (Array.isArray(tickers) ? tickers : []).filter(Boolean).slice(0, MAX_TICKERS_AT_ONCE);
  if (list.length === 0) return [];
  const settled = await Promise.allSettled(list.map((t) => fetchNewsForTicker(t, lang)));
  const all = [];
  const seen = new Set();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const a of r.value || []) {
      if (!a?.url || seen.has(a.url)) continue;
      seen.add(a.url);
      all.push(a);
    }
  }
  all.sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at));
  return all;
}

// Format a publication date as a relative time string in Spanish.
// Used by NewsCard. Falls back to a date if older than ~30 days.
export function relativeTime(iso, lang = "es") {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60)         return lang === "en" ? "just now"      : "ahora";
  const min = Math.floor(sec / 60);
  if (min < 60)         return lang === "en" ? `${min}m ago`   : `hace ${min}m`;
  const hr  = Math.floor(min / 60);
  if (hr < 24)          return lang === "en" ? `${hr}h ago`    : `hace ${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30)         return lang === "en" ? `${day}d ago`   : `hace ${day}d`;
  return d.toLocaleDateString(lang === "en" ? "en-US" : "es-AR", {
    day: "numeric", month: "short",
  });
}
