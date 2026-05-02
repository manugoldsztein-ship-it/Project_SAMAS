// ============================================================
// Journal — Trade Journal card + full-list sheet (samas-0.4.29)
// ============================================================
// "Diario de trading" card en Wallet entre Behavior y Objetivos.
// Shows AI-generated 90-day recap (batting avg, P/L, narrative,
// lesson). Tap → bottom sheet con la lista completa de trades +
// per-trade reflection on demand.
//
// Story de pitch: el primer broker AR que te ayuda a aprender de
// tus propios errores. Asesores institucionales TODOS llevan
// trade journals; brokers retail los esconden detrás de exports
// de Excel. SAMAS los hace primera-fila.
// ============================================================

import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import { FONT, fmtMoney } from "./theme.js";
import { t as tr } from "../lib/i18n.js";
import { hapticNative } from "../lib/native.js";
import { Skeleton, DisclaimerStrip } from "./shared.jsx";
import { journalRecap, journalReflect } from "../lib/ai.js";
import { listJournal } from "../lib/journal.js";
import { isAIDisabled } from "../lib/aiConsent.js";

export function JournalCard({ T, lang = "es" }) {
  const [recap, setRecap] = useState(null);
  const [busy, setBusy] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [aiDisabled, setAiDisabled] = useState(() => isAIDisabled());

  useEffect(() => {
    const onChange = (e) => setAiDisabled(!!e?.detail?.disabled);
    window.addEventListener("samas:ai-disabled-changed", onChange);
    return () => window.removeEventListener("samas:ai-disabled-changed", onChange);
  }, []);

  useEffect(() => {
    if (aiDisabled) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const data = await journalRecap();
        if (!cancelled) setRecap(data);
      } catch (_e) {
        if (!cancelled) setHidden(true);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiDisabled]);

  if (aiDisabled || hidden) return null;

  // Empty-state: no closed trades yet → show a simple invite card
  // instead of the full recap. Avoids "0% / US$0 / sin lecciones"
  // which reads as broken.
  const closed = recap?.stats?.closed || 0;
  const showSkeleton = busy && !recap;
  const showEmpty = !busy && closed === 0;

  return (
    <>
      <div style={{ margin: "20px 16px 0" }}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
          color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
        }}>
          {tr("journal.section.title", lang)}
        </div>

        {showSkeleton && (
          <div style={{
            marginTop: 12, padding: 16, borderRadius: 22,
            background: T.surface, border: `1px solid ${T.border}`,
          }}>
            <Skeleton T={T} width="60%" height={16} marginBottom={10}/>
            <Skeleton T={T} height={12} marginBottom={6}/>
            <Skeleton T={T} width="80%" height={12}/>
          </div>
        )}

        {!showSkeleton && showEmpty && (
          <div style={{
            marginTop: 12, padding: "14px 16px", borderRadius: 22,
            background: T.surface, border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: T.bg, color: T.textMute, border: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="9" y1="13" x2="15" y2="13"/>
                <line x1="9" y1="17" x2="13" y2="17"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2,
              }}>{tr("journal.empty.title", lang)}</div>
              <div style={{
                fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.4,
              }}>{tr("journal.empty.sub", lang)}</div>
            </div>
          </div>
        )}

        {!showSkeleton && !showEmpty && recap && (
          <button
            onClick={() => { setOpen(true); hapticNative("tap").catch(() => {}); }}
            style={{
              marginTop: 12, padding: 16, borderRadius: 22,
              width: "100%", textAlign: "left", cursor: "pointer",
              background: T.surface,
              border: `1px solid ${T.border}`,
              fontFamily: "inherit",
              display: "block",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: T.accentSoft, color: T.accent,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text,
                }}>{tr("journal.cta.title", lang)}</div>
                <div style={{
                  fontFamily: FONT.mono, fontSize: 11, color: T.textMute, marginTop: 2,
                }}>
                  {tr("journal.cta.sub", lang, { n: String(recap.stats.closed) })}
                </div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>

            {/* Stats strip */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <Stat T={T}
                label={tr("journal.stat.win_rate", lang)}
                value={recap.stats.battingAvg !== null
                  ? `${Math.round(recap.stats.battingAvg * 100)}%`
                  : "—"}
                positive={recap.stats.battingAvg >= 0.55}
              />
              <Stat T={T}
                label={tr("journal.stat.realized", lang)}
                value={`${recap.stats.totalRealized >= 0 ? "+" : ""}US$${fmtMoney(Math.abs(recap.stats.totalRealized), "USD")}`}
                positive={recap.stats.totalRealized >= 0}
              />
            </div>

            {recap.headline && (
              <div style={{
                fontFamily: FONT.display, fontSize: 14, fontWeight: 700,
                color: T.text, lineHeight: 1.35, marginBottom: 6,
              }}>{recap.headline}</div>
            )}
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
              lineHeight: 1.5, marginBottom: 8,
            }}>{recap.narrative}</div>
            {recap.lesson && (
              <div style={{
                padding: "8px 10px", borderRadius: 10,
                background: T.accentSoft, border: `1px solid ${T.accent}33`,
                fontFamily: FONT.sans, fontSize: 12, color: T.text, lineHeight: 1.5,
              }}>
                <span style={{ color: T.accent, fontWeight: 800 }}>★ {tr("journal.lesson_label", lang)}:</span>{" "}{recap.lesson}
              </div>
            )}
          </button>
        )}
      </div>
      {open && <JournalSheet T={T} lang={lang} onClose={() => setOpen(false)} />}
    </>
  );
}

function Stat({ T, label, value, positive }) {
  return (
    <div style={{
      flex: 1, padding: "8px 12px", borderRadius: 10,
      background: T.bg, border: `1px solid ${T.border}`,
    }}>
      <div style={{
        fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
        color: T.textMute, letterSpacing: 0.5, textTransform: "uppercase",
        marginBottom: 2,
      }}>{label}</div>
      <div style={{
        fontFamily: FONT.mono, fontSize: 14, fontWeight: 800,
        color: positive ? T.accent : T.danger,
      }}>{value}</div>
    </div>
  );
}

function JournalSheet({ T, lang, onClose }) {
  const [entries, setEntries] = useState(null);
  const [reflectingId, setReflectingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await listJournal({ limit: 200 });
      if (!cancelled) setEntries(data);
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleReflect(entryId) {
    if (reflectingId) return;
    setReflectingId(entryId);
    try {
      const res = await journalReflect(entryId);
      if (res?.reflection) {
        setEntries((cur) => (cur || []).map((e) =>
          e.id === entryId ? { ...e, reflection: res.reflection } : e
        ));
      }
    } catch (_e) { /* swallow */ }
    finally { setReflectingId(null); }
  }

  if (typeof document === "undefined") return null;

  return ReactDOM.createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 140,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "92dvh",
        background: T.bgElev || T.bg, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border }}/>
        </div>
        <div style={{
          padding: "12px 22px 10px",
          background: `linear-gradient(180deg, ${T.accentSoft} 0%, transparent 100%)`,
        }}>
          <div style={{
            fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
            color: T.accent, letterSpacing: 0.6, textTransform: "uppercase",
            marginBottom: 4,
          }}>{tr("journal.sheet.kicker", lang)}</div>
          <div style={{
            fontFamily: FONT.display, fontSize: 22, fontWeight: 800,
            color: T.text, letterSpacing: -0.3,
          }}>{tr("journal.sheet.title", lang)}</div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px 20px" }}>
          {entries === null && (
            <Skeleton T={T} height={80} marginBottom={10}/>
          )}
          {entries !== null && entries.length === 0 && (
            <div style={{
              padding: 24, textAlign: "center", borderRadius: 14,
              background: T.surface, border: `1px solid ${T.border}`,
              fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
            }}>{tr("journal.sheet.empty", lang)}</div>
          )}
          {entries !== null && entries.map((e) => {
            const outcomeColor = e.outcome === "gain" ? T.accent
              : e.outcome === "loss" ? T.danger
              : T.textMute;
            const outcomeLabel = tr(`journal.outcome.${e.outcome || "open"}`, lang);
            const dateLabel = new Date(e.occurred_at).toLocaleDateString("es-AR", {
              day: "2-digit", month: "short", year: "numeric",
            });
            return (
              <div key={e.id} style={{
                marginBottom: 10, padding: 14, borderRadius: 14,
                background: T.surface, border: `1px solid ${T.border}`,
              }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                  <span style={{
                    fontFamily: FONT.mono, fontSize: 13, fontWeight: 800, color: T.text,
                  }}>{e.ticker}</span>
                  <span style={{
                    fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                    padding: "2px 6px", borderRadius: 4,
                    background: outcomeColor + "22", color: outcomeColor,
                    letterSpacing: 0.5, textTransform: "uppercase",
                  }}>{outcomeLabel}</span>
                  <span style={{ flex: 1 }}/>
                  <span style={{ fontFamily: FONT.mono, fontSize: 10, color: T.textMute }}>{dateLabel}</span>
                </div>
                <div style={{
                  fontFamily: FONT.mono, fontSize: 11, color: T.textMute, marginBottom: 6,
                }}>
                  {e.side === "buy" ? "Compra" : "Venta"} · {Number(e.qty).toLocaleString("es-AR")} @ {Number(e.price).toLocaleString("es-AR")}
                  {e.realized_usd != null && (
                    <span style={{ color: outcomeColor, fontWeight: 700, marginLeft: 8 }}>
                      P/L: {e.realized_usd >= 0 ? "+" : ""}US${fmtMoney(Math.abs(e.realized_usd), "USD")}
                    </span>
                  )}
                </div>
                {e.thesis_at_entry && (
                  <div style={{
                    padding: "8px 10px", borderRadius: 8, marginBottom: 6,
                    background: T.bg, border: `1px solid ${T.border}`,
                    fontFamily: FONT.sans, fontSize: 12, color: T.text, lineHeight: 1.5,
                    fontStyle: "italic",
                  }}>"{e.thesis_at_entry}"</div>
                )}
                {e.reflection && (
                  <div style={{
                    padding: "8px 10px", borderRadius: 8, marginBottom: 6,
                    background: T.accentSoft, border: `1px solid ${T.accent}33`,
                    fontFamily: FONT.sans, fontSize: 12, color: T.text, lineHeight: 1.5,
                  }}>
                    <span style={{ color: T.accent, fontWeight: 700, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", marginRight: 6 }}>
                      ✦ {tr("journal.reflection_label", lang)}
                    </span>
                    {e.reflection}
                  </div>
                )}
                {!e.reflection && e.outcome && e.outcome !== "open" && (
                  <button
                    onClick={() => handleReflect(e.id)}
                    disabled={reflectingId === e.id}
                    style={{
                      padding: "6px 10px", borderRadius: 8, marginTop: 4,
                      background: T.bg, border: `1px solid ${T.accent}55`,
                      color: T.accent, fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
                      cursor: reflectingId === e.id ? "default" : "pointer",
                      opacity: reflectingId === e.id ? 0.6 : 1,
                    }}
                  >
                    {reflectingId === e.id
                      ? tr("journal.reflect_busy", lang)
                      : tr("journal.reflect_cta", lang)}
                  </button>
                )}
              </div>
            );
          })}
          <DisclaimerStrip T={T} variant="card" textKey="common.ai_disclaimer" lang={lang} />
        </div>

        <div style={{
          padding: "12px 18px calc(env(safe-area-inset-bottom) + 16px)",
          borderTop: `1px solid ${T.border}`,
          background: T.bgElev || T.bg,
        }}>
          <button onClick={onClose} style={{
            width: "100%", padding: "13px 16px", borderRadius: 14,
            background: T.accent, border: "none",
            color: T.accentInk, fontFamily: FONT.sans, fontSize: 14, fontWeight: 800,
            cursor: "pointer",
          }}>{tr("journal.close", lang)}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
