// ============================================================
// PIN LOCK — second-factor gate on every app open
// ============================================================
// The user has a real Supabase session, but before the main app
// shows we ask for a 4-digit PIN. This is the Brubank / Ualá
// pattern: session stays valid (no need to re-enter email +
// password), but the app locks on every launch.
//
// First launch after signup/login: "Create PIN" — user picks 4
// digits + confirms. Stored as SHA-256 hash in localStorage.
//
// Subsequent launches: "Enter PIN" — user types 4 digits, we
// hash + compare. On match, session is "unlocked" for the life
// of the tab (pinUnlocked state lives in memory only).
//
// Forgot PIN → fallback to full logout + re-login path.
// ============================================================

import { useEffect, useRef, useState } from "react";

const PIN_HASH_KEY = "samas_pin_hash";

// Hash helper — SHA-256 with a per-app salt prefix. PINs are
// short (10,000 combinations) so the hash isn't much defense
// against a determined attacker with localStorage access, but
// this stops the trivial case of reading the plain PIN from
// devtools. For real security, tie this into Capacitor's secure
// keychain when we wrap the app.
async function hashPin(pin) {
  const bytes = new TextEncoder().encode("samas-pin:" + pin);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hasPinSet() {
  try { return !!localStorage.getItem(PIN_HASH_KEY); } catch { return false; }
}

export async function setPin(pin) {
  const h = await hashPin(pin);
  try { localStorage.setItem(PIN_HASH_KEY, h); } catch {}
}

export async function checkPin(pin) {
  const stored = (() => { try { return localStorage.getItem(PIN_HASH_KEY); } catch { return null; } })();
  if (!stored) return false;
  const h = await hashPin(pin);
  return h === stored;
}

export function clearPin() {
  try { localStorage.removeItem(PIN_HASH_KEY); } catch {}
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
  // Hidden native input captures keystrokes (numeric keyboard on
  // mobile, digits/backspace on desktop). Four visible dots reflect
  // the current length. The input is autofocused so typing works
  // immediately on any device.
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

export function PinLockScreen({ mode, C, onSuccess, onForgot, userEmail }) {
  // mode: "create" or "enter"
  // stage internal: create → "pick" → "confirm" → onSuccess
  //                 enter  → "enter"                → onSuccess
  const [stage, setStage] = useState(mode === "create" ? "pick" : "enter");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // Auto-advance when the user types the 4th digit. For "create" we
  // capture the first pin, then ask for confirm. For "confirm" we
  // check match + save. For "enter" we check against the stored hash.
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
        await setPin_write(pin);
        setBusy(false);
        onSuccess();
      } else if (stage === "enter") {
        const ok = await checkPin(pin);
        if (ok) {
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

  // Title + subtitle by stage
  const title =
    stage === "pick"    ? "Creá tu PIN" :
    stage === "confirm" ? "Confirmá tu PIN" :
                          "Desbloqueá SAMAS";
  const subtitle =
    stage === "pick"    ? "4 dígitos para entrar rápido cada vez que abrís la app." :
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
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: C.accent + "22", color: C.accent, fontSize: 20, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>S</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: 2 }}>SAMAS</div>
        </div>

        {/* Title + subtitle */}
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: 0, marginBottom: 6 }}>{title}</h1>
          <div style={{ fontSize: 12, color: C.textMd, lineHeight: 1.5, maxWidth: 280 }}>{subtitle}</div>
        </div>

        {/* Dots + hidden input */}
        <Pad C={C} value={pin} onChange={setPin} error={!!err} />

        {/* Error */}
        <div style={{
          minHeight: 18,
          fontSize: 12, fontWeight: 700,
          color: err ? C.red : "transparent",
          transition: "color 150ms",
        }}>
          {err || "·"}
        </div>

        {/* Footer action — "Forgot PIN" only in enter mode */}
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

// Aliased wrapper because the exported name `setPin` conflicts with
// the local useState setter `setPin` inside PinLockScreen. Keeps the
// import surface clean for App.jsx while avoiding shadow warnings.
async function setPin_write(v) {
  await setPin(v);
}
