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
import { useDragToDismiss } from "./useDragToDismiss.js";
import { completeTutorial, getEducationStats } from "../lib/education.js";
import { hapticNative } from "../lib/native.js";

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
    // 0.4.69 — no more auto-complete on open. The tutorial now
    // completes after the user passes the quiz (TutorialDetail
    // → onComplete). markRead still fires here so the "✓ visto"
    // chip shows on the hub, but XP + streak need the quiz pass.
  }

  // Called when the user finishes a quiz inside TutorialDetail.
  function onTutorialComplete() {
    setProgressTick((n) => n + 1);
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
        {modules.map(([moduleId, tutorials], modIdx) => {
          // 0.4.69 — lock-gating between modules. The first module is
          // always unlocked. Subsequent modules unlock when the previous
          // module is fully completed.
          const prevModuleTutorials = modIdx > 0 ? modules[modIdx - 1][1] : [];
          const prevModuleDone = prevModuleTutorials.every(
            (t) => stats.completedSet.has(t.id)
          );
          const locked = modIdx > 0 && !prevModuleDone;
          const prevModuleLabel = modIdx > 0
            ? tr(`tutorials.module.${modules[modIdx - 1][0]}`, lang)
            : "";
          return (
            <ModuleSection
              key={moduleId}
              T={T}
              lang={lang}
              moduleId={moduleId}
              moduleIndex={modIdx}
              tutorials={tutorials}
              completedSet={stats.completedSet}
              perfectSet={stats.perfectSet}
              onOpen={open}
              locked={locked}
              prevModuleLabel={prevModuleLabel}
            />
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
          onComplete={onTutorialComplete}
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

function ModuleSection({ T, lang, moduleId, moduleIndex, tutorials, completedSet, perfectSet, onOpen, locked, prevModuleLabel }) {
  const moduleLabel = tr(`tutorials.module.${moduleId}`, lang);
  const completed = tutorials.filter((t) => completedSet.has(t.id)).length;
  const total = tutorials.length;

  return (
    <div style={{ marginBottom: 28, opacity: locked ? 0.55 : 1 }}>
      {/* Module header */}
      <div style={{
        margin: "0 16px 12px",
        padding: "10px 14px",
        background: T.surface, border: `1px solid ${locked ? T.border : T.border}`,
        borderRadius: 14,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: locked ? T.bg : T.accent,
          color: locked ? T.textMute : T.accentInk,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: FONT.mono, fontSize: 12, fontWeight: 800,
        }}>
          {locked ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          ) : moduleIndex + 1}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: FONT.sans, fontSize: 13, fontWeight: 800, color: T.text,
          }}>{moduleLabel}</div>
          <div style={{
            fontFamily: FONT.mono, fontSize: 10, color: T.textMute, marginTop: 2,
          }}>
            {locked
              ? tr("tutorials.module.locked_hint", lang, { prev: prevModuleLabel })
              : `${completed}/${total} · ${tr("tutorials.module.lessons", lang)}`
            }
          </div>
        </div>
        {/* Module progress bar — solo cuando no está locked */}
        {!locked && (
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
        )}
      </div>

      {/* Path — Duolingo-style zigzag (rewritten 0.4.51)
          Antes: zigzag offset chico (-28/+28) que NO se notaba +
          texto verde brillante en TODOS los completed (lee a chillón) +
          conector recto que iba por el medio sin alinear con nodes.
          Ahora: zigzag drástico (-64/+64) que sí lee como path,
          texto muted para completed (no compite con el highlight
          del nextUp), conector continuo subtle. */}
      <div style={{ position: "relative", padding: "0 16px" }}>
        {tutorials.map((tut, i) => {
          const isCompleted = completedSet.has(tut.id);
          const isNextUp = !isCompleted &&
            tutorials.slice(0, i).every((t) => completedSet.has(t.id));
          // Zigzag — más drástico para que se note de verdad.
          const offset = i % 2 === 0 ? -64 : 64;
          // Cada row tiene altura suficiente para button + title +
          // XP sin que el title del próximo se monte. 168px da
          // breathing room.
          const ROW_HEIGHT = 168;
          // Color del title: completed → muted (no compite),
          // nextUp → accent (highlight), otros → text.
          const titleColor = isCompleted
            ? T.textMute
            : (isNextUp ? T.accent : T.text);
          return (
            <div key={tut.id} style={{
              position: "relative",
              height: ROW_HEIGHT,
            }}>
              {/* Connector — línea sutil que va por el centro. Como
                  los nodes zigzaguean, el connector pasa "detrás"
                  de cada uno. Visualmente lee como un camino. */}
              {i < tutorials.length - 1 && (
                <div style={{
                  position: "absolute",
                  top: 76,
                  height: ROW_HEIGHT - 76,
                  left: "50%", width: 2, marginLeft: -1,
                  background: isCompleted ? T.accent : T.border,
                  zIndex: 0,
                  opacity: isCompleted ? 0.5 : 0.35,
                }}/>
              )}
              <div style={{
                position: "absolute",
                left: `calc(50% + ${offset}px)`,
                top: 0,
                transform: "translateX(-50%)",
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: 8,
                zIndex: 1,
                width: 140,
              }}>
                <button
                  onClick={() => { if (!locked) onOpen(tut.id); }}
                  disabled={locked}
                  style={{
                    width: 76, height: 76, borderRadius: "50%",
                    background: locked
                      ? T.surface
                      : (isCompleted ? T.accent : (isNextUp ? T.accentSoft : T.surface)),
                    border: `3px solid ${locked ? T.border : (isCompleted ? T.accent : (isNextUp ? T.accent : T.border))}`,
                    color: locked ? T.textMute : (isCompleted ? T.accentInk : T.text),
                    cursor: locked ? "not-allowed" : "pointer", padding: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "inherit",
                    animation: (isNextUp && !locked) ? "samas-pulse 2s ease-in-out infinite" : "none",
                    boxShadow: (isNextUp && !locked)
                      ? `0 4px 12px ${T.accent}55`
                      : "0 2px 6px rgba(0,0,0,0.2)",
                    flexShrink: 0,
                    opacity: isCompleted ? 0.78 : 1,
                    transition: "transform 120ms",
                  }}
                  onTouchStart={(e) => { if (!locked) e.currentTarget.style.transform = "scale(0.92)"; }}
                  onTouchEnd={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                >
                  <span style={{ fontSize: 26, lineHeight: 1 }}>
                    {locked
                      ? "🔒"
                      : (isCompleted ? "✓" : tut.glyph)
                    }
                  </span>
                </button>
                <div style={{
                  fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
                  color: titleColor,
                  textAlign: "center",
                  lineHeight: 1.3,
                }}>{tut.title}</div>
                {/* Star row — 1 star = completed, 2 = perfect. */}
                <div style={{
                  display: "flex", gap: 2, alignItems: "center",
                  fontSize: 10, lineHeight: 1,
                }}>
                  {isCompleted && (
                    <>
                      <span style={{ color: T.accent }}>★</span>
                      <span style={{ color: perfectSet?.has(tut.id) ? T.accent : T.border }}>★</span>
                    </>
                  )}
                  {!isCompleted && (
                    <span style={{
                      fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, color: T.textMute,
                    }}>+{tut.xp || 10} XP</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ----- Detail: read → quiz → done state machine (samas-0.4.69) -----
// Stages:
//   "read"   — markdown body. CTA at the bottom: "Probá lo que aprendiste".
//   "quiz"   — multiple-choice questions, one at a time.
//              Sub-stages: selecting (no answer yet) → revealed (after Verificar).
//   "done"   — completion screen: "¡Listo!" + XP earned + close.
// If a tutorial has no questions array (legacy), we fall back to the
// old read-only behavior (tap Cerrar to mark complete).
function TutorialDetail({ T, lang = "es", tutorial, onClose, onComplete }) {
  const dtd = useDragToDismiss(onClose);
  const questions = tutorial?.questions || [];
  const hasQuiz = questions.length > 0;
  const [stage, setStage] = useState("read"); // "read" | "quiz" | "done"
  const [qIdx, setQIdx] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [firstTryCorrect, setFirstTryCorrect] = useState(0);
  const [attemptsThisQ, setAttemptsThisQ] = useState(0);
  // Result computed when the quiz finishes — used by the done screen.
  const [result, setResult] = useState(null); // { gainedXp, newPerfect, perfect }

  if (!tutorial) return null;

  const q = questions[qIdx];
  const totalQ = questions.length;

  function startQuiz() {
    setStage("quiz");
    setQIdx(0);
    setSelectedIdx(null);
    setRevealed(false);
    setFirstTryCorrect(0);
    setAttemptsThisQ(0);
  }

  function checkAnswer() {
    if (selectedIdx == null) return;
    const correct = selectedIdx === q.correctIdx;
    if (correct && attemptsThisQ === 0) {
      setFirstTryCorrect((n) => n + 1);
    }
    setRevealed(true);
    hapticNative(correct ? "success" : "warning").catch(() => {});
  }

  function nextQuestion() {
    const correct = selectedIdx === q.correctIdx;
    if (!correct) {
      // Wrong answer → retry this question. Don't advance.
      setSelectedIdx(null);
      setRevealed(false);
      setAttemptsThisQ((n) => n + 1);
      return;
    }
    // Correct → advance or finish.
    if (qIdx + 1 >= totalQ) finishQuiz();
    else {
      setQIdx((i) => i + 1);
      setSelectedIdx(null);
      setRevealed(false);
      setAttemptsThisQ(0);
    }
  }

  function finishQuiz() {
    const perfect = firstTryCorrect === totalQ;
    const base = tutorial.xp || 10;
    const bonus = firstTryCorrect * 2;
    const r = completeTutorial(tutorial.id, base, bonus, perfect);
    setResult({ ...r, perfect });
    setStage("done");
    hapticNative(perfect ? "success" : "tap").catch(() => {});
    if (onComplete) onComplete();
  }

  // For tutorials WITHOUT a quiz (legacy fallback) — keep the old
  // behavior: tapping Cerrar marks the tutorial as completed.
  function closeLegacy() {
    if (!hasQuiz && tutorial) {
      completeTutorial(tutorial.id, tutorial.xp || 10);
      if (onComplete) onComplete();
    }
    onClose();
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 160,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div ref={dtd.ref} style={{
        width: "100%", maxWidth: 540, maxHeight: "92dvh",
        background: T.bgElev || T.bg, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        display: "flex", flexDirection: "column", overflow: "hidden",
        ...dtd.dragStyle,
      }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border }}/>
        </div>

        {/* Header — same across all stages except "done" which renders
            its own celebration view. */}
        {stage !== "done" && (
          <div style={{
            padding: "12px 22px 14px",
            background: "transparent",
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
              }}>{stage === "quiz"
                ? tr("tutorials.quiz.q_label", lang, { n: qIdx + 1, total: totalQ })
                : tutorial.subtitle
              }</div>
            </div>
          </div>
        )}

        {/* Stage: read */}
        {stage === "read" && (
          <>
            <div style={{
              flex: 1, overflowY: "auto", padding: "14px 22px 24px",
            }}>
              {renderMarkdown(tutorial.body, T, lang)}
            </div>
            <div style={{
              padding: "12px 18px calc(env(safe-area-inset-bottom) + 16px)",
              borderTop: `1px solid ${T.border}`,
              background: T.bgElev || T.bg,
            }}>
              {hasQuiz ? (
                <button onClick={startQuiz} style={primaryBtn(T)}>
                  {tr("tutorials.cta.start_quiz", lang)}
                </button>
              ) : (
                <button onClick={closeLegacy} style={primaryBtn(T)}>
                  {tr("tutorials.close", lang)}
                </button>
              )}
            </div>
          </>
        )}

        {/* Stage: quiz */}
        {stage === "quiz" && q && (
          <>
            <div style={{
              flex: 1, overflowY: "auto", padding: "8px 22px 24px",
            }}>
              {/* Question prompt */}
              <div style={{
                fontFamily: FONT.display, fontSize: 18, fontWeight: 700,
                color: T.text, lineHeight: 1.4, marginBottom: 18,
              }}>{q.prompt}</div>

              {/* Options */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {q.options.map((opt, i) => {
                  const isSelected = selectedIdx === i;
                  const isCorrect = i === q.correctIdx;
                  const showCorrect = revealed && isCorrect;
                  const showWrong = revealed && isSelected && !isCorrect;
                  let bg = T.surface;
                  let border = T.border;
                  let color = T.text;
                  if (showCorrect) {
                    bg = T.accent + "22";
                    border = T.accent;
                    color = T.text;
                  } else if (showWrong) {
                    bg = (T.danger || "#EF4444") + "22";
                    border = T.danger || "#EF4444";
                    color = T.text;
                  } else if (isSelected) {
                    bg = T.accentSoft || (T.accent + "18");
                    border = T.accent;
                  }
                  return (
                    <button
                      key={i}
                      onClick={() => { if (!revealed) setSelectedIdx(i); }}
                      disabled={revealed}
                      style={{
                        padding: "14px 16px", borderRadius: 14,
                        background: bg, border: `2px solid ${border}`,
                        color, cursor: revealed ? "default" : "pointer",
                        textAlign: "left",
                        fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
                        lineHeight: 1.4,
                        display: "flex", alignItems: "center", gap: 10,
                        transition: "all 120ms",
                      }}
                    >
                      <span style={{ flex: 1 }}>{opt}</span>
                      {showCorrect && <span style={{ fontSize: 18, color: T.accent }}>✓</span>}
                      {showWrong && <span style={{ fontSize: 18, color: T.danger || "#EF4444" }}>✗</span>}
                    </button>
                  );
                })}
              </div>

              {/* Explanation — only when revealed */}
              {revealed && (
                <div style={{
                  marginTop: 18, padding: "12px 14px", borderRadius: 12,
                  background: T.surface, border: `1px solid ${T.border}`,
                  fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
                  lineHeight: 1.55,
                }}>
                  <div style={{
                    fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
                    color: selectedIdx === q.correctIdx ? T.accent : (T.danger || "#EF4444"),
                    letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6,
                  }}>{selectedIdx === q.correctIdx
                    ? tr("tutorials.quiz.correct", lang)
                    : tr("tutorials.quiz.wrong", lang)
                  }</div>
                  {q.explanation}
                </div>
              )}
            </div>

            {/* CTA — Verificar / Siguiente / Reintentar */}
            <div style={{
              padding: "12px 18px calc(env(safe-area-inset-bottom) + 16px)",
              borderTop: `1px solid ${T.border}`,
              background: T.bgElev || T.bg,
            }}>
              {!revealed ? (
                <button
                  onClick={checkAnswer}
                  disabled={selectedIdx == null}
                  style={primaryBtn(T, selectedIdx == null)}
                >
                  {tr("tutorials.quiz.check", lang)}
                </button>
              ) : (
                <button onClick={nextQuestion} style={primaryBtn(T)}>
                  {selectedIdx === q.correctIdx
                    ? (qIdx + 1 >= totalQ
                        ? tr("tutorials.quiz.finish", lang)
                        : tr("tutorials.quiz.next", lang))
                    : tr("tutorials.quiz.retry", lang)
                  }
                </button>
              )}
            </div>
          </>
        )}

        {/* Stage: done — celebration screen */}
        {stage === "done" && (
          <DoneScreen
            T={T}
            lang={lang}
            result={result}
            firstTryCorrect={firstTryCorrect}
            totalQ={totalQ}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

// Reusable primary button — quiz CTA + read CTA share this style.
function primaryBtn(T, disabled = false) {
  return {
    width: "100%", padding: "14px 16px", borderRadius: 14,
    background: disabled ? T.border : T.accent,
    border: "none",
    color: disabled ? T.textMute : T.accentInk,
    fontFamily: FONT.sans, fontSize: 14, fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background 160ms",
  };
}

// Completion screen — confetti + XP earned. Tier message depending on
// first-try accuracy: 100% = ¡Perfecto!, 50%+ = ¡Bien hecho!, else ¡Aprobado!
function DoneScreen({ T, lang, result, firstTryCorrect, totalQ, onClose }) {
  const pct = totalQ > 0 ? firstTryCorrect / totalQ : 1;
  const tierKey = pct === 1
    ? "tutorials.done.perfect"
    : pct >= 0.5
      ? "tutorials.done.good"
      : "tutorials.done.pass";
  const glyph = pct === 1 ? "🌟" : pct >= 0.5 ? "🎉" : "👍";
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "32px 24px calc(env(safe-area-inset-bottom) + 24px)",
      position: "relative", overflow: "hidden",
    }}>
      {/* Tiny confetti — 20 colored squares falling from top.
          Pure CSS animation, no extra deps. */}
      {pct >= 0.5 && (
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          overflow: "hidden",
        }}>
          {Array.from({ length: 20 }).map((_, i) => {
            const colors = [T.accent, "#F59E0B", "#EC4899", "#3B82F6", "#10B981"];
            const left = (i * 5.2) % 100;
            const delay = (i % 5) * 0.18;
            return (
              <div key={i} style={{
                position: "absolute",
                left: `${left}%`, top: -20,
                width: 8, height: 12,
                background: colors[i % colors.length],
                borderRadius: 2,
                animation: `samas-confetti 2.6s ${delay}s ease-in forwards`,
                opacity: 0.85,
              }}/>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 14 }}>{glyph}</div>
      <div style={{
        fontFamily: FONT.display, fontSize: 28, fontWeight: 900,
        color: T.text, letterSpacing: -0.5, textAlign: "center", marginBottom: 8,
      }}>{tr(tierKey, lang)}</div>
      <div style={{
        fontFamily: FONT.sans, fontSize: 14, color: T.textMute,
        textAlign: "center", marginBottom: 24,
      }}>
        {tr("tutorials.done.score", lang, { correct: firstTryCorrect, total: totalQ })}
      </div>

      {/* XP earned pill */}
      <div style={{
        padding: "10px 18px", borderRadius: 999,
        background: T.accent + "22", border: `1px solid ${T.accent}`,
        display: "flex", alignItems: "center", gap: 8, marginBottom: 28,
      }}>
        <span style={{ fontSize: 16 }}>⭐</span>
        <span style={{
          fontFamily: FONT.mono, fontSize: 16, fontWeight: 800, color: T.accent,
        }}>+{result?.gainedXp || 0} XP</span>
      </div>

      <button onClick={onClose} style={{ ...primaryBtn(T), maxWidth: 280 }}>
        {tr("tutorials.done.continue", lang)}
      </button>
    </div>
  );
}
