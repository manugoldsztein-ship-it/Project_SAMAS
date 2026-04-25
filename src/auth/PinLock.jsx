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
  useEffect(() => { ref.current?.focus(); }, []);
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
          position: "absolute",
          opacity: 0,
          pointerEvents: "none",
          width: 1, height: 1,
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
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, boxSizing: "border-box",
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
