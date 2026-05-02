// ============================================================
// SAMAS v2 — News tab
// ============================================================
// Mirrors the legacy PageNoticias but rebuilt against the v2 design
// system. Sections:
//
//   - Header (title + subtitle)
//   - Live ticker bar (MERVAL / S&P / BTC / MEP / OIL) — scrolling
//   - Search input (filter cards by title, summary, ticker)
//   - Category pills (Todo / Mercados / Argentina / Cripto / Tech / Energía)
//   - Feed of news cards with title, summary, source, time, hot badge,
//     related tickers chips
//
// Data: src/v2/api/news.js (mock). Production swap = wire the existing
// fetch-news Edge Function (Finnhub + RSS) — same shape coming back.
// ============================================================

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { FONT } from "./theme.js";
import { Ico } from "./icons.jsx";
import { news as newsApi } from "./api/index.js";
import { Skeleton } from "./shared.jsx";
import { explainNews, newsDigest } from "../lib/ai.js";
import { hapticNative } from "../lib/native.js";
import { t as tr } from "../lib/i18n.js";
import { setRefreshHandler } from "./refreshRegistry.js";

// Hard outer timeout so the entire News tab can't get stuck on a
// slow Promise.all. The api/news.js layer already has its own
// timeouts (3s + 10s) but a UI-level safety net keeps things
// graceful if any one step in the chain throws an unhandled
// rejection that escapes Promise.all.
const NEWS_PAGE_REFRESH_TIMEOUT_MS = 12000;

function withPageTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("news refresh timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function NewsPage({ T, lang = "es" }) {
  const [items, setItems] = useState([]);
  const [ticker, setTicker] = useState([]);
  // Category state uses the canonical Spanish keys ("Todo", "Mercados",
  // "Argentina", "Cripto", "Tech", "Energía") because that's what the
  // api/news.js layer expects (NEWS rows are bucketed by those exact
  // strings). Display labels go through tr() at render time only —
  // we don't translate the IDENTITY of the category.
  //
  // Pre-0.0.48 we wrapped `cat` in tr("news.cat.all", lang) which
  // returns "All" in English, so the active pill never matched the
  // pills returned by getCategories() and filtering broke silently.
  const [cats, setCats] = useState(["Todo"]);
  const [cat, setCat] = useState("Todo");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [loading, setLoading] = useState(true);
  // loadError surfaces a Retry button instead of a forever-stuck
  // skeleton. Cleared on every successful refresh.
  const [loadError, setLoadError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [list, bar, categories] = await withPageTimeout(Promise.all([
        newsApi.getCategorizedNews({ category: cat, limit: 40 }),
        newsApi.getMarketTicker(),
        newsApi.getCategories(),
      ]), NEWS_PAGE_REFRESH_TIMEOUT_MS);
      setItems(list); setTicker(bar); setCats(categories);
    } catch (e) {
      console.error("[news] load:", e);
      setLoadError(e?.message || "load failed");
    } finally {
      setLoading(false);
    }
  }, [cat]);

  useEffect(() => { refresh(); }, [refresh]);

  // Register refresh so the Shell's pull-to-refresh can invoke it
  // when the user pulls down from the top of the news feed.
  useEffect(() => setRefreshHandler("news", refresh), [refresh]);

  // Debounced ticker search — when the user types, after 350ms idle
  // we hit the Edge Function for fresh news on that ticker. Empty
  // query clears the search and we revert to the categorized feed.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setSearchResults(null); return; }
    let alive = true;
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const r = await newsApi.searchNewsByTicker(q);
        if (!alive) return;
        setSearchResults(r);
      } catch (e) {
        if (alive) setSearchResults([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 350);
    return () => { alive = false; clearTimeout(id); };
  }, [query]);

  // Visible feed: search results when actively searching, otherwise
  // the categorized list. Search results respect the category pill
  // too (so "NVDA" + "Tech" works as a sub-filter).
  const visible = useMemo(() => {
    const base = searchResults != null ? searchResults : items;
    // Compare against the canonical "Todo" key, not its translation —
    // see the comment on the cat state declaration above.
    if (cat === "Todo") return base;
    return base.filter((n) => n.category === cat);
  }, [items, searchResults, cat]);

  // Render-only label translator for the category pills. Keeps the
  // stored value (Spanish key) stable while showing the user-facing
  // text in their locale. Argentina / Cripto / Tech are the same in
  // both languages so we only translate the two that differ.
  function catLabel(c) {
    if (c === "Todo")     return tr("news.cat.all", lang);
    if (c === "Mercados") return lang === "en" ? "Markets" : "Mercados";
    if (c === "Energía")  return lang === "en" ? "Energy"  : "Energía";
    return c;
  }

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
      {/* Header */}
      <div style={{
        padding: "calc(env(safe-area-inset-top) + 20px) 20px 0",
        display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12,
      }}>
        <div>
          <div style={{
            fontFamily: FONT.display, fontSize: 28, fontWeight: 700,
            color: T.text, letterSpacing: -0.6,
          }}>{tr("news.title", lang)}</div>
          <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, marginTop: 2 }}>
            {tr("news.subtitle", lang)}
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          aria-label={tr("news.refresh", lang)}
          style={{
            width: 38, height: 38, borderRadius: 12, flexShrink: 0,
            background: T.surface, border: `1px solid ${T.border}`,
            color: loading ? T.textMute : T.text,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: loading ? "default" : "pointer",
            transform: loading ? "rotate(180deg)" : "none",
            transition: "transform 0.6s ease",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>

      {/* Live ticker bar — scrolling. Same marquee pattern as the
          BrokerShell banner, but with macro indices instead of ETFs. */}
      {ticker.length > 0 && (
        <div style={{
          marginTop: 16,
          borderTop: `1px solid ${T.border}`,
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
          overflow: "hidden",
        }}>
          <style>{`
            @keyframes samas-news-marquee {
              from { transform: translateX(0); }
              to   { transform: translateX(-50%); }
            }
          `}</style>
          <div style={{
            display: "flex", gap: 22, padding: "10px 0 10px 16px",
            whiteSpace: "nowrap",
            animation: "samas-news-marquee 32s linear infinite",
            // willChange:"transform" was here as a compositor hint, but
            // on iOS WebKit it forces a permanent GPU layer that isn't
            // released when the news tab is hidden — small but additive
            // contribution to long-session memory pressure. The
            // browser can promote this layer on its own when needed.
          }}>
            {[...ticker, ...ticker].map((t, i) => {
              const up = (t.changePct ?? 0) >= 0;
              return (
                <div key={`${t.sym}-${i}`} style={{
                  display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                  fontFamily: FONT.mono, fontSize: 11, fontWeight: 600,
                }}>
                  <span style={{ color: T.textMute }}>{t.sym}</span>
                  <span style={{ color: T.text }}>{t.value}</span>
                  <span style={{ color: up ? T.accent : T.danger }}>
                    {up ? "+" : ""}{(t.changePct ?? 0).toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AI News Digest (samas-0.3.1) — auto-loaded summary of the
          headlines that matter for the user's holdings, written by
          the LLM. Sits between the ticker bar and search so the user
          sees personalized signal before scrolling the generic feed. */}
      <NewsDigestCard T={T} lang={lang} />

      {/* Search */}
      <div style={{ padding: "16px 16px 8px" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", borderRadius: 14,
          background: T.surface, border: `1px solid ${T.border}`,
        }}>
          <Ico.Search size={16} stroke={T.textMute} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("news.search_ph", lang)}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: T.text, fontFamily: FONT.sans, fontSize: 14,
            }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{
              background: "none", border: "none", cursor: "pointer",
              color: T.textMute, fontSize: 14, padding: 0, lineHeight: 1,
            }}>×</button>
          )}
        </div>
      </div>

      {/* Category pills */}
      <div style={{
        display: "flex", gap: 8, padding: "4px 16px 12px",
        overflowX: "auto", scrollbarWidth: "none",
      }}>
        {cats.map((c) => {
          const active = c === cat;
          return (
            <button key={c} onClick={() => setCat(c)} style={{
              flexShrink: 0, padding: "8px 14px", borderRadius: 999,
              background: active ? T.accentSoft : T.surface,
              border: `1px solid ${active ? T.accent : T.border}`,
              color: active ? T.accent : T.textMute,
              fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
              cursor: "pointer", whiteSpace: "nowrap",
            }}>{catLabel(c)}</button>
          );
        })}
      </div>

      {/* Error banner — shown when refresh failed (timeout, throw, etc).
          Gives the user a fast path back to a working state without
          forcing a tab switch / pull-to-refresh. */}
      {loadError && !loading && (
        <div style={{
          margin: "8px 16px 12px", padding: "12px 14px", borderRadius: 14,
          background: T.dangerSoft, border: `1px solid ${T.danger}55`,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.danger }}>
              {tr("news.empty_title", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute, marginTop: 2 }}>
              {loadError}
            </div>
          </div>
          <button
            onClick={refresh}
            style={{
              padding: "6px 14px", borderRadius: 999,
              background: T.danger, border: "none", color: "#fff",
              fontFamily: FONT.sans, fontSize: 12, fontWeight: 700,
              cursor: "pointer", flexShrink: 0,
            }}
          >{tr("news.refresh", lang)}</button>
        </div>
      )}

      {/* Feed */}
      <div style={{ margin: "0 16px" }}>
        {loading ? (
          <>
            {/* Skeleton card stack — feels much more "loading" than a
                single spinner because the layout matches the eventual
                content. Three placeholders is enough to fill the
                viewport during typical fetch latency. */}
            {[0, 1, 2].map((i) => (
              <div key={i} style={{
                padding: 14, marginBottom: 8, borderRadius: 18,
                background: T.surface, border: `1px solid ${T.border}`,
              }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <Skeleton T={T} width={44} height={14} borderRadius={6} />
                  <Skeleton T={T} width={72} height={14} borderRadius={6} />
                </div>
                <Skeleton T={T} height={16} marginBottom={8} />
                <Skeleton T={T} height={12} marginBottom={6} />
                <Skeleton T={T} width="60%" height={12} />
              </div>
            ))}
            {query && (
              <div style={{
                marginTop: 8, textAlign: "center", color: T.textMute,
                fontFamily: FONT.sans, fontSize: 12,
              }}>
                {tr("news.searching", lang, { q: query.toUpperCase() })}
              </div>
            )}
          </>
        ) : visible.length === 0 ? (
          <div style={{
            padding: "32px 24px", borderRadius: 18, textAlign: "center",
            background: T.surface, border: `1px solid ${T.border}`,
          }}>
            <div style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>
              {tr("news.empty_title", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5 }}>
              {query
                ? tr("news.empty_no_results", lang, { q: query })
                : tr("news.empty_no_news", lang)}
            </div>
          </div>
        ) : (
          visible.map((n) => <NewsCard key={n.id} T={T} item={n} lang={lang} />)
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------
// NewsCard — single article. Tap to expand the summary inline (the
// legacy NewsArticleSheet was a full overlay; in v2 we keep it inline
// to avoid yet-another modal layer).
// ----------------------------------------------------------
function NewsCard({ T, item, lang = "es" }) {
  const [expanded, setExpanded] = useState(false);
  // AI explainer state (samas-0.0.99). Independent of the article-
  // expansion state so the explainer can stay open while the
  // summary collapses, etc.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiData, setAiData] = useState(null);
  const [aiErr,  setAiErr]  = useState(null);

  // Open the real article URL (when item.url is present, i.e. came
  // from the fetch-news Edge Function). On Capacitor iOS, target=_blank
  // + window.open with the system flag pops out to Safari instead of
  // navigating inside the WebView.
  function openArticle() {
    if (!item.url) return;
    try {
      // Capacitor recognizes _system as "open in OS browser".
      window.open(item.url, "_system", "noopener,noreferrer");
    } catch {
      // Fallback for plain web preview.
      window.open(item.url, "_blank", "noopener,noreferrer");
    }
  }

  // Card click behavior:
  //   - If we have a URL (real article from fetch-news) → open it.
  //   - Otherwise (mock items) → expand the summary inline.
  function onCardClick() {
    if (item.url) openArticle();
    else setExpanded((e) => !e);
  }

  async function onExplainTap(e) {
    // The AI button sits inside the card div but its tap shouldn't
    // open the article — stop event propagation here, above any
    // other handler we might attach later.
    e.preventDefault();
    e.stopPropagation();
    if (aiBusy) return;
    // If already have data, just toggle visibility instead of re-fetch.
    if (aiData) { setAiOpen((o) => !o); return; }
    setAiErr(null); setAiBusy(true); setAiOpen(true);
    hapticNative("tap").catch(() => {});
    try {
      const data = await explainNews({
        title: item.title,
        summary: item.summary,
        tickers: item.tickers || [],
        source: item.source,
      });
      setAiData(data);
      hapticNative("success").catch(() => {});
    } catch (err) {
      // Consent declined → silently close without surfacing error.
      if (err?.name === "AIConsentDeniedError" || err?.name === "AIQuotaExceededError") setAiOpen(false);
      else setAiErr(err?.message || String(err));
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onCardClick}
      style={{
        width: "100%", textAlign: "left",
        padding: 14, marginBottom: 8, borderRadius: 18,
        background: T.surface, border: `1px solid ${T.border}`,
        cursor: "pointer", display: "block",
      }}
    >
      {/* Top row: hot badge / category / time + open-in-browser hint */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
        flexWrap: "wrap",
      }}>
        {item.hot && (
          <span style={{
            padding: "2px 7px", borderRadius: 6,
            background: T.dangerSoft, color: T.danger,
            fontFamily: FONT.mono, fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
          }}>HOT</span>
        )}
        <span style={{
          padding: "2px 7px", borderRadius: 6,
          background: T.bg, color: T.textMute, border: `1px solid ${T.border}`,
          fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
        }}>{(item.category || "").toUpperCase()}</span>
        <span style={{
          marginLeft: "auto",
          fontFamily: FONT.mono, fontSize: 10, color: T.textMute, fontWeight: 600,
        }}>{item.timeLabel}</span>
      </div>

      {/* Title */}
      <div style={{
        fontFamily: FONT.display, fontSize: 15, fontWeight: 700, color: T.text,
        lineHeight: 1.35, marginBottom: 6,
      }}>{item.title}</div>

      {/* Summary — clamped at 2 lines unless expanded (mock only). */}
      <div style={{
        fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
        lineHeight: 1.5,
        display: "-webkit-box",
        WebkitLineClamp: expanded ? "unset" : 2,
        WebkitBoxOrient: "vertical",
        overflow: expanded ? "visible" : "hidden",
      }}>{item.summary}</div>

      {/* Source + tickers row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginTop: 10,
        flexWrap: "wrap",
      }}>
        <span style={{
          fontFamily: FONT.sans, fontSize: 11, color: T.textMute, fontWeight: 600,
        }}>{tr("news.source_prefix", lang)} {item.source}</span>
        {(item.tickers || []).map((tk) => (
          <span key={tk} style={{
            padding: "2px 7px", borderRadius: 6,
            background: T.accentSoft, color: T.accent,
            fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
          }}>{tk}</span>
        ))}
        {/* "Leer →" affordance when there's a real URL. */}
        {item.url && (
          <span style={{
            marginLeft: "auto",
            display: "flex", alignItems: "center", gap: 4,
            fontFamily: FONT.sans, fontSize: 11, fontWeight: 700, color: T.accent,
          }}>
            {tr("news.read", lang)}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7M7 7h10v10"/>
            </svg>
          </span>
        )}
      </div>

      {/* AI explainer (samas-0.0.99). "¿Por qué me importa?" sits
          below the source/tickers row. Tap → calls explain-news,
          inline expansion shows the AI explanation referencing the
          user's actual holdings. */}
      <div
        onClick={onExplainTap}
        role="button"
        tabIndex={0}
        style={{
          marginTop: 10, paddingTop: 10,
          borderTop: `1px dashed ${T.border}`,
          display: "flex", alignItems: "center", gap: 8,
          cursor: aiBusy ? "default" : "pointer",
          opacity: aiBusy ? 0.7 : 1,
        }}
      >
        <div style={{
          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
          background: T.accent, color: "#06180c",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {aiBusy ? (
            <div style={{
              width: 12, height: 12, borderRadius: 999,
              border: `2px solid rgba(0,0,0,0.2)`, borderTopColor: "#06180c",
              animation: "samas-spin 700ms linear infinite",
            }} />
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
            </svg>
          )}
        </div>
        <div style={{
          flex: 1,
          fontFamily: FONT.sans, fontSize: 12, fontWeight: 700,
          color: aiOpen ? T.text : T.accent,
          letterSpacing: 0.2,
        }}>
          {aiBusy
            ? tr("news.ai.thinking", lang)
            : (aiOpen
              ? tr("news.ai.collapse", lang)
              : tr("news.ai.cta", lang))}
        </div>
        {/* Caret toggles direction when open. */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke={T.textMute} strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round"
          style={{
            transform: aiOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 160ms ease-out",
          }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {/* Expanded AI body */}
      {aiOpen && (
        <div
          onClick={(e) => { e.stopPropagation(); }}
          style={{
            marginTop: 10, padding: "12px 14px", borderRadius: 12,
            background: aiData?.relevant
              ? `linear-gradient(135deg, ${T.accentSoft}, transparent 80%)`
              : T.bg,
            border: `1px solid ${aiData?.relevant ? T.accent : T.border}`,
          }}
        >
          {aiBusy && !aiData && (
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.5,
            }}>{tr("news.ai.thinking", lang)}</div>
          )}
          {aiErr && !aiData && (
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.danger, lineHeight: 1.5,
            }}>{aiErr}</div>
          )}
          {aiData && (
            <>
              {/* Hits chip — visually separates "you own this" cases. */}
              {aiData.hits && aiData.hits.length > 0 && (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "3px 8px", borderRadius: 999,
                  background: T.accent, color: T.accentInk,
                  fontFamily: FONT.mono, fontSize: 9, fontWeight: 800,
                  letterSpacing: 0.5, textTransform: "uppercase",
                  marginBottom: 8,
                }}>★ {aiData.hits.map((t) => `$${t}`).join(" · ")}</div>
              )}
              <div style={{
                fontFamily: FONT.sans, fontSize: 13, color: T.text, lineHeight: 1.55,
              }}>{aiData.explanation}</div>
              <div style={{
                marginTop: 8, fontFamily: FONT.sans, fontSize: 9, color: T.textMute,
                textAlign: "right", letterSpacing: 0.3,
              }}>{tr("news.ai.disclaimer", lang)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// NewsDigestCard (samas-0.3.1) — daily AI summary of news that
// matters for the user's held tickers. Auto-loads on mount, hides
// silently on AI failure or when the user has no holdings.
// ============================================================
// FREE for both tiers (auto-loaded surface, no quota consumed).
// Tap a headline = open the article in the OS browser, same path
// as the regular feed rows. Tap the kicker icon = no-op (passive
// surface, no expansion).
function NewsDigestCard({ T, lang = "es" }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const inFlight = React.useRef(false);

  useEffect(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    newsDigest()
      .then((res) => setData(res))
      .catch((e) => {
        if (e?.name === "AIConsentDeniedError") setHidden(true);
        else setHidden(true);
      })
      .finally(() => {
        setBusy(false);
        inFlight.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (hidden) return null;
  // No headlines and no AI digest → don't render an empty card.
  if (data && (!data.digest || (data.headlines?.length === 0 && data.coveredTickers?.length === 0))) return null;

  const headlines = data?.headlines || [];
  const visible = showAll ? headlines : headlines.slice(0, 3);
  const hiddenCount = headlines.length - visible.length;

  function openHeadline(h) {
    if (!h?.url) return;
    try { window.open(h.url, "_blank", "noopener,noreferrer"); } catch (_) {}
  }

  return (
    <div style={{ padding: "16px 16px 8px" }}>
      <div style={{
        padding: 14, borderRadius: 18,
        background: T.surface,
        border: `1px solid ${T.accent}55`,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
        }}>
          <div style={{
            width: 22, height: 22, borderRadius: 6, flexShrink: 0,
            background: T.accent, color: T.accentInk,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
            </svg>
          </div>
          <div style={{
            flex: 1, fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
            color: T.accent, letterSpacing: 0.6, textTransform: "uppercase",
          }}>
            {tr("news.digest.kicker", lang)}
          </div>
        </div>

        {busy && !data ? (
          <>
            <div style={{
              height: 12, marginBottom: 8, borderRadius: 4,
              background: T.border, opacity: 0.5,
              backgroundImage: `linear-gradient(90deg, ${T.border} 0, ${T.surface} 50%, ${T.border} 100%)`,
              backgroundSize: "200% 100%",
              animation: "samas-skel 1.4s ease-in-out infinite",
            }}/>
            <div style={{
              height: 12, width: "75%", borderRadius: 4,
              background: T.border, opacity: 0.5,
              backgroundImage: `linear-gradient(90deg, ${T.border} 0, ${T.surface} 50%, ${T.border} 100%)`,
              backgroundSize: "200% 100%",
              animation: "samas-skel 1.4s ease-in-out 0.2s infinite",
            }}/>
          </>
        ) : (
          <div style={{
            fontFamily: FONT.sans, fontSize: 13, color: T.text, lineHeight: 1.55,
            marginBottom: visible.length > 0 ? 12 : 0,
          }}>{data?.digest}</div>
        )}

        {/* Per-headline rows */}
        {visible.map((h, i) => (
          <button
            key={`${h.ticker}-${i}`}
            onClick={() => openHeadline(h)}
            style={{
              width: "100%", padding: "10px 0",
              borderTop: i === 0 ? `1px solid ${T.border}88` : `1px solid ${T.border}`,
              background: "transparent", border: "none",
              display: "flex", alignItems: "flex-start", gap: 10,
              cursor: h.url ? "pointer" : "default", textAlign: "left",
            }}>
            <span style={{
              padding: "2px 7px", borderRadius: 6, flexShrink: 0,
              background: T.bg, border: `1px solid ${T.border}`,
              fontFamily: FONT.mono, fontSize: 10, fontWeight: 800, color: T.text,
              letterSpacing: 0.3,
            }}>${h.ticker}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: FONT.sans, fontSize: 12, fontWeight: 600, color: T.text,
                lineHeight: 1.4,
                overflow: "hidden", textOverflow: "ellipsis",
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
              }}>{h.title}</div>
              {h.source && (
                <div style={{
                  marginTop: 2,
                  fontFamily: FONT.mono, fontSize: 9, color: T.textMute,
                  letterSpacing: 0.4, textTransform: "uppercase",
                }}>{h.source}</div>
              )}
            </div>
          </button>
        ))}

        {hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(true)}
            style={{
              width: "100%", marginTop: 6, padding: "6px 12px", borderRadius: 8,
              background: "transparent", border: `1px dashed ${T.border}`,
              color: T.textMute, fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
              cursor: "pointer",
            }}>
            {tr("news.digest.show_all", lang, { n: hiddenCount })}
          </button>
        )}
      </div>
    </div>
  );
}
