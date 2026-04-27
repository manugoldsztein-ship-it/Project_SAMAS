// ============================================================
// SAMAS v2 — Onboarding (3 slides shown on first launch)
// ============================================================
// Stored as samas_v2_onboarded=true in localStorage. The shell
// short-circuits to <Onboarding/> when the flag is missing. After
// "Empezar" the flag is set and we never show this again.
// ============================================================

import React, { useState } from "react";
import { FONT } from "./theme.js";
import { Ico } from "./icons.jsx";

const SLIDES = [
  {
    icon: <Ico.Wallet size={48}/>,
    title: "Tu wallet en pesos y dólares",
    body: "Cargá saldo desde MercadoPago, transferencia o cripto. Manejá ARS y USD desde el mismo lugar, con tipo de cambio MEP en vivo.",
    accent: "#16C784",
  },
  {
    icon: <Ico.Chart size={48}/>,
    title: "Invertí desde la app",
    body: "Comprá CEDEARs, ETFs, bonos y cripto. Configurá alertas de precio y stop-loss por activo. Tu portafolio, distribución y top movers — todo en un solo lugar.",
    accent: "#7C3AED",
  },
  {
    icon: (
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor"/>
      </svg>
    ),
    title: "Plan personalizado con IA",
    body: "Decinos tu objetivo y horizonte. La IA clasifica tu perfil (conservador / moderado / agresivo) y te arma una asignación sugerida adaptada al mercado argentino.",
    accent: "#0EA5E9",
  },
];

export function Onboarding({ T, isNativeApp = false, onDone }) {
  const [step, setStep] = useState(0);
  const slide = SLIDES[step];
  const last = step === SLIDES.length - 1;

  function done() {
    try { localStorage.setItem("samas_v2_onboarded", "true"); } catch {}
    onDone();
  }

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: T.bg, color: T.text,
      display: "flex", flexDirection: "column",
      paddingTop: isNativeApp ? "calc(env(safe-area-inset-top) + 24px)" : 24,
      paddingBottom: isNativeApp ? "calc(env(safe-area-inset-bottom) + 24px)" : 24,
      paddingLeft: 24, paddingRight: 24,
    }}>
      {/* Skip */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={done} style={{
          background: "transparent", border: "none",
          color: T.textMute, fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
          cursor: "pointer", padding: 6,
        }}>Saltar</button>
      </div>

      {/* Slide */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", textAlign: "center",
        gap: 24,
      }}>
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
          }}>{slide.title}</div>
          <div style={{
            fontFamily: FONT.sans, fontSize: 15, color: T.textMute,
            lineHeight: 1.5, maxWidth: 380, margin: "0 auto",
          }}>{slide.body}</div>
        </div>
      </div>

      {/* Dots */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 18 }}>
        {SLIDES.map((_, i) => (
          <div key={i} style={{
            width: i === step ? 22 : 8, height: 8, borderRadius: 4,
            background: i === step ? T.accent : T.border,
            transition: "width 0.18s ease, background 0.18s ease",
          }}/>
        ))}
      </div>

      {/* Nav buttons */}
      <div style={{ display: "flex", gap: 10 }}>
        {step > 0 && (
          <button onClick={() => setStep((s) => s - 1)} style={{
            flex: 1, padding: 16, borderRadius: 14,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}>Atrás</button>
        )}
        <button
          onClick={() => last ? done() : setStep((s) => s + 1)}
          style={{
            flex: 2, padding: 16, borderRadius: 14,
            background: T.accent, color: T.accentInk,
            fontFamily: FONT.sans, fontSize: 15, fontWeight: 700, border: "none", cursor: "pointer",
          }}
        >{last ? "Empezar" : "Siguiente"}</button>
      </div>
    </div>
  );
}
