// ============================================================
// Tutorials hub (samas-0.4.1)
// ============================================================
// In-app guides for AR retail — financial literacy + product
// walkthroughs. Two surfaces:
//   - TutorialsHub: list view (the cards). Sits as a fullscreen
//     overlay above the shell; back arrow returns to Settings.
//   - TutorialDetail: bottom sheet that renders the markdown body
//     of a single tutorial. Opens on tap from the hub list.
//
// Markdown rendering uses the same tiny in-house parser as
// QuarterlyReviewSheet (## h2 + ** bold inline + paragraph
// breaks). No react-markdown dep — 6 articles don't justify the
// bundle weight.
//
// Read state: localStorage key 'samas_tutorials_read' is a JSON
// array of tutorial ids the user has opened. Used for the small
// "✓ visto" chip on the hub list. Tap-to-open marks as read; we
// don't gate anything on read state.
// ============================================================

import React, { useState } from "react";
import ReactDOM from "react-dom";
import { FONT } from "./theme.js";
import { t as tr } from "../lib/i18n.js";
import { TUTORIALS } from "./tutorialsData.js";

const READ_KEY = "samas_tutorials_read";

function getRead() {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (_) { return new Set(); }
}

function markRead(id) {
  try {
    const set = getRead();
    set.add(id);
    localStorage.setItem(READ_KEY, JSON.stringify([...set]));
  } catch (_) { /* noop */ }
}

// Tiny markdown renderer — handles ## h2, **bold** inline, blank
// lines as paragraph breaks. Good enough for the in-house tutorial
// bodies; no external deps.
//
// samas-0.4.3: bolded terms (**term**) render as tappable buttons
// with a dotted-underline hint. Tap → dispatches samas:explain-term
// with the term so the global Explain modal opens pre-filled.
// Compromise alternative to long-press text selection (which iOS
// WebView's system menu hijacks unreliably).
function renderMarkdown(md, T, lang = "es") {
  if (!md) return null;
  const lines = md.split("\n");
  const elements = [];
  let para = [];
  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join(" ").trim();
    if (text) elements.push(
      <p key={`p-${elements.length}`} style={{
        fontFamily: FONT.sans, fontSize: 14, color: T.textMute, lineHeight: 1.65,
        margin: "0 0 14px",
      }}>{renderInline(text, T, lang)}</p>
    );
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      flushPara();
      elements.push(
        <h2 key={`h-${elements.length}`} style={{
          fontFamily: FONT.display, fontSize: 17, fontWeight: 800,
          color: T.text, letterSpacing: -0.3, margin: "20px 0 10px",
        }}>{line.slice(3)}</h2>
      );
    } else if (line === "") {
      flushPara();
    } else {
      para.push(line);
    }
  }
  flushPara();
  return elements;
}

function renderInline(text, T, lang) {
  // Split on **bold** + plain text. Bullet lines starting with - or
  // ✅ / ❌ get a small list-item indent so they read distinct from
  // body paragraphs.
  const isBullet = text.startsWith("- ") || text.startsWith("✅ ") || text.startsWith("❌ ");
  const inner = isBullet
    ? <span style={{ display: "block", paddingLeft: 8 }}>{splitBold(text, T, lang)}</span>
    : splitBold(text, T, lang);
  return inner;
}

function splitBold(text, T, lang) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      const term = p.slice(2, -2);
      return (
        <button
          key={i}
          onClick={(e) => {
            e.stopPropagation();
            try {
              window.dispatchEvent(new CustomEvent("samas:explain-term", {
                detail: { term },
              }));
            } catch (_) { /* SSR */ }
          }}
          aria-label={tr("explain.aria_explain_term", lang, { t: term })}
          style={{
            background: "transparent", border: "none", padding: 0,
            color: T.text, fontFamily: "inherit", fontSize: "inherit",
            fontWeight: 700, cursor: "pointer",
            textDecoration: "underline",
            textDecorationStyle: "dotted",
            textDecorationColor: T.accent,
            textDecorationThickness: "1.5px",
            textUnderlineOffset: "3px",
          }}
        >
          {term}
        </button>
      );
    }
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

// ----- Hub: list of tutorial cards -----
export function TutorialsHub({ T, lang = "es", onClose }) {
  const [readSet, setReadSet] = useState(() => getRead());
  const [openId, setOpenId] = useState(null);

  function open(id) {
    setOpenId(id);
    if (!readSet.has(id)) {
      markRead(id);
      const next = new Set(readSet);
      next.add(id);
      setReadSet(next);
    }
  }

  if (typeof document === "undefined") return null;

  return ReactDOM.createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 150,
      background: T.bg, color: T.text,
      display: "flex", flexDirection: "column",
      paddingTop: "calc(env(safe-area-inset-top) + 8px)",
      paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 16px",
        borderBottom: `1px solid ${T.border}`,
      }}>
        <button onClick={onClose} aria-label={tr("tutorials.back", lang)} style={{
          width: 32, height: 32, borderRadius: 10,
          background: T.surface, border: `1px solid ${T.border}`,
          color: T.text, cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: FONT.display, fontSize: 22, fontWeight: 800,
            color: T.text, letterSpacing: -0.5,
          }}>{tr("tutorials.title", lang)}</div>
          <div style={{
            fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
            marginTop: 2,
          }}>{tr("tutorials.subtitle", lang)}</div>
        </div>
      </div>

      {/* List */}
      <div style={{
        flex: 1, overflowY: "auto",
        padding: "12px 16px 24px",
      }}>
        {TUTORIALS.map((tut) => {
          const isRead = readSet.has(tut.id);
          return (
            <button
              key={tut.id}
              onClick={() => open(tut.id)}
              style={{
                width: "100%", marginBottom: 10, padding: "14px 16px",
                borderRadius: 18, cursor: "pointer", textAlign: "left",
                background: T.surface, border: `1px solid ${T.border}`,
                display: "flex", alignItems: "center", gap: 14,
              }}
            >
              <div style={{
                width: 44, height: 44, flexShrink: 0, borderRadius: 12,
                background: T.accentSoft,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22,
              }}>{tut.glyph}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text,
                  marginBottom: 3,
                }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{tut.title}</span>
                  {isRead && (
                    <span style={{
                      fontFamily: FONT.mono, fontSize: 9, fontWeight: 800,
                      padding: "2px 7px", borderRadius: 999,
                      background: T.accent, color: T.accentInk,
                      letterSpacing: 0.4, textTransform: "uppercase",
                    }}>{tr("tutorials.read_chip", lang)}</span>
                  )}
                </div>
                <div style={{
                  fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
                  lineHeight: 1.4,
                }}>{tut.subtitle}</div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          );
        })}
      </div>

      {/* Detail sheet (when an item is tapped) */}
      {openId && (
        <TutorialDetail
          T={T}
          lang={lang}
          tutorial={TUTORIALS.find((t) => t.id === openId)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>,
    document.body,
  );
}

// ----- Detail: bottom sheet rendering the markdown body -----
function TutorialDetail({ T, lang = "es", tutorial, onClose }) {
  if (!tutorial) return null;
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 160,
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
          padding: "12px 22px 14px",
          background: `linear-gradient(180deg, ${T.accentSoft} 0%, transparent 100%)`,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: T.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20,
          }}>{tutorial.glyph}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: FONT.display, fontSize: 19, fontWeight: 800,
              color: T.text, letterSpacing: -0.3, lineHeight: 1.2,
            }}>{tutorial.title}</div>
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
              marginTop: 2,
            }}>{tutorial.subtitle}</div>
          </div>
        </div>

        {/* Body */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "14px 22px 24px",
        }}>
          {renderMarkdown(tutorial.body, T, lang)}
        </div>

        {/* Sticky close */}
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
          }}>{tr("tutorials.close", lang)}</button>
        </div>
      </div>
    </div>
  );
}
