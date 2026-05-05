// ============================================================
// AITour (samas-0.3.2)
// ============================================================
// One-time fullscreen overlay walking new users through SAMAS's AI
// features. Fires on first launch AFTER the main Onboarding has
// been completed (so the user has an account + a portfolio to
// reference). Dismissable via Skip OR by stepping through to the
// last card.
//
// Persistence: localStorage key 'samas_v2_ai_toured' = "true" once
// the tour has been seen. Settings has a "Volver a ver el tour IA"
// button that flips it back to false so users can replay.
//
// Cohen pitch context: this is the demo's first impression for
// anyone we hand the phone to. They land on this screen, see
// "17 features IA", and the rest of the app pre-positions itself.
// ============================================================

import React, { useState } from "react";
import ReactDOM from "react-dom";
import { FONT } from "./theme.js";
import { t as tr } from "../lib/i18n.js";

const TOUR_KEY = "samas_v2_ai_toured";

// Mark as toured. Called from Settings reset OR by parent on done/skip.
export function markAIToured() {
  try { localStorage.setItem(TOUR_KEY, "true"); } catch (_) {}
}

// Reset (Settings → "Volver a ver tour"). Frees the next mount to
// re-show the tour.
export function resetAIToured() {
  try { localStorage.removeItem(TOUR_KEY); } catch (_) {}
}

// Has the user seen it? Used by Shell to gate first-launch display.
export function hasSeenAITour() {
  try { return localStorage.getItem(TOUR_KEY) === "true"; } catch (_) { return false; }
}

// Card content. Each card has a visual emoji + title + body. Strings
// pulled from i18n so es+en stay in sync.
function cards(lang) {
  return [
    {
      glyph: "✦",
      titleKey: "ai_tour.c1.title",
      bodyKey:  "ai_tour.c1.body",
    },
    {
      glyph: "🌅",
      titleKey: "ai_tour.c2.title",
      bodyKey:  "ai_tour.c2.body",
    },
    {
      glyph: "🛟",
      titleKey: "ai_tour.c3.title",
      bodyKey:  "ai_tour.c3.body",
    },
    {
      glyph: "📋",
      titleKey: "ai_tour.c4.title",
      bodyKey:  "ai_tour.c4.body",
    },
    {
      glyph: "★",
      titleKey: "ai_tour.c5.title",
      bodyKey:  "ai_tour.c5.body",
    },
  ];
}

export function AITour({ T, lang = "es", onDone }) {
  const [idx, setIdx] = useState(0);
  const all = cards(lang);
  const card = all[idx];
  const isLast = idx === all.length - 1;
  const isFirst = idx === 0;

  function finish() {
    markAIToured();
    if (onDone) onDone();
  }

  function next() {
    if (isLast) return finish();
    setIdx((i) => i + 1);
  }
  function back() {
    if (isFirst) return;
    setIdx((i) => i - 1);
  }

  // Renders into document.body via portal so it sits above EVERYTHING
  // (above the shell's status bar overlay, the tab bar, etc).
  if (typeof document === "undefined") return null;

  return ReactDOM.createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: T.bg, color: T.text,
      display: "flex", flexDirection: "column",
      paddingTop: "calc(env(safe-area-inset-top) + 16px)",
      paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
    }}>
      {/* Top bar: skip + progress dots */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "0 20px", marginBottom: 24,
      }}>
        <div style={{ display: "flex", gap: 6 }}>
          {all.map((_, i) => (
            <div key={i} style={{
              width: i === idx ? 22 : 6, height: 6, borderRadius: 3,
              background: i === idx ? T.accent : T.border,
              transition: "width 220ms ease",
            }}/>
          ))}
        </div>
        <button onClick={finish} style={{
          background: "transparent", border: "none",
          color: T.textMute, fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
          cursor: "pointer", padding: 0,
        }}>{tr("ai_tour.skip", lang)}</button>
      </div>

      {/* Body */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", justifyContent: "center",
        alignItems: "center", padding: "0 28px", textAlign: "center",
      }}>
        <div style={{
          width: 140, height: 140, borderRadius: 36,
          background: T.surface,
          border: `1px solid ${T.accent}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 64, marginBottom: 32,
        }}>{card.glyph}</div>
        <div style={{
          fontFamily: FONT.display, fontSize: 26, fontWeight: 800,
          color: T.text, letterSpacing: -0.6, marginBottom: 14,
          lineHeight: 1.2, maxWidth: 360,
        }}>{tr(card.titleKey, lang)}</div>
        <div style={{
          fontFamily: FONT.sans, fontSize: 15, color: T.textMute,
          lineHeight: 1.55, maxWidth: 360,
        }}>{tr(card.bodyKey, lang)}</div>
      </div>

      {/* CTA row */}
      <div style={{ padding: "0 20px", display: "flex", gap: 10 }}>
        {!isFirst && (
          <button onClick={back} style={{
            flex: 1, padding: "14px 16px", borderRadius: 14,
            background: "transparent", border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 700,
            cursor: "pointer",
          }}>{tr("ai_tour.back", lang)}</button>
        )}
        <button onClick={next} style={{
          flex: isFirst ? 1 : 2, padding: "14px 16px", borderRadius: 14,
          background: T.accent, border: "none",
          color: T.accentInk, fontFamily: FONT.sans, fontSize: 14, fontWeight: 800,
          cursor: "pointer", letterSpacing: 0.2,
        }}>
          {isLast ? tr("ai_tour.done", lang) : tr("ai_tour.next", lang)}
        </button>
      </div>
    </div>,
    document.body,
  );
}
