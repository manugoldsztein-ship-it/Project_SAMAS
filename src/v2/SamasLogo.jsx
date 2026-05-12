// ============================================================
// SAMAS — Brand mark + intro audio
// ============================================================
// The mark is two open C-shapes stacked into an "S" with a green dot
// in the middle gap. Each C is ~270° of a circle, drawn via SVG arc.
//
//   - Top C:    center (50, 38), radius 22, opens to lower-left.
//   - Bottom C: center (50, 62), radius 22, opens to upper-right.
//   - Dot:      circle r=7 at (50, 50), dotColor.
//
// `<LogoMark/>` (static) is what gets used in chrome (header, splash,
// PinLockScreen, etc.). `<AnimatedLogoMark/>` is the same shape but
// the strokes draw progressively via stroke-dashoffset and the dot
// scales in — used by Intro.jsx for the launch animation.
// ============================================================

import React from "react";

// Pre-computed arc endpoints (rounded). Same numbers as the source mark.
//   top start  = 50 + 22*cos(-10°), 38 + 22*sin(-10°)
//   top end    = 50 + 22*cos( 80°), 38 + 22*sin( 80°)
//   bot start  = 50 + 22*cos(170°), 62 + 22*sin(170°)
//   bot end    = 50 + 22*cos(260°), 62 + 22*sin(260°)
//
// Static rendering: uses the original path directions (no semantic
// difference, only matters for stroke-trace animation).
const TOP_PATH = "M 71.66 34.18 A 22 22 0 1 0 53.82 59.66";
const BOT_PATH = "M 28.34 65.82 A 22 22 0 1 0 46.18 40.34";
// Animated rendering: same arcs but path REVERSED so the stroke
// traces from the center (near the dot) outward to the far endpoints.
// Manuel 0.4.81: "the animation starts at the center and goes to the
// left". Era porque las paths originales se trazaban counter-clockwise
// desde sus extremos lejanos (top: upper-right → mid, bot: lower-left
// → mid), creando una asimetría visual hacia la izquierda. Acá las
// reverseamos: ambos arcos arrancan desde el centro (cerca del dot) y
// se expanden simétricamente hacia afuera. El sweep flag se flipea de
// 0 → 1 para que la curva visible sea la misma.
const TOP_PATH_TRACE = "M 53.82 59.66 A 22 22 0 1 1 71.66 34.18";
const BOT_PATH_TRACE = "M 46.18 40.34 A 22 22 0 1 1 28.34 65.82";
// Arc length ≈ (270/360) * 2π * 22 ≈ 103.7. Use 110 to be safe.
const ARC_LEN = 110;
const STROKE_W = 11;

// ----------------------------------------------------------
// Static logo — for chrome (no animation). `color` paints both arcs;
// `dotColor` paints the green center dot. Default colors match the
// dark theme but pass props on light surfaces.
// ----------------------------------------------------------
export function LogoMark({ size = 28, color = "currentColor", dotColor = "#22C55E" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path
        d={TOP_PATH}
        fill="none" stroke={color} strokeWidth={STROKE_W}
        strokeLinecap="round" strokeLinejoin="round"
      />
      <path
        d={BOT_PATH}
        fill="none" stroke={color} strokeWidth={STROKE_W}
        strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="50" cy="50" r="7" fill={dotColor} />
    </svg>
  );
}

// ----------------------------------------------------------
// Animated logo — controls trace progress (0..1) and dot in-progress
// (0..1) externally. The Intro component drives these over time. The
// strokes draw with a 110-unit dasharray; offset 110→0 reveals.
//
// Trace stages: top draws over progress 0..0.55, bottom over 0.45..1.
// The 0.05 overlap makes the connection feel continuous instead of
// like two separate strokes.
// ----------------------------------------------------------
export function AnimatedLogoMark({
  size = 280,
  strokeColor = "#1A2233",
  dotColor = "#22C55E",
  progress = 1,
  dotProgress = 0,
  showRing = false,
  drawDuration = 1100,
}) {
  // 0.4.81 — antes era top primero (0..0.55) y después bottom (0.45..1),
  // que con paths que trazaban desde los extremos lejanos creaba la
  // sensación de "se mueve a la izquierda". Ahora ambos arcos están
  // sincronizados (mismo progress) Y arrancan desde el centro hacia
  // afuera (TOP_PATH_TRACE + BOT_PATH_TRACE invertidas). El visual:
  // dot aparece → strokes radian simétricamente hacia los dos extremos.
  const traceProg = Math.max(0, Math.min(1, progress));

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        <filter id="samas-dot-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path
        d={TOP_PATH_TRACE}
        fill="none" stroke={strokeColor} strokeWidth={STROKE_W}
        strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={ARC_LEN}
        strokeDashoffset={ARC_LEN * (1 - traceProg)}
        style={{
          transition: `stroke-dashoffset ${drawDuration}ms cubic-bezier(.65,0,.35,1)`,
        }}
      />
      <path
        d={BOT_PATH_TRACE}
        fill="none" stroke={strokeColor} strokeWidth={STROKE_W}
        strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={ARC_LEN}
        strokeDashoffset={ARC_LEN * (1 - traceProg)}
        style={{
          transition: `stroke-dashoffset ${drawDuration}ms cubic-bezier(.65,0,.35,1)`,
        }}
      />

      {showRing && (
        <circle
          cx="50" cy="50" r="9"
          fill="none" stroke={dotColor} strokeWidth="2"
          style={{
            transformOrigin: "50px 50px",
            transformBox: "view-box",
            animation: "samas-ring-pulse 1400ms ease-out 100ms 1 both",
          }}
        />
      )}

      <circle
        cx="50" cy="50" r="7"
        fill={dotColor}
        filter="url(#samas-dot-glow)"
        style={{
          transform: `scale(${dotProgress})`,
          transformOrigin: "50px 50px",
          transformBox: "view-box",
          opacity: dotProgress,
          transition: "transform 520ms cubic-bezier(.34,1.56,.64,1), opacity 320ms ease",
        }}
      />

      <style>{`
        @keyframes samas-ring-pulse {
          0%   { transform: scale(0.6); opacity: 0; }
          20%  { opacity: 0.6; }
          100% { transform: scale(2.4); opacity: 0; }
        }
      `}</style>
    </svg>
  );
}

// ----------------------------------------------------------
// playIntroSound — WebAudio whoosh + chime. No external assets.
// Best-effort: if the AudioContext is blocked by autoplay policy, we
// silently no-op. Browsers (and Capacitor's WebView) typically allow
// audio after the first user interaction; for the launch animation we
// rely on the warm WebView already having had a touch.
// ----------------------------------------------------------
export function playIntroSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    // ----- Whoosh: filtered noise that swells then falls -----
    const bufferSize = ctx.sampleRate * 1.0;
    const noiseBuf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(300, now);
    bp.frequency.exponentialRampToValueAtTime(2200, now + 0.55);
    bp.frequency.exponentialRampToValueAtTime(800, now + 1.0);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.18, now + 0.35);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);

    noise.connect(bp).connect(noiseGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 1.05);

    // ----- Chime: two soft sine tones a fifth apart, on dot-in -----
    const chimeAt = now + 1.1;
    const tone = (freq, t, dur, gainPeak) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gainPeak, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    tone(880, chimeAt, 0.9, 0.10);            // A5
    tone(1318.5, chimeAt + 0.04, 0.9, 0.07);  // E6 (fifth)
    tone(1760, chimeAt + 0.10, 0.7, 0.04);    // A6 sparkle

    // Auto-close to free resources
    setTimeout(() => { try { ctx.close(); } catch (_) {} }, 2400);
  } catch (_) {
    // silently ignore — autoplay policy etc.
  }
}
