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

import React, { useEffect, useRef, useState } from "react";
import { AnimatedLogoMark, playIntroSound } from "./SamasLogo.jsx";

// Tightened from ~2.7s to ~1.6s total. Boot already costs ~10s on
// cold launch (WebView + WebContent processes), no point making the
// user wait an extra full second just for a logo. Tap anywhere also
// dismisses immediately.
//
// 0.4.83 — re-secuenciado para matchear el visual narrative del fix
// del 0.4.81 (paths simétricas desde el centro): dot aparece PRIMERO,
// strokes radian DESPUÉS hacia afuera, ring pulsa al final. Antes era
// "strokes desde 30ms + dot a los 400ms" — el dot llegaba tarde y los
// strokes ya estaban casi dibujados. Ahora el dot abre la escena.
const TIMINGS = {
  startDot:      30,
  startTrace:    320,
  startRing:     900,
  startFade:     1350,
  done:          1850,
};

export function Intro({ onDone }) {
  const [progress, setProgress] = useState(0);
  const [dotProgress, setDotProgress] = useState(0);
  const [showRing, setShowRing] = useState(false);
  const [fading, setFading] = useState(false);

  // Capture the latest onDone in a ref so we don't have to put it in
  // the effect's dependency array. Caller is App.jsx where `dismissIntro`
  // is a fresh function reference on every render — without the ref +
  // empty deps, every parent re-render during the 1.7s intro would
  // tear down + re-run the effect, replaying the sound each time
  // (which is exactly what was happening: 3× sound on cold launch).
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  // Strict-mode + cold-mount guard: even with empty deps, React's
  // dev-mode StrictMode will invoke an effect twice. We track whether
  // the sound has been played in this Intro instance and short-circuit.
  const playedSoundRef = useRef(false);

  useEffect(() => {
    const timers = [];

    // Try to play the audio early — if the WebView's autoplay policy
    // blocks it we silently no-op. iOS WebView typically allows it
    // after the first user gesture (PIN entry counts).
    timers.push(setTimeout(() => {
      if (playedSoundRef.current) return;
      playedSoundRef.current = true;
      playIntroSound();
    }, TIMINGS.startTrace));

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
    timers.push(setTimeout(() => { onDoneRef.current?.(); }, TIMINGS.done));

    return () => timers.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- onDone via ref

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
