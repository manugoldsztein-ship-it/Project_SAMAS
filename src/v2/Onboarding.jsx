// ============================================================
// SAMAS v2 — Onboarding (4 slides shown on first launch)
// ============================================================
// Stored as samas_v2_onboarded=true in localStorage. The shell
// short-circuits to <Onboarding/> when the flag is missing. After
// "Empezar" the flag is set and we never show this again.
//
// Polished in samas-0.0.62:
//   - All copy now flows through tr() — Spanish / English handled
//     identically; new locales fall back to es per the i18n design.
//   - SamasLogo wordmark renders above every slide so the user
//     learns the brand mark before tapping into the app.
//   - Slide-in animation: when the user advances, the new slide
//     enters from the right (or from the left when going back).
//     Pure CSS keyframe restart via key={step}.
//   - Swipe gesture: drag the slide horizontally and release past
//     a threshold to advance / retreat. Same touch-distance trigger
//     as the post-swipe-to-delete in Social.jsx, just inverted axis.
//   - Tap-to-jump on the page-indicator dots so the user can skim.
//   - Light haptic on every step change + a success haptic on
//     "Empezar". Same Capacitor Haptics wrapper used elsewhere.
// ============================================================

import React, { useState, useRef } from "react";
import { FONT } from "./theme.js";
import { Ico } from "./icons.jsx";
import { LogoMark } from "./SamasLogo.jsx";
import { t as tr } from "../lib/i18n.js";
import { hapticNative } from "../lib/native.js";

// One slide = icon + accent color + i18n keys. Keys point at
// onb.s1.title / onb.s1.body / etc, defined in src/lib/i18n.js.
const SLIDES = [
  {
    titleKey: "onb.s1.title",
    bodyKey:  "onb.s1.body",
    accent:   "#16C784",
    icon:     <Ico.Wallet size={44}/>,
  },
  {
    titleKey: "onb.s2.title",
    bodyKey:  "onb.s2.body",
    accent:   "#7C3AED",
    icon:     <Ico.Chart size={44}/>,
  },
  {
    titleKey: "onb.s3.title",
    bodyKey:  "onb.s3.body",
    accent:   "#3B82F6",
    icon:     <Ico.Users size={44}/>,
  },
  {
    titleKey: "onb.s4.title",
    bodyKey:  "onb.s4.body",
    accent:   "#0EA5E9",
    // Concentric rings for "AI plan" — same as before.
    icon: (
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor"/>
      </svg>
    ),
  },
];

// Drag distance (px) past which a touch release advances or retreats
// the slide. Anything less snaps back. Same threshold as the
// post-swipe-to-delete in Social.jsx for muscle-memory consistency.
const SWIPE_THRESHOLD = 60;

export function Onboarding({ T, isNativeApp = false, onDone, lang = "es" }) {
  const [step, setStep] = useState(0);
  // direction: +1 = next slide came from the right (we just advanced),
  // -1 = it came from the left (we just retreated). Drives which CSS
  // animation runs on the new slide. 0 only on initial mount.
  const [direction, setDirection] = useState(0);
  // Touch drag state. dx: live offset while finger is down. animating:
  // we're between snap-back and the next slide render — disables
  // pointer events briefly so a fast double-swipe doesn't desync.
  const [dx, setDx] = useState(0);
  const startXRef = useRef(null);
  const slide = SLIDES[step];
  const last = step === SLIDES.length - 1;

  function go(nextStep, dir) {
    if (nextStep < 0 || nextStep >= SLIDES.length) return;
    setDirection(dir);
    setStep(nextStep);
    setDx(0);
    hapticNative("tap").catch(() => {});
  }

  function done() {
    try { localStorage.setItem("samas_v2_onboarded", "true"); } catch {}
    hapticNative("success").catch(() => {});
    onDone();
  }

  function onTouchStart(e) {
    startXRef.current = e.touches?.[0]?.clientX ?? null;
  }
  function onTouchMove(e) {
    if (startXRef.current == null) return;
    const x = e.touches?.[0]?.clientX ?? 0;
    setDx(x - startXRef.current);
  }
  function onTouchEnd() {
    if (startXRef.current == null) return;
    const finalDx = dx;
    startXRef.current = null;
    setDx(0);
    if (finalDx <= -SWIPE_THRESHOLD && step < SLIDES.length - 1) {
      go(step + 1, +1);
    } else if (finalDx >= SWIPE_THRESHOLD && step > 0) {
      go(step - 1, -1);
    }
  }

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: T.bg, color: T.text,
      display: "flex", flexDirection: "column",
      paddingTop: isNativeApp ? "calc(env(safe-area-inset-top) + 24px)" : 24,
      paddingBottom: isNativeApp ? "calc(env(safe-area-inset-bottom) + 24px)" : 24,
      paddingLeft: 24, paddingRight: 24,
      overflow: "hidden",
    }}>
      <style>{`
        @keyframes samas-onb-in-right {
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes samas-onb-in-left {
          from { opacity: 0; transform: translateX(-40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* Header — wordmark left, Skip right. The wordmark grounds the
          screen as belonging to SAMAS instead of being a generic
          "swipe-through-3-tips" pattern that any app could ship. */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 12,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          color: T.text,
        }}>
          <LogoMark size={26} color={T.text} dotColor={T.accent}/>
          <span style={{
            fontFamily: FONT.display, fontSize: 16, fontWeight: 700,
            letterSpacing: 1.5, color: T.text,
          }}>SAMAS</span>
        </div>
        <button onClick={done} style={{
          background: "transparent", border: "none",
          color: T.textMute, fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
          cursor: "pointer", padding: 6,
        }}>{tr("onb.skip", lang)}</button>
      </div>

      {/* Slide body — touch surface for the swipe gesture. The whole
          column is the drag target so the user doesn't have to aim. */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          flex: 1,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", textAlign: "center",
          gap: 24,
          // Live drag follows the finger; releases reset to 0. Soft
          // resistance past edges (first or last slide) so the user
          // feels they've hit a wall.
          transform: `translateX(${
            (dx < 0 && step === SLIDES.length - 1) || (dx > 0 && step === 0)
              ? dx * 0.35
              : dx
          }px)`,
          transition: dx === 0 ? "transform 200ms cubic-bezier(.2,.8,.2,1)" : "none",
          touchAction: "pan-y",
        }}
      >
        {/* Re-mount the slide on step change so the in-from-side
            keyframe runs from frame 0 every time. key={step} does it. */}
        <div
          key={step}
          style={{
            display: "flex", flexDirection: "column",
            alignItems: "center", textAlign: "center", gap: 24,
            animation: direction === 0
              ? "samas-onb-in-right 320ms cubic-bezier(.2,.8,.2,1)"
              : direction > 0
                ? "samas-onb-in-right 320ms cubic-bezier(.2,.8,.2,1)"
                : "samas-onb-in-left 320ms cubic-bezier(.2,.8,.2,1)",
          }}
        >
          <div style={{
            width: 96, height: 96, borderRadius: 24,
            background: `${slide.accent}22`, color: slide.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: `1px solid ${slide.accent}55`,
          }}>{slide.icon}</div>
          <div>
            <div style={{
              fontFamily: FONT.display, fontSize: 28, fontWeight: 700, color: T.text,
              letterSpacing: -0.6, lineHeight: 1.2, marginBottom: 12,
            }}>{tr(slide.titleKey, lang)}</div>
            <div style={{
              fontFamily: FONT.sans, fontSize: 15, color: T.textMute,
              lineHeight: 1.5, maxWidth: 380, margin: "0 auto",
            }}>{tr(slide.bodyKey, lang)}</div>
          </div>
        </div>
      </div>

      {/* Page indicator — tap any dot to jump straight to that slide.
          Active dot is a 22px pill, inactive ones are 8px circles.
          Width transition gives a satisfying squeeze when stepping. */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 18 }}>
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => {
              if (i === step) return;
              go(i, i > step ? +1 : -1);
            }}
            aria-label={`Slide ${i + 1}`}
            style={{
              width: i === step ? 22 : 8, height: 8, borderRadius: 4,
              background: i === step ? T.accent : T.border,
              transition: "width 0.18s ease, background 0.18s ease",
              border: "none", padding: 0, cursor: "pointer",
            }}
          />
        ))}
      </div>

      {/* Nav buttons — Atrás visible after the first slide, primary
          CTA always full-width-ish. The CTA label switches to
          "Empezar" on the last slide so the user knows it's the
          end. */}
      <div style={{ display: "flex", gap: 10 }}>
        {step > 0 && (
          <button onClick={() => go(step - 1, -1)} style={{
            flex: 1, padding: 16, borderRadius: 14,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}>{tr("onb.back", lang)}</button>
        )}
        <button
          onClick={() => last ? done() : go(step + 1, +1)}
          style={{
            flex: 2, padding: 16, borderRadius: 14,
            background: T.accent, color: T.accentInk,
            fontFamily: FONT.sans, fontSize: 15, fontWeight: 700, border: "none", cursor: "pointer",
          }}
        >{last ? tr("onb.start", lang) : tr("onb.next", lang)}</button>
      </div>
    </div>
  );
}
