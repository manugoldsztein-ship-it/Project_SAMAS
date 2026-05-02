// ============================================================
// ExplainTermSheet (samas-0.4.2) — global AI glossary
// ============================================================
// 20th AI surface. User taps the "?" button in the Wallet header,
// types a term they don't understand (e.g. "MEP", "ratio CEDEAR",
// "stop-loss", "idóneo"), tap "Explicar" → IA returns a 2-3 sentence
// definition in plain AR-Spanish + a concrete example + 0-3 related
// terms the user can tap to look up next.
//
// Why a text input vs. long-press text selection? On iOS WebView
// the system Look Up menu always wins on long-press, so we can't
// hijack selection reliably. A typed-input modal is more
// discoverable and works inside any tab.
//
// Recent terms persist in localStorage (samas_explain_recent =
// last 8 unique terms). Tap a chip to re-look-up without retyping.
// ============================================================

import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { FONT } from "./theme.js";
import { t as tr } from "../lib/i18n.js";
import { explainTerm } from "../lib/ai.js";
import { hapticNative } from "../lib/native.js";

const RECENT_KEY = "samas_explain_recent";
const RECENT_MAX = 8;

function getRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

function pushRecent(term) {
  try {
    const cleaned = term.trim();
    if (!cleaned) return;
    const list = getRecent().filter((t) => t.toLowerCase() !== cleaned.toLowerCase());
    list.unshift(cleaned);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch (_) { /* noop */ }
}

// Suggestion chips — common AR-retail terms shown when the input
// is empty + recent list is empty. Helps first-time users discover
// the feature.
const SUGGESTIONS = ["CEDEAR", "MEP", "Ratio CEDEAR", "Stop-loss", "Idóneo CNV", "Drawdown", "Sharpe", "Tax-loss"];

export function ExplainTermSheet({ T, lang = "es", onClose, initialTerm = "" }) {
  const [term, setTerm] = useState(initialTerm);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [recent, setRecent] = useState(() => getRecent());
  const inputRef = useRef(null);

  // Focus the input as soon as the sheet mounts. iOS Webkit needs a
  // small delay so the slide-up animation doesn't fight with the
  // keyboard prompt.
  useEffect(() => {
    const id = setTimeout(() => {
      try { inputRef.current?.focus(); } catch (_) { /* noop */ }
    }, 240);
    return () => clearTimeout(id);
  }, []);

  // Auto-fire if an initialTerm was passed in (e.g. from a deep link).
  useEffect(() => {
    if (initialTerm && initialTerm.trim()) {
      explain(initialTerm.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function explain(t) {
    const cleaned = (t ?? term).trim();
    if (!cleaned || busy) return;
    setBusy(true);
    setErr(null);
    setData(null);
    try {
      const res = await explainTerm({ term: cleaned });
      setData(res);
      pushRecent(cleaned);
      setRecent(getRecent());
      hapticNative("success").catch(() => {});
    } catch (e) {
      if (e?.name === "AIConsentDeniedError" || e?.name === "AIQuotaExceededError") {
        // Silent — modals already opened by the gate.
        onClose && onClose();
        return;
      }
      setErr(e?.message || String(e));
      hapticNative("error").catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  function pickSuggestion(s) {
    setTerm(s);
    explain(s);
  }

  if (typeof document === "undefined") return null;

  const showSuggestions = !data && !busy && term.trim().length === 0;

  return ReactDOM.createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 170,
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
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border }}/>
        </div>

        {/* Header */}
        <div style={{
          padding: "12px 22px 12px",
          background: "transparent",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 12, flexShrink: 0,
            background: T.accent, color: T.accentInk,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 800,
          }}>?</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: FONT.display, fontSize: 17, fontWeight: 800,
              color: T.text, letterSpacing: -0.3,
            }}>{tr("explain.title", lang)}</div>
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
              marginTop: 2,
            }}>{tr("explain.subtitle", lang)}</div>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 20px" }}>
          {/* Input row */}
          <div style={{
            display: "flex", gap: 8, marginBottom: 14,
          }}>
            <input
              ref={inputRef}
              value={term}
              onChange={(e) => setTerm(e.target.value.slice(0, 80))}
              onKeyDown={(e) => { if (e.key === "Enter") explain(); }}
              placeholder={tr("explain.placeholder", lang)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              style={{
                flex: 1, padding: "11px 14px", borderRadius: 12,
                background: T.surface, border: `1px solid ${T.border}`,
                color: T.text, fontFamily: FONT.sans, fontSize: 14,
                outline: "none",
              }}
            />
            <button
              onClick={() => explain()}
              disabled={busy || !term.trim()}
              style={{
                padding: "11px 16px", borderRadius: 12,
                background: T.accent, border: "none",
                color: T.accentInk, fontFamily: FONT.sans, fontSize: 13, fontWeight: 800,
                cursor: busy ? "default" : "pointer", opacity: (busy || !term.trim()) ? 0.5 : 1,
                letterSpacing: 0.2, flexShrink: 0,
              }}>
              {busy ? tr("explain.busy", lang) : tr("explain.cta", lang)}
            </button>
          </div>

          {/* Suggestions or recent */}
          {showSuggestions && (
            <>
              {recent.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{
                    fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                    color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
                    marginBottom: 6,
                  }}>{tr("explain.recent_label", lang)}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {recent.map((t) => (
                      <button key={t} onClick={() => pickSuggestion(t)}
                        style={{
                          padding: "5px 11px", borderRadius: 999,
                          background: T.bg, border: `1px solid ${T.border}`,
                          color: T.text, fontFamily: FONT.sans, fontSize: 12,
                          cursor: "pointer",
                        }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div style={{
                  fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                  color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
                  marginBottom: 6,
                }}>{tr("explain.suggestions_label", lang)}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => pickSuggestion(s)}
                      style={{
                        padding: "5px 11px", borderRadius: 999,
                        background: T.accentSoft, border: `1px solid ${T.accent}33`,
                        color: T.accent, fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
                        cursor: "pointer",
                      }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Error */}
          {err && (
            <div style={{
              padding: "10px 12px", borderRadius: 10,
              background: T.dangerSoft, color: T.danger,
              fontFamily: FONT.sans, fontSize: 12,
            }}>{err}</div>
          )}

          {/* Result */}
          {data && (
            <div>
              <div style={{
                fontFamily: FONT.display, fontSize: 22, fontWeight: 800,
                color: T.text, letterSpacing: -0.3, marginBottom: 8,
              }}>{data.term}</div>

              <div style={{
                padding: "12px 14px", borderRadius: 14,
                background: T.surface, border: `1px solid ${T.border}`,
                fontFamily: FONT.sans, fontSize: 14, color: T.text, lineHeight: 1.55,
                marginBottom: data.example ? 10 : 14,
              }}>{data.definition}</div>

              {data.example && (
                <div style={{
                  padding: "10px 12px", borderRadius: 12,
                  background: T.accentSoft, border: `1px solid ${T.accent}33`,
                  marginBottom: 14,
                }}>
                  <div style={{
                    fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                    color: T.accent, letterSpacing: 0.6, textTransform: "uppercase",
                    marginBottom: 4,
                  }}>{tr("explain.example_label", lang)}</div>
                  <div style={{
                    fontFamily: FONT.sans, fontSize: 13, color: T.text, lineHeight: 1.5,
                  }}>{data.example}</div>
                </div>
              )}

              {data.related && data.related.length > 0 && (
                <div>
                  <div style={{
                    fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                    color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
                    marginBottom: 6,
                  }}>{tr("explain.related_label", lang)}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {data.related.map((r) => (
                      <button key={r} onClick={() => { setTerm(r); explain(r); }}
                        style={{
                          padding: "5px 11px", borderRadius: 999,
                          background: T.bg, border: `1px solid ${T.border}`,
                          color: T.text, fontFamily: FONT.sans, fontSize: 12,
                          cursor: "pointer",
                        }}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky close */}
        <div style={{
          padding: "12px 18px calc(env(safe-area-inset-bottom) + 16px)",
          borderTop: `1px solid ${T.border}`,
          background: T.bgElev || T.bg,
        }}>
          <button onClick={onClose} style={{
            width: "100%", padding: "13px 16px", borderRadius: 14,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 700,
            cursor: "pointer",
          }}>{tr("explain.close", lang)}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
