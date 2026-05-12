// ============================================================
// PIN LOCK — second-factor gate on every app open
// ============================================================
// The user has a real Supabase session, but before the main app
// shows we ask for a 4-digit PIN. Brubank / Ualá pattern.
//
// Storage: profiles.pin_hash in the database (not localStorage).
// This means the PIN works across all the user's devices — set it
// once on iPhone, use the same one on the web. RLS restricts the
// hash to the owner's own row so nobody else can read it.
//
// On "create" flow: pick + confirm 4 digits → hash → UPDATE profiles.
// On "enter"  flow: hash submitted digits → compare with profile row.
//
// pinUnlocked (the flag that lets the main app render) lives in
// memory only — so re-opening the app on a fresh tab still prompts
// for the PIN even if the session is still valid.
// ============================================================

import { useEffect, useRef, useState } from "react";
import {
  isBiometricAvailable, authenticateWithBiometric, isBiometricEnabled,
} from "../lib/biometric.js";

// Clean up any PIN hashes from the old device-local scheme. Harmless
// to re-run — if the keys don't exist, nothing happens.
try {
  if (typeof localStorage !== "undefined") {
    const toDrop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k === "samas_pin_hash" || k.startsWith("samas_pin_hash_"))) {
        toDrop.push(k);
      }
    }
    toDrop.forEach((k) => localStorage.removeItem(k));
  }
} catch {}

export async function hashPin(pin) {
  const bytes = new TextEncoder().encode("samas-pin:" + pin);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ----- UI -----
function Dot({ filled, C }) {
  return (
    <div style={{
      width: 18, height: 18, borderRadius: 9,
      background: filled ? C.accent : "transparent",
      border: "2px solid " + (filled ? C.accent : C.border),
      transition: "all 150ms",
    }} />
  );
}

function Pad({ C, value, onChange, error }) {
  const ref = useRef(null);
  // No auto-focus on mount: iOS would surface the keyboard immediately
  // every time the PIN screen appears, which feels aggressive (the user
  // just finished a login flow and gets a keyboard punched at them).
  // The user can tap anywhere on the dots area to focus and start
  // typing — handled by the onClick on the wrapper div below.
  return (
    <div
      onClick={() => ref.current?.focus()}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, cursor: "text" }}
    >
      <input
        ref={ref}
        type="password"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={value}
        maxLength={4}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/\D/g, "").slice(0, 4);
          onChange(cleaned);
        }}
        style={{
          // Hidden input that captures keystrokes — the visible UI is
          // the dots above. We push it off-screen AND make the caret
          // transparent because iOS sometimes leaks a 1-pixel blue
          // blinking caret through opacity:0 inputs.
          position: "absolute",
          opacity: 0,
          pointerEvents: "none",
          width: 1, height: 1,
          caretColor: "transparent",
          color: "transparent",
          left: -9999,
          top: -9999,
        }}
      />
      <div
        className={error ? "samas-shake" : ""}
        style={{ display: "flex", gap: 18 }}
      >
        {[0, 1, 2, 3].map((i) => <Dot key={i} filled={i < value.length} C={C} />)}
      </div>
    </div>
  );
}

// ----- Main component -----
// Props:
//   storedPinHash: current pin_hash from profiles (null if not yet set)
//   onSavePin(plainPin): callback that hashes + writes to DB + refetches
//   onSuccess(): signal that unlock succeeded; parent sets pinUnlocked
//   onForgot(): "forgot PIN" -- parent typically does signOut
//   userEmail: cosmetic (shown in enter mode)
export function PinLockScreen({ C, storedPinHash, onSavePin, onSuccess, onForgot, userEmail }) {
  const mode = storedPinHash ? "enter" : "create";
  const [stage, setStage] = useState(mode === "create" ? "pick" : "enter");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [biometricType, setBiometricType] = useState("none"); // "face" | "fingerprint" | "iris" | "none"

  // On mount in enter mode, detect biometric type AND auto-trigger
  // the Face ID prompt if it's enabled.
  //
  // 0.4.79 — Manuel pidió que el auto-trigger vuelva. Lo había sacado
  // en 0.4.70 pero terminó siendo una regresión: el flujo más rápido
  // es Face ID instantáneo al abrir la app. Si falla / el user cancela,
  // cae al PIN pad sin loops.
  const triedBioRef = useRef(false);
  useEffect(() => {
    if (mode !== "enter") return;
    if (triedBioRef.current) return;
    let alive = true;
    (async () => {
      const type = await isBiometricAvailable();
      if (!alive) return;
      setBiometricType(type);
      if (type === "none" || !isBiometricEnabled()) return;
      triedBioRef.current = true;
      try {
        const ok = await authenticateWithBiometric("Desbloqueá SAMAS");
        if (alive && ok) onSuccess();
      } catch (_) {
        // Cae al PIN pad silenciosamente.
      }
    })();
    return () => { alive = false; };
  }, [mode]);

  // Manual re-trigger (the "Usar Face ID" button below the dots).
  async function tryBiometric() {
    try {
      const ok = await authenticateWithBiometric("Desbloqueá SAMAS");
      if (ok) onSuccess();
    } catch (_) {}
  }

  useEffect(() => {
    if (pin.length !== 4) return;
    if (busy) return;

    (async () => {
      setBusy(true);
      if (stage === "pick") {
        setFirstPin(pin);
        setPin("");
        setStage("confirm");
        setBusy(false);
      } else if (stage === "confirm") {
        if (pin !== firstPin) {
          setErr("Los PINs no coinciden. Arrancá de nuevo.");
          setPin("");
          setFirstPin("");
          setStage("pick");
          setTimeout(() => setErr(null), 2000);
          setBusy(false);
          return;
        }
        try {
          await onSavePin(pin);
          setBusy(false);
          onSuccess();
        } catch (e) {
          console.error("[pin] save failed:", e);
          setErr("No pudimos guardar el PIN. Revisá tu conexión e intentá de nuevo.");
          setPin("");
          setFirstPin("");
          setStage("pick");
          setTimeout(() => setErr(null), 2500);
          setBusy(false);
        }
      } else if (stage === "enter") {
        const submittedHash = await hashPin(pin);
        if (submittedHash === storedPinHash) {
          setBusy(false);
          onSuccess();
        } else {
          setErr("PIN incorrecto");
          setPin("");
          setTimeout(() => setErr(null), 1600);
          setBusy(false);
        }
      }
    })();
  }, [pin, stage]);

  const title =
    stage === "pick"    ? "Creá tu PIN" :
    stage === "confirm" ? "Confirmá tu PIN" :
                          "Desbloqueá SAMAS";
  const subtitle =
    stage === "pick"    ? "4 dígitos para entrar rápido cada vez que abrís la app y confirmar operaciones." :
    stage === "confirm" ? "Escribí el mismo PIN otra vez." :
                          userEmail ? `Conectado como ${userEmail}` : "Ingresá tu PIN de 4 dígitos.";

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 90,
      background: C.bg,
      // 0.4.79 — content top-anchored en vez de center, con padding-top
      // generoso pero no tanto que deje un "black box" de vacío arriba.
      // Manuel se quejó del void cuando el auto-trigger del Face ID no
      // pintaba el iOS prompt arriba. Ahora el SAMAS logo aparece a
      // ~22% del top en vez de a la mitad.
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "flex-start",
      paddingTop: "calc(env(safe-area-inset-top) + 22vh)",
      paddingLeft: 24, paddingRight: 24,
      paddingBottom: 24,
      boxSizing: "border-box",
    }}>
      <div style={{
        width: "100%", maxWidth: 340,
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 28,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: C.accent + "22", color: C.accent, fontSize: 20, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>S</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: 2 }}>SAMAS</div>
        </div>

        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: 0, marginBottom: 6 }}>{title}</h1>
          <div style={{ fontSize: 12, color: C.textMd, lineHeight: 1.5, maxWidth: 280 }}>{subtitle}</div>
        </div>

        <Pad C={C} value={pin} onChange={setPin} error={!!err} />

        <div style={{
          minHeight: 18,
          fontSize: 12, fontWeight: 700,
          color: err ? C.red : "transparent",
          transition: "color 150ms",
          textAlign: "center",
          maxWidth: 280,
          lineHeight: 1.4,
        }}>
          {err || "·"}
        </div>

        {/* Face ID / Touch ID quick-action — only in enter mode, only
            when the device supports it AND the user has it enabled. */}
        {stage === "enter" && biometricType !== "none" && isBiometricEnabled() && (
          <button
            onClick={tryBiometric}
            style={{
              background: C.accent + "18", border: `1px solid ${C.accent}55`,
              borderRadius: 999, padding: "8px 16px",
              color: C.accent, fontSize: 12, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {biometricType === "face" ? (
                <>
                  <rect x="3" y="3" width="18" height="18" rx="3"/>
                  <path d="M9 9h.01M15 9h.01M9 15c.5.5 1.5 1 3 1s2.5-.5 3-1"/>
                </>
              ) : (
                <>
                  <path d="M2 12c0-5.5 4.5-10 10-10s10 4.5 10 10"/>
                  <path d="M6 12a6 6 0 0 1 12 0v4"/>
                  <path d="M10 12v4a2 2 0 1 0 4 0"/>
                </>
              )}
            </svg>
            Usar {biometricType === "face" ? "Face ID" : "Touch ID"}
          </button>
        )}

        {stage === "enter" && (
          <button
            onClick={onForgot}
            style={{
              background: "transparent", border: "none",
              color: C.textMd, fontSize: 11, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
              textDecoration: "underline",
            }}
          >
            ¿Olvidaste tu PIN? Cerrá sesión y volvé a entrar.
          </button>
        )}
      </div>
    </div>
  );
}
