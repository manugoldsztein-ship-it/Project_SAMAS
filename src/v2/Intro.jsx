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

const TIMINGS = {
  startTrace:    50,    // tiny delay so the initial paint registers
  startDot:      600,   // dot scales in while the strokes are still drawing
  startRing:     1100,  // ring pulse fires when the mark is fully drawn
  startFade:     2000,  // begin fade-out
  done:          2700,  // unmount / call onDone
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

  return (
    <div
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
        transition: "opacity 600ms ease, transform 700ms cubic-bezier(.7,0,.3,1)",
        pointerEvents: fading ? "none" : "auto",
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
