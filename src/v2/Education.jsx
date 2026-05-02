// ============================================================
// Education — Wallet front-page card linking to Tutorials hub
// ============================================================
// samas-0.4.35: Cocos-clone Lite needs Education in primera plana
// per Rolan's spec. This card shows the user's progress (XP +
// streak + completed/total) and a CTA to open the Duolingo-style
// TutorialsHub.
//
// Visible to all users (Lite and Pro). The TutorialsHub itself is
// also reachable from Settings → Tutorials, but having a card on
// Wallet makes it discoverable immediately.
// ============================================================

import React, { useEffect, useState } from "react";
import { FONT } from "./theme.js";
import { t as tr } from "../lib/i18n.js";
import { hapticNative } from "../lib/native.js";
import { TUTORIALS } from "./tutorialsData.js";
import { getEducationStats } from "../lib/education.js";

export function EducationCard({ T, lang = "es", onOpen }) {
  const [stats, setStats] = useState(() => getEducationStats(TUTORIALS));

  // Re-read stats when window regains focus (so progress made
  // inside the TutorialsHub reflects when the user backs out).
  useEffect(() => {
    const refresh = () => setStats(getEducationStats(TUTORIALS));
    window.addEventListener("focus", refresh);
    window.addEventListener("samas:tutorial-completed", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("samas:tutorial-completed", refresh);
    };
  }, []);

  const isFresh = stats.completed === 0;

  return (
    <div style={{ margin: "20px 16px 0" }}>
      <div style={{
        fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
        color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
        marginBottom: 8, padding: "0 4px",
      }}>{tr("education.section.title", lang)}</div>
      <button
        onClick={() => { hapticNative("tap").catch(() => {}); onOpen && onOpen(); }}
        style={{
          width: "100%", padding: 16, borderRadius: 22,
          // samas-0.4.36: switched from ${T.accent}22 (8-digit hex
          // alpha) to T.accentSoft, which is the canonical soft-
          // accent color in the theme. The 8-digit hex was rendering
          // washed-out on iOS WKWebView and breaking text contrast
          // (Manuel reported via screenshot). Matches FCI card style.
          background: `linear-gradient(135deg, ${T.accentSoft} 0%, ${T.surface} 80%)`,
          border: `1px solid ${T.accent}55`,
          display: "flex", alignItems: "center", gap: 14,
          cursor: "pointer", textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        {/* Big book glyph in accent */}
        <div style={{
          width: 52, height: 52, borderRadius: 14, flexShrink: 0,
          background: T.accent, color: T.accentInk,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 26,
        }}>📚</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: FONT.sans, fontSize: 14, fontWeight: 800, color: T.text, marginBottom: 4,
          }}>
            {isFresh
              ? tr("education.cta.fresh_title", lang)
              : tr("education.cta.continue_title", lang)}
          </div>
          {isFresh ? (
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.4,
            }}>{tr("education.cta.fresh_sub", lang)}</div>
          ) : (
            <>
              {/* Progress bar */}
              <div style={{
                marginTop: 2, marginBottom: 6,
                height: 6, borderRadius: 3,
                background: T.bg, overflow: "hidden",
              }}>
                <div style={{
                  width: `${stats.pct}%`, height: "100%",
                  background: T.accent, transition: "width 200ms",
                }}/>
              </div>
              {/* Stats line */}
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                fontFamily: FONT.mono, fontSize: 11, color: T.textMute,
                fontVariantNumeric: "tabular-nums",
              }}>
                <span style={{ color: T.text, fontWeight: 700 }}>
                  {stats.completed}/{stats.total}
                </span>
                <span>·</span>
                <span>⭐ {stats.totalXp} XP</span>
                {stats.streakCurrent > 0 && (
                  <>
                    <span>·</span>
                    <span style={{ color: "#F59E0B", fontWeight: 700 }}>
                      🔥 {stats.streakCurrent}
                    </span>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
    </div>
  );
}
