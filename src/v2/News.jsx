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

export function NewsPage({ T }) {
  const [items, setItems] = useState([]);
  const [ticker, setTicker] = useState([]);
  const [cats, setCats] = useState(["Todo"]);
  const [cat, setCat] = useState("Todo");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, bar, categories] = await Promise.all([
        newsApi.getCategorizedNews({ category: cat, limit: 40 }),
        newsApi.getMarketTicker(),
        newsApi.getCategories(),
      ]);
      setItems(list); setTicker(bar); setCats(categories);
    } catch (e) {
      console.error("[news] load:", e);
    } finally {
      setLoading(false);
    }
  }, [cat]);

  useEffect(() => { refresh(); }, [refresh]);

  // Local search across what the API already returned. We keep it
  // client-side so typing feels instant; the API filtering is by
  // category only. Match against title, summary, source and any of
  // the related tickers.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((n) => {
      if (n.title.toLowerCase().includes(q)) return true;
      if ((n.summary || "").toLowerCase().includes(q)) return true;
      if ((n.source || "").toLowerCase().includes(q)) return true;
      if ((n.tickers || []).some((tk) => tk.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [items, query]);

  return (
    <div style={{ paddingBottom: 110 }}>
      {/* Header */}
      <div style={{
        padding: "calc(env(safe-area-inset-top) + 20px) 20px 0",
        display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12,
      }}>
        <div>
          <div style={{
            fontFamily: FONT.display, fontSize: 28, fontWeight: 700,
            color: T.text, letterSpacing: -0.6,
          }}>Noticias</div>
          <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, marginTop: 2 }}>
            Mercados, Argentina, cripto y más
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          aria-label="Actualizar"
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
            willChange: "transform",
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
            placeholder="Buscar por título, ticker o fuente"
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
            }}>{c}</button>
          );
        })}
      </div>

      {/* Feed */}
      <div style={{ margin: "0 16px" }}>
        {loading && items.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: T.textMute, fontFamily: FONT.sans, fontSize: 13 }}>
            Cargando noticias...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            padding: "32px 24px", borderRadius: 18, textAlign: "center",
            background: T.surface, border: `1px solid ${T.border}`,
          }}>
            <div style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>
              Sin resultados
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5 }}>
              {query
                ? `No encontramos noticias para "${query}".`
                : "No hay noticias en esta categoría todavía."}
            </div>
          </div>
        ) : (
          filtered.map((n) => <NewsCard key={n.id} T={T} item={n} />)
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
function NewsCard({ T, item }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      onClick={() => setExpanded((e) => !e)}
      style={{
        width: "100%", textAlign: "left",
        padding: 14, marginBottom: 8, borderRadius: 18,
        background: T.surface, border: `1px solid ${T.border}`,
        cursor: "pointer", display: "block",
      }}
    >
      {/* Top row: hot badge / category / time */}
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

      {/* Summary — clamped at 2 lines unless expanded. */}
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
        }}>Vía {item.source}</span>
        {(item.tickers || []).map((tk) => (
          <span key={tk} style={{
            padding: "2px 7px", borderRadius: 6,
            background: T.accentSoft, color: T.accent,
            fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
          }}>{tk}</span>
        ))}
      </div>
    </button>
  );
}
