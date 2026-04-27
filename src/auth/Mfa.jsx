// ============================================================
// MFA — Supabase Auth Multi-Factor (TOTP)
// ============================================================
// Two surfaces:
//
//  - <MfaEnrollSection />: lives in Settings. Lets the user enable
//    2FA (shows a QR to scan with Authy / Google Authenticator /
//    1Password, then asks for the first 6-digit code to confirm),
//    or disable an existing factor.
//
//  - <MfaChallengeView />: shown post-password-login when the user
//    already has a verified TOTP factor. Asks for the current
//    6-digit code; on success the session moves from aal1 to aal2.
//
// IMPLEMENTATION NOTE — RAW FETCH, NOT supabase.auth.mfa.*
// ----------------------------------------------------------
// We hit the GoTrue REST endpoints directly. The SDK's
// `supabase.auth.mfa.listFactors/enroll/challenge/verify/unenroll`
// helpers occasionally hang without resolving on this build (same
// SDK-hang we already worked around for `.from().update()` on
// profiles). Raw fetch is reliable and simpler — the GoTrue API is
// stable and the request shapes are documented.
//
// Endpoints used:
//   GET    /auth/v1/factors                       — list factors
//   POST   /auth/v1/factors                       — enroll TOTP
//   POST   /auth/v1/factors/{id}/challenge        — start challenge
//   POST   /auth/v1/factors/{id}/verify           — verify code
//   DELETE /auth/v1/factors/{id}                  — unenroll
// All require Authorization: Bearer <access_token> and apikey.
// ============================================================

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../lib/supabase";

const FRIENDLY_NAME = "SAMAS";
const ISSUER = "SAMAS";

// Build a proper otpauth:// URI with our own issuer (SAMAS) instead of
// the project-default that Supabase falls back to (which on dev shows
// up as "localhost:5173" in Google Authenticator). We have the secret
// from enroll() and the user's email from the session — that's all
// the spec requires.
function buildOtpAuthUri({ secret, accountName, issuer = ISSUER }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------- raw GoTrue helpers ----------
// Read the access_token directly from the SDK's localStorage entry.
// We avoid `supabase.auth.getSession()` because that SDK call hangs
// intermittently on this build (same root cause as the .from().update()
// hang). The localStorage layout is stable across SDK versions.
function projectRef() {
  return (SUPABASE_URL.match(/https:\/\/([^.]+)\./) || [])[1] || "";
}
function sessionStorageKey() {
  const ref = projectRef();
  return ref ? `sb-${ref}-auth-token` : null;
}
function readStoredSession() {
  try {
    const k = sessionStorageKey();
    if (!k || typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function authToken() {
  const stored = readStoredSession();
  return stored?.access_token || null;
}

function authHeaders(token) {
  return {
    "apikey": SUPABASE_PUBLISHABLE_KEY,
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// fetch with a timeout — if the request stalls we want to surface
// the failure to the UI rather than spin forever.
async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function rawListFactors() {
  const token = await authToken();
  if (!token) throw new Error("No hay sesión activa.");
  // GoTrue does NOT have a GET /factors endpoint — the factors are
  // returned as part of GET /user. (The supabase-js listFactors helper
  // just calls getUser() under the hood and reads user.factors.)
  const resp = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: authHeaders(token),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`listFactors ${resp.status}: ${txt}`);
  }
  const user = await resp.json();
  const factors = Array.isArray(user?.factors) ? user.factors : [];
  return { totp: factors.filter((f) => f.factor_type === "totp") };
}

async function rawEnrollTotp(friendlyName) {
  const token = await authToken();
  if (!token) throw new Error("No hay sesión activa.");
  const resp = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/factors`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      factor_type: "totp",
      friendly_name: friendlyName,
      issuer: "SAMAS",
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`enroll ${resp.status}: ${txt}`);
  }
  const json = await resp.json();
  // Response shape: { id, type, totp: { qr_code, secret, uri } }
  return {
    id: json.id,
    qr_code: json?.totp?.qr_code,
    secret: json?.totp?.secret,
    uri: json?.totp?.uri,
  };
}

async function rawChallenge(factorId) {
  const token = await authToken();
  if (!token) throw new Error("No hay sesión activa.");
  const resp = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/factors/${factorId}/challenge`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({}),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`challenge ${resp.status}: ${txt}`);
  }
  const json = await resp.json();
  return json.id; // challenge_id
}

async function rawVerify(factorId, challengeId, code) {
  const token = await authToken();
  if (!token) throw new Error("No hay sesión activa.");
  const resp = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/factors/${factorId}/verify`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ challenge_id: challengeId, code }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    let msg = txt;
    try { msg = JSON.parse(txt)?.error_description || JSON.parse(txt)?.msg || txt; } catch {}
    throw new Error(msg || `verify ${resp.status}`);
  }
  const json = await resp.json();
  // Verify returns new tokens. Push them into the SDK's localStorage
  // entry directly — bypassing supabase.auth.setSession() because that
  // SDK call hangs intermittently on this build (same root cause as the
  // other SDK hangs we worked around). Writing localStorage is sync and
  // can't hang. Caller is expected to reload or manually re-bootstrap
  // the session afterwards.
  if (json?.access_token && json?.refresh_token) {
    try {
      const k = sessionStorageKey();
      if (k && typeof localStorage !== "undefined") {
        const existing = readStoredSession() || {};
        const next = {
          ...existing,
          access_token: json.access_token,
          refresh_token: json.refresh_token,
          expires_at: json.expires_at,
          expires_in: json.expires_in,
          token_type: json.token_type,
          user: json.user || existing.user,
        };
        localStorage.setItem(k, JSON.stringify(next));
      }
    } catch (e) {
      console.warn("[mfa] localStorage write failed:", e);
    }
  }
  return json;
}

async function rawUnenroll(factorId) {
  const token = await authToken();
  if (!token) throw new Error("No hay sesión activa.");
  const resp = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/factors/${factorId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!resp.ok && resp.status !== 404) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`unenroll ${resp.status}: ${txt}`);
  }
  return true;
}

// Generate a QR code from our own otpauth:// URI. We don't use the
// QR returned by Supabase because their issuer falls back to the
// project's SITE_URL (which on dev shows as "localhost:5173" in
// Google Authenticator). Building the URI ourselves with issuer="SAMAS"
// is one line of spec-compliant work.
function QrCode({ uri, size = 200 }) {
  const [svg, setSvg] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!uri) return;
    QRCode.toString(uri, { type: "svg", margin: 1, width: size })
      .then((s) => { if (alive) setSvg(s); })
      .catch((e) => console.error("[mfa] QR generation failed:", e));
    return () => { alive = false; };
  }, [uri, size]);
  if (!svg) {
    return <div style={{ width: size, height: size, background: "#fff", borderRadius: 12 }} />;
  }
  return (
    <div
      style={{ width: size, height: size, background: "#fff", borderRadius: 12, padding: 8, display: "flex", alignItems: "center", justifyContent: "center" }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// Inline 6-digit code input — splits into 6 boxes for visual clarity.
// Includes a "Pegar" button that reads the clipboard so the user can
// copy from Authenticator and not have to alt-tab back to read each
// digit manually.
function CodeInput({ C, value, onChange, error, disabled }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const digits = (text || "").replace(/\D/g, "").slice(0, 6);
      if (digits) onChange(digits);
      ref.current?.focus();
    } catch (_) {
      // iOS WebView may block clipboard access if the page didn't get
      // a recent user gesture. The button click counts, but be safe.
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div onClick={() => ref.current?.focus()} style={{ display: "flex", justifyContent: "center", gap: 6, cursor: "text" }}>
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={value}
          disabled={!!disabled}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onPaste={(e) => {
            // Make sure pasted strings get sanitized exactly the same
            // way as typed digits. The default would set the raw text.
            const text = (e.clipboardData || window.clipboardData)?.getData("text") || "";
            const digits = text.replace(/\D/g, "").slice(0, 6);
            if (digits) {
              e.preventDefault();
              onChange(digits);
            }
          }}
          style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1, caretColor: "transparent" }}
        />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          style={{
            width: 32, height: 40,
            border: "1.5px solid " + (error ? C.red : value.length === i ? C.accent : C.border),
            background: C.card,
            borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 800,
            color: C.text,
            fontFamily: "monospace",
            transition: "border-color 100ms",
          }}
        >
          {value[i] || ""}
        </div>
      ))}
      </div>

      {/* Paste-from-clipboard button so the user doesn't need to
          alt-tab back to Authenticator and read each digit. */}
      <button
        type="button"
        onClick={pasteFromClipboard}
        disabled={!!disabled}
        style={{
          padding: "6px 12px", borderRadius: 999,
          background: "transparent",
          border: "1px solid " + C.border,
          color: C.textMd,
          fontFamily: "inherit", fontSize: 11, fontWeight: 600,
          cursor: disabled ? "default" : "pointer",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Pegar código
      </button>
    </div>
  );
}

// ============================================================
// Settings: Enroll / Unenroll
// ============================================================
export function MfaEnrollSection({ C }) {
  // factor states:
  //   "loading"   — fetching listFactors
  //   "off"       — no verified TOTP, ready to enroll
  //   "enrolling" — enroll() returned a QR but the code hasn't been
  //                 verified yet. The factor exists in DB but is
  //                 'unverified' until verify() succeeds.
  //   "on"        — a verified TOTP factor exists
  const [state, setState] = useState("loading");
  const [factor, setFactor] = useState(null);   // verified factor row when state=on
  const [enroll, setEnroll] = useState(null);   // { id, qr_code, secret, uri } when enrolling
  const [accountName, setAccountName] = useState(""); // user email — for the QR label
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function load() {
    setState("loading");
    setErr(null);
    try {
      // Capture the user's email for the QR label. Read directly from
      // the SDK's localStorage entry — `supabase.auth.getUser()` is the
      // same SDK family that hangs on this build (root cause of every
      // workaround in this file).
      const stored = readStoredSession();
      setAccountName(stored?.user?.email || "SAMAS user");
      const data = await rawListFactors();
      const totps = data?.totp || [];
      const verified = totps.find((f) => f.status === "verified");
      const unverified = totps.find((f) => f.status === "unverified");
      if (verified) {
        setFactor(verified);
        setState("on");
        return;
      }
      if (unverified) {
        // Pre-existing unverified factor — drop it so the next enroll
        // starts cleanly. (GoTrue rejects new TOTP enrolls if any
        // unverified ones exist.)
        await rawUnenroll(unverified.id).catch(() => {});
      }
      setFactor(null);
      setState("off");
    } catch (e) {
      console.error("[mfa] listFactors failed:", e);
      setErr(e.message || "No pudimos consultar el estado de 2FA.");
      setState("off");
    }
  }

  useEffect(() => { load(); }, []);

  async function startEnroll() {
    setBusy(true);
    setErr(null);
    try {
      // Clear any leftover unverified factors first — GoTrue refuses
      // to enroll a second TOTP if one is already in unverified state.
      try {
        const existing = await rawListFactors();
        const stale = (existing?.totp || []).filter((f) => f.status !== "verified");
        for (const f of stale) await rawUnenroll(f.id).catch(() => {});
      } catch {}
      const data = await rawEnrollTotp(FRIENDLY_NAME + "-" + Date.now());
      setEnroll(data);
      setCode("");
      setState("enrolling");
    } catch (e) {
      console.error("[mfa] enroll failed:", e);
      setErr(e.message || "No pudimos iniciar el alta de 2FA.");
    }
    setBusy(false);
  }

  async function verifyEnroll() {
    if (!enroll || code.length !== 6) return;
    setBusy(true);
    setErr(null);
    try {
      const challengeId = await rawChallenge(enroll.id);
      await rawVerify(enroll.id, challengeId, code);
      // Success — reload state.
      setEnroll(null);
      setCode("");
      await load();
    } catch (e) {
      console.error("[mfa] verifyEnroll failed:", e);
      setErr(e.message || "Código incorrecto. Probá de nuevo.");
      setCode("");
    }
    setBusy(false);
  }

  async function cancelEnroll() {
    if (!enroll) return;
    setBusy(true);
    try {
      await rawUnenroll(enroll.id);
    } catch {}
    setEnroll(null);
    setCode("");
    setState("off");
    setBusy(false);
  }

  async function disableMfa() {
    if (!factor) return;
    setBusy(true);
    setErr(null);
    try {
      await rawUnenroll(factor.id);
      setFactor(null);
      setState("off");
    } catch (e) {
      console.error("[mfa] unenroll failed:", e);
      setErr(e.message || "No pudimos desactivar 2FA.");
    }
    setBusy(false);
  }

  // -------- render --------
  const wrapperStyle = {
    background: C.creamDk, border: "1.5px solid " + C.border, borderRadius: 14,
    padding: "13px 16px", marginBottom: 8, fontFamily: "inherit",
  };

  if (state === "loading") {
    return (
      <div style={wrapperStyle}>
        <div style={{ fontSize: 13, color: C.textMd }}>Cargando 2FA…</div>
      </div>
    );
  }

  if (state === "on") {
    return (
      <div style={wrapperStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: C.green + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Autenticación 2FA activada</div>
            <div style={{ fontSize: 11, color: C.textLt }}>Te pide un código al iniciar sesión.</div>
          </div>
        </div>
        {err && <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>{err}</div>}
        <button
          onClick={disableMfa}
          disabled={busy}
          style={{
            width: "100%", marginTop: 8, background: "transparent",
            color: C.red, border: "1.5px solid " + C.red + "55",
            borderRadius: 10, padding: "9px",
            fontSize: 12, fontWeight: 700,
            cursor: busy ? "default" : "pointer", fontFamily: "inherit",
          }}
        >
          {busy ? "Desactivando…" : "Desactivar 2FA"}
        </button>
      </div>
    );
  }

  if (state === "enrolling" && enroll) {
    return (
      <div style={wrapperStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>Activá 2FA</div>
        <div style={{ fontSize: 11, color: C.textMd, lineHeight: 1.5, marginBottom: 12 }}>
          Escaneá este código con Google Authenticator, Authy, 1Password, o cualquier app TOTP. Después ingresá el código de 6 dígitos que muestra para confirmar.
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
          <QrCode
            uri={buildOtpAuthUri({
              secret: enroll.secret,
              accountName: accountName || "SAMAS user",
              issuer: ISSUER,
            })}
            size={180}
          />
        </div>
        {enroll.secret && (
          <div style={{ fontSize: 10, color: C.textLt, textAlign: "center", marginBottom: 12, fontFamily: "monospace", wordBreak: "break-all" }}>
            ¿No podés escanear? Código manual:<br/>
            <span style={{ color: C.textMd, fontWeight: 700, letterSpacing: 1 }}>{enroll.secret}</span>
          </div>
        )}
        <div style={{ marginBottom: 10 }}>
          <CodeInput C={C} value={code} onChange={setCode} error={!!err} disabled={busy} />
        </div>
        {err && <div style={{ fontSize: 11, color: C.red, marginBottom: 8, textAlign: "center" }}>{err}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={cancelEnroll} disabled={busy} style={{ flex: 1, background: C.card, color: C.textMd, border: "1.5px solid " + C.border, borderRadius: 10, padding: "9px", fontSize: 12, fontWeight: 600, cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}>
            Cancelar
          </button>
          <button onClick={verifyEnroll} disabled={busy || code.length !== 6} style={{ flex: 2, background: code.length === 6 && !busy ? C.accent : C.creamDk, color: code.length === 6 && !busy ? "#fff" : C.textLt, border: "none", borderRadius: 10, padding: "9px", fontSize: 12, fontWeight: 700, cursor: busy || code.length !== 6 ? "default" : "pointer", fontFamily: "inherit" }}>
            {busy ? "Verificando…" : "Verificar y activar"}
          </button>
        </div>
      </div>
    );
  }

  // off — show a single button to start
  return (
    <div style={wrapperStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: C.gold + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Autenticación 2FA</div>
          <div style={{ fontSize: 11, color: C.textLt }}>Recomendado · Suma seguridad al login</div>
        </div>
      </div>
      {err && <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>{err}</div>}
      <button onClick={startEnroll} disabled={busy} style={{ width: "100%", background: C.accent, color: "#fff", border: "none", borderRadius: 10, padding: "10px", fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}>
        {busy ? "Cargando…" : "Activar 2FA"}
      </button>
    </div>
  );
}

// ============================================================
// Post-login: MFA challenge view
// ============================================================
// Shown when the user's session is at AAL1 but they have a verified
// TOTP factor (so the app should require AAL2 before showing).
export function MfaChallengeView({ C, onSuccess, onForgot }) {
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await rawListFactors();
        const totp = (data?.totp || []).find((f) => f.status === "verified");
        if (totp) setFactorId(totp.id);
        else {
          // Edge case: user reached this view but no verified factor.
          // Skip gracefully.
          onSuccess && onSuccess();
        }
      } catch (e) {
        console.error("[mfa-challenge] listFactors:", e);
        setErr(e.message || "Error consultando 2FA.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (!factorId || code.length !== 6) return;
    setBusy(true);
    setErr(null);
    try {
      const challengeId = await rawChallenge(factorId);
      await rawVerify(factorId, challengeId, code);
      // Session storage now holds the new AAL2 tokens but the SDK
      // still has the old AAL1 in memory. The cleanest way to make
      // the SDK + the React app pick up the upgrade is a reload —
      // bootstrap re-reads localStorage and starts at AAL2. Skipping
      // calling onSuccess directly because the React state would
      // diverge from the actual session level otherwise.
      if (typeof window !== "undefined" && window.location && window.location.reload) {
        window.location.reload();
        return;
      }
      onSuccess && onSuccess();
    } catch (e) {
      console.error("[mfa-challenge] verify:", e);
      setErr("Código incorrecto. Probá de nuevo.");
      setCode("");
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 80,
      background: C.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, boxSizing: "border-box",
    }}>
      <div style={{
        width: "100%", maxWidth: 340,
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 22,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: C.accent + "22", color: C.accent, fontSize: 20, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>S</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: 2 }}>SAMAS</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: 0, marginBottom: 6 }}>Verificación en dos pasos</h1>
          <div style={{ fontSize: 12, color: C.textMd, lineHeight: 1.5, maxWidth: 280 }}>
            Ingresá el código de 6 dígitos de tu app de autenticación.
          </div>
        </div>
        <CodeInput C={C} value={code} onChange={setCode} error={!!err} disabled={busy} />
        <div style={{
          minHeight: 18, fontSize: 12, fontWeight: 700,
          color: err ? C.red : "transparent", textAlign: "center",
        }}>
          {err || "·"}
        </div>
        <button
          onClick={submit}
          disabled={busy || code.length !== 6}
          style={{
            width: "100%",
            background: code.length === 6 && !busy ? C.accent : C.creamDk,
            color: code.length === 6 && !busy ? "#fff" : C.textLt,
            border: "none", borderRadius: 12, padding: "13px",
            fontSize: 14, fontWeight: 800,
            cursor: busy || code.length !== 6 ? "default" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {busy ? "Verificando…" : "Verificar"}
        </button>
        <button
          onClick={onForgot}
          style={{
            background: "transparent", border: "none",
            color: C.textMd, fontSize: 11, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
            textDecoration: "underline",
          }}
        >
          ¿Perdiste el acceso? Cerrá sesión y contactanos.
        </button>
      </div>
    </div>
  );
}
