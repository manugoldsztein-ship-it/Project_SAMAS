// ============================================================
// WELCOME / UI MODE CHOOSER
// ============================================================
// Shown once, right after the user finishes the auth + PIN flow
// for the first time. They pick between:
//
//   - "principiante": the guided experience — educational
//     tooltips visible by default, simpler forms, advanced
//     surfaces hidden, plain-language explanations.
//
//   - "profesional": the dense experience — every feature
//     unlocked, technical terms, keyboard shortcuts, minimal
//     hand-holding.
//
// Saves to public.profiles.ui_mode. Changeable later from
// Settings; this screen only fires when ui_mode is null.
// ============================================================

import { useState } from "react";
import { supabase } from "../lib/supabase";

export function WelcomeChooser({ C, userId, onDone }) {
  const [selected, setSelected] = useState(null); // "principiante" | "profesional"
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase
      .from("profiles")
      .update({ ui_mode: selected, updated_at: new Date().toISOString() })
      .eq("id", userId);
    setBusy(false);
    if (error) {
      console.error("[welcome] profile update error:", error);
      setErr(error.message || "No pudimos guardar tu elección. Reintentá.");
      return;
    }
    onDone(selected);
  }

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 85,
      background: C.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, boxSizing: "border-box",
      overflowY: "auto",
    }}>
      <div style={{
        width: "100%", maxWidth: 380,
        display: "flex", flexDirection: "column", gap: 18,
      }}>
        {/* Brand + intro */}
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: C.accent + "22", color: C.accent, fontSize: 20, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>S</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: 2 }}>SAMAS</div>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: C.text, margin: 0, marginBottom: 6 }}>Bienvenido</h1>
          <div style={{ fontSize: 13, color: C.textMd, lineHeight: 1.5 }}>
            ¿Cómo preferís usar SAMAS? Podés cambiarlo después desde Ajustes.
          </div>
        </div>

        {/* Options */}
        <OptionCard
          C={C}
          selected={selected === "principiante"}
          onClick={() => setSelected("principiante")}
          icon={<SproutIcon />}
          title="Recién empiezo"
          subtitle="Más guiada, con explicaciones de cada término. Menos datos en pantalla para no abrumar."
          bullets={[
            "Términos financieros con ayuda visible",
            "Flujos simplificados",
            "Explicaciones en lenguaje llano",
          ]}
        />
        <OptionCard
          C={C}
          selected={selected === "profesional"}
          onClick={() => setSelected("profesional")}
          icon={<ChartIcon />}
          title="Invierto hace un tiempo"
          subtitle="Todos los datos a mano, terminología técnica, herramientas avanzadas activadas."
          bullets={[
            "Ratios técnicos (TIR, duration, paridad)",
            "Rebalanceo, shock test, what-if",
            "Atajos de teclado",
          ]}
        />

        {err && (
          <div style={{ background: C.red + "18", border: "1px solid " + C.red + "55", color: C.red, borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 600 }}>
            {err}
          </div>
        )}

        <button
          onClick={confirm}
          disabled={!selected || busy}
          style={{
            background: (!selected || busy) ? C.creamDk : C.accent,
            color: (!selected || busy) ? C.textMd : "#fff",
            border: "none",
            borderRadius: 12,
            padding: "14px",
            fontSize: 14,
            fontWeight: 800,
            cursor: (!selected || busy) ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            width: "100%",
            boxSizing: "border-box",
            marginTop: 4,
          }}
        >
          {busy ? "Guardando…" : selected ? "Continuar" : "Elegí una opción"}
        </button>

        <div style={{ fontSize: 10, color: C.textLt, textAlign: "center", lineHeight: 1.5 }}>
          No hay respuesta incorrecta — esto solo ajusta cuánta información te mostramos por default.
        </div>
      </div>
    </div>
  );
}

function OptionCard({ C, selected, onClick, icon, title, subtitle, bullets }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: selected ? C.accent + "14" : C.card,
        border: "2px solid " + (selected ? C.accent : C.border),
        borderRadius: 16,
        padding: "16px 18px",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        transition: "all 150ms",
        display: "flex", flexDirection: "column", gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12,
          background: selected ? C.accent + "26" : C.creamDk,
          color: selected ? C.accent : C.textMd,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 2 }}>{title}</div>
          <div style={{ fontSize: 11, color: C.textMd, lineHeight: 1.4 }}>{subtitle}</div>
        </div>
        {/* Selection indicator */}
        <div style={{
          width: 20, height: 20, borderRadius: 10,
          border: "2px solid " + (selected ? C.accent : C.border),
          background: selected ? C.accent : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          {selected && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          )}
        </div>
      </div>
      <ul style={{ margin: 0, padding: 0, paddingLeft: 54, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
        {bullets.map((b, i) => (
          <li key={i} style={{ fontSize: 11, color: C.textMd, display: "flex", alignItems: "flex-start", gap: 6 }}>
            <span style={{ color: selected ? C.accent : C.textLt, marginTop: 2 }}>•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}

function SproutIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 20h10"/>
      <path d="M12 20V10"/>
      <path d="M12 10a5 5 0 0 0 5-5 5 5 0 0 0-5 5z"/>
      <path d="M12 10a5 5 0 0 1-5-5 5 5 0 0 1 5 5z"/>
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
      <line x1="3" y1="20" x2="21" y2="20"/>
    </svg>
  );
}
