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

import React, { useState, useMemo } from "react";
import ReactDOM from "react-dom";
import { FONT } from "./theme.js";
import { t as tr } from "../lib/i18n.js";
import { TUTORIALS } from "./tutorialsData.js";
import { completeTutorial, getEducationStats } from "../lib/education.js";

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
  // samas-0.4.35: bumped on completeTutorial to force a re-read of
  // education stats. Lighter than threading through state from the
  // detail sheet.
  const [progressTick, setProgressTick] = useState(0);
  const stats = useMemo(
    () => getEducationStats(TUTORIALS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [progressTick],
  );

  function open(id) {
    setOpenId(id);
    if (!readSet.has(id)) {
      markRead(id);
      const next = new Set(readSet);
      next.add(id);
      setReadSet(next);
    }
    // Tutorial counts as completed on first open. Awards XP +
    // bumps streak. Idempotent — re-opening doesn't double-count.
    const tut = TUTORIALS.find((t) => t.id === id);
    if (tut) {
      completeTutorial(id, tut.xp || 10);
      setProgressTick((n) => n + 1);
    }
  }

  // Group tutorials by module — Duolingo-style "lessons" within a
  // "course". Order preserves the order from tutorialsData.js so a
  // change in the canonical list reorders the path automatically.
  const modules = useMemo(() => {
    const out = new Map();
    for (const t of TUTORIALS) {
      const m = t.module || "fundamentals";
      if (!out.has(m)) out.set(m, []);
      out.get(m).push(t);
    }
    return Array.from(out.entries()); // [["fundamentals", [...]], ["strategy", [...]]]
  }, []);

  if (typeof document === "undefined") return null;

  return ReactDOM.createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 150,
      background: T.bg, color: T.text,
      display: "flex", flexDirection: "column",
      paddingTop: "calc(env(safe-area-inset-top) + 8px)",
      paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)",
    }}>
      {/* Header — Duolingo-style top bar with back + stats. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 16px 16px",
        borderBottom: `1px solid ${T.border}`,
      }}>
        <button onClick={onClose} aria-label={tr("tutorials.back", lang)} style={{
          width: 32, height: 32, borderRadius: 10, flexShrink: 0,
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

      {/* Stats row — 🔥 streak + ⭐ XP + ✓ progress */}
      <div style={{
        display: "flex", gap: 8,
        padding: "12px 16px 0",
      }}>
        <StatPill T={T}
          icon="🔥"
          value={stats.streakCurrent}
          label={tr("tutorials.stats.streak", lang)}
          color="#F59E0B"
        />
        <StatPill T={T}
          icon="⭐"
          value={stats.totalXp}
          label="XP"
          color={T.accent}
        />
        <StatPill T={T}
          icon="✓"
          value={`${stats.completed}/${stats.total}`}
          label={tr("tutorials.stats.completed", lang)}
          color={T.accent}
        />
      </div>

      {/* Path — modules with zigzag tutorial nodes, Duolingo-style. */}
      <div style={{
        flex: 1, overflowY: "auto",
        padding: "16px 0 80px",
      }}>
        {modules.map(([moduleId, tutorials], modIdx) => (
          <ModuleSection
            key={moduleId}
            T={T}
            lang={lang}
            moduleId={moduleId}
            moduleIndex={modIdx}
            tutorials={tutorials}
            completedSet={stats.completedSet}
            onOpen={open}
          />
        ))}
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

// ----- Duolingo-style helpers (samas-0.4.35) -----

function StatPill({ T, icon, value, label, color }) {
  return (
    <div style={{
      flex: 1, padding: "8px 10px", borderRadius: 12,
      background: T.surface, border: `1px solid ${T.border}`,
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 14, fontWeight: 800,
          color: color || T.text, lineHeight: 1.1,
        }}>{value}</div>
        <div style={{
          fontFamily: FONT.sans, fontSize: 9, color: T.textMute,
          letterSpacing: 0.5, textTransform: "uppercase", marginTop: 2,
        }}>{label}</div>
      </div>
    </div>
  );
}

function ModuleSection({ T, lang, moduleId, moduleIndex, tutorials, completedSet, onOpen }) {
  const moduleLabel = tr(`tutorials.module.${moduleId}`, lang);
  const completed = tutorials.filter((t) => completedSet.has(t.id)).length;
  const total = tutorials.length;
  // Module unlocks when the previous module is fully completed (or
  // it's the first module). Locked modules show greyed out + lock
  // icon, can be tapped to see preview but tutorials inside don't
  // award XP until unlocked.
  // For the prototype we keep all modules unlocked so the user can
  // explore freely — Duolingo gating is nice but requires more
  // content to feel meaningful. Add gating in 0.5+ if user feedback
  // wants it.
  const locked = false;

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Module header */}
      <div style={{
        margin: "0 16px 12px",
        padding: "10px 14px",
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 14,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: locked ? T.bg : T.accent,
          color: locked ? T.textMute : T.accentInk,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: FONT.mono, fontSize: 12, fontWeight: 800,
        }}>{moduleIndex + 1}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: FONT.sans, fontSize: 13, fontWeight: 800, color: T.text,
          }}>{moduleLabel}</div>
          <div style={{
            fontFamily: FONT.mono, fontSize: 10, color: T.textMute, marginTop: 2,
          }}>{completed}/{total} · {tr("tutorials.module.lessons", lang)}</div>
        </div>
        {/* Module progress bar */}
        <div style={{
          width: 60, height: 6, borderRadius: 3, flexShrink: 0,
          background: T.bg, overflow: "hidden",
        }}>
          <div style={{
            width: `${total > 0 ? (completed / total) * 100 : 0}%`,
            height: "100%",
            background: T.accent,
            transition: "width 200ms",
          }}/>
        </div>
      </div>

      {/* Path — vertical zigzag of tutorial nodes (samas-0.4.38)
          Reescrito desde 0.4.35: el layout original usaba absolute
          positioning para caption + XP, lo que causaba que los
          textos se montaran sobre el siguiente node. Ahora cada
          row es flex-column en static flow (button + title + xp
          stacked), con el zigzag offset aplicado a través de un
          wrapper con transform. La conexión entre nodes es una
          línea SVG-equivalente positioned absolutely en el row
          container. */}
      <div style={{ position: "relative", padding: "0 16px" }}>
        {tutorials.map((tut, i) => {
          const isCompleted = completedSet.has(tut.id);
          // "Next up" = first non-completed. Pulse-glow animation.
          const isNextUp = !isCompleted &&
            tutorials.slice(0, i).every((t) => completedSet.has(t.id));
          // Zigzag offset alterna izquierda/derecha de centro.
          const offset = i % 2 === 0 ? -28 : 28;
          // Row height: button 76 + gap 8 + caption ~32 (dos líneas)
          // + gap 4 + XP ~12 + bottom padding 24 = ~156px.
          const ROW_HEIGHT = 156;
          return (
            <div key={tut.id} style={{
              position: "relative",
              height: ROW_HEIGHT,
            }}>
              {/* Connector line to next node — sits behind the
                  button. Spans from the bottom of this button down
                  to the top of the next button. */}
              {i < tutorials.length - 1 && (
                <div style={{
                  position: "absolute",
                  top: 76 + 4,                // just below this button
                  height: ROW_HEIGHT - 76 - 4,
                  left: "50%", width: 2, marginLeft: -1,
                  background: isCompleted ? T.accent : T.border,
                  zIndex: 0,
                  opacity: 0.7,
                }}/>
              )}
              {/* Stacked column: button + title + XP. The whole
                  stack is offset horizontally for the zigzag —
                  caption + XP follow the button so they never
                  collide with the next row's content. */}
              <div style={{
                position: "absolute",
                left: `calc(50% + ${offset}px)`,
                top: 0,
                transform: "translateX(-50%)",
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: 6,
                zIndex: 1,
                width: 140,
              }}>
                <button
                  onClick={() => onOpen(tut.id)}
                  style={{
                    width: 76, height: 76, borderRadius: "50%",
                    background: isCompleted ? T.accent : (isNextUp ? T.accentSoft : T.surface),
                    border: `3px solid ${isCompleted ? T.accent : (isNextUp ? T.accent : T.border)}`,
                    color: isCompleted ? T.accentInk : T.text,
                    cursor: "pointer", padding: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "inherit",
                    animation: isNextUp ? "samas-pulse 2s ease-in-out infinite" : "none",
                    boxShadow: isNextUp
                      ? `0 4px 12px ${T.accent}55`
                      : "0 2px 6px rgba(0,0,0,0.2)",
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontSize: 26, lineHeight: 1 }}>
                    {isCompleted ? "✓" : tut.glyph}
                  </span>
                </button>
                <div style={{
                  fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
                  color: isCompleted ? T.accent : T.text,
                  textAlign: "center",
                  lineHeight: 1.3,
                }}>{tut.title}</div>
                <div style={{
                  fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                  color: T.textMute,
                }}>+{tut.xp || 10} XP</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
