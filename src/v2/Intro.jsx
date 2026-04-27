// ============================================================
// SAMAS — Intro animation (cold-launch splash)
// ============================================================
// Full-screen overlay shown once per session (sessionStorage flag).
// Drives:
//   - Stroke-trace progress 0→1 over ~1100ms
//   - Dot scale-in starting at 600ms
//   - Optional ring pulse at ~1100ms
//   - WebAudio whoosh (0→1.0s) + chime at 1.1s
// After ~2300ms total it fades out and calls onDone().
//
// Background matches the SAMAS dark navy from the reference HTML so
// the brand mark reads cleanly against it.
// ============================================================

import React, { useEffect, useState } from "react";
import { AnimatedLogoMark, playIntroSound } from "./SamasLogo.jsx";

// Tightened from ~2.7s to ~1.6s total. Boot already costs ~10s on
// cold launch (WebView + WebContent processes), no point making the
// user wait an extra full second just for a logo. Tap anywhere also
// dismisses immediately.
const TIMINGS = {
  startTrace:    30,
  startDot:      400,
  startRing:     750,
  startFade:     1200,
  done:          1700,
};

export function Intro({ onDone }) {
  const [progress, setProgress] = useState(0);
  const [dotProgress, setDotProgress] = useState(0);
  const [showRing, setShowRing] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const timers = [];

    // Try to play the audio early — if the WebView's autoplay policy
    // blocks it we silently no-op. iOS WebView typically allows it
    // after the first user gesture (PIN entry counts).
    timers.push(setTimeout(() => playIntroSound(), TIMINGS.startTrace));

    // Kick off the stroke-trace immediately. The CSS transition on
    // stroke-dashoffset handles the actual animation; we just flip
    // progress 0 → 1 once.
    timers.push(setTimeout(() => setProgress(1), TIMINGS.startTrace));

    // Dot scales in mid-trace.
    timers.push(setTimeout(() => setDotProgress(1), TIMINGS.startDot));

    // Ring pulse hits when the mark is fully drawn.
    timers.push(setTimeout(() => setShowRing(true), TIMINGS.startRing));

    // Begin fade-out → unmount.
    timers.push(setTimeout(() => setFading(true), TIMINGS.startFade));
    timers.push(setTimeout(() => { if (onDone) onDone(); }, TIMINGS.done));

    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  // Tap-to-skip: if the user has seen this animation a thousand times,
  // they don't need 1.6s every cold launch. One tap dismisses.
  const skip = () => {
    setFading(true);
    setTimeout(() => { if (onDone) onDone(); }, 350);
  };

  return (
    <div
      onClick={skip}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Radial gradient evoking the reference HTML's bg-navy variant:
        //   radial-gradient(120% 80% at 50% 50%, #1A2233 0%, #0A0E17 100%)
        background: "radial-gradient(120% 80% at 50% 50%, #1A2233 0%, #0A0E17 100%)",
        opacity: fading ? 0 : 1,
        transform: fading ? "scale(1.04)" : "scale(1)",
        transition: "opacity 350ms ease, transform 500ms cubic-bezier(.7,0,.3,1)",
        pointerEvents: fading ? "none" : "auto",
        cursor: "pointer",
      }}
    >
      <AnimatedLogoMark
        size={280}
        strokeColor="#F5F1EA"
        dotColor="#22C55E"
        progress={progress}
        dotProgress={dotProgress}
        showRing={showRing}
        drawDuration={1100}
      />
    </div>
  );
}
