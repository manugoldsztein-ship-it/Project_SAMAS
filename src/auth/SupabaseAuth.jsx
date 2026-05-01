// ============================================================
// SUPABASE AUTH FLOW
// ============================================================
// Self-contained module that replaces the demo-PIN login. Exports:
//
//  - useSupabaseSession(): React hook — tracks the current session
//    and the calling user's profile row. Returns loading state,
//    the session, the user, the profile, and a refetch helper.
//
//  - SupabaseAuthFlow: the full-screen auth UI. Shown when there
//    is no session (signup/login/forgot) and when the user is
//    logged in but their phone isn't verified yet (verify screen).
//
// The app mounts <SupabaseAuthFlow /> behind a gate in App.jsx —
// once the session is active AND profile.phone_verified is true,
// the main app UI takes over.
//
// All screens use the app's `C` color palette (same as the rest of
// SAMAS) so the look stays consistent.
// ============================================================

import { useEffect, useState } from "react";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../lib/supabase";
import { CaptchaWidget, isCaptchaEnabled } from "../lib/hcaptcha.jsx";

// 0.1.5 — Capacitor detection. When running inside the iOS WebView
// we need to: (1) open OAuth in the system Safari (not the WebView,
// which gets blocked by Google for "embedded user-agent"), (2) use
// a samas:// custom URL scheme so the OAuth provider can deep-link
// back to the app, (3) listen for the redirect via the @capacitor/app
// appUrlOpen event and finish the session via exchangeCodeForSession.
function isCapacitor() {
  return typeof window !== "undefined" &&
    !!(window.Capacitor && window.Capacitor.isNativePlatform &&
       window.Capacitor.isNativePlatform());
}

// AR university list — keys MUST match the case branches in
// public.is_university_email() (supabase/social_university.sql).
// The label is what the dropdown shows; the key is what the trigger
// reads from raw_user_meta_data.university to decide verification.
// Add a new uni? Update both this list AND the SQL function.
const AR_UNIVERSITIES = [
  { key: "uba",      label: "Universidad de Buenos Aires (UBA)" },
  { key: "udesa",    label: "Universidad de San Andrés" },
  { key: "itba",     label: "ITBA" },
  { key: "utdt",     label: "Universidad Torcuato Di Tella" },
  { key: "austral",  label: "Universidad Austral" },
  { key: "uca",      label: "UCA" },
  { key: "palermo",  label: "Universidad de Palermo" },
  { key: "ub",       label: "Universidad de Belgrano" },
  { key: "utn",      label: "UTN" },
  { key: "unlp",     label: "Universidad Nacional de La Plata" },
  { key: "unc",      label: "Universidad Nacional de Córdoba" },
  { key: "ucema",    label: "UCEMA" },
  { key: "siglo21",  label: "Universidad Siglo 21" },
];

// Raw fetch helper for Edge Functions. The SDK's `functions.invoke`
// has been flaky in our setup — sometimes hangs before even dispatching
// the request (observed in DevTools Network tab staying empty). Doing
// fetch ourselves removes the black box: we always know we're either
// waiting on the server or we got a clear error.
async function callEdgeFunction(name, body) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) {
    throw new Error("No active session. Please log in again.");
  }
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { error: text }; }
  return { status: resp.status, ok: resp.ok, body: parsed };
}

// -----------------------------------------------------------
// Hook — session + profile, kept in sync with auth state changes.
// -----------------------------------------------------------
export function useSupabaseSession() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load the profile row for the current user (or null if no user).
  // Uses raw fetch to PostgREST instead of the SDK's `.from(...).select()`
  // builder. The builder occasionally hangs without ever dispatching a
  // request on this build (same root cause as the ui_mode + 2FA SDK
  // hangs already worked around). Raw fetch always returns or fails
  // explicitly within the timeout — we never get stuck on a blank app
  // because the profile never loaded.
  async function loadProfile(currentSession) {
    if (!currentSession?.user) {
      setProfile(null);
      return;
    }
    const userId = currentSession.user.id;
    const token = currentSession.access_token;
    if (!token) {
      setProfile(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*`,
        {
          method: "GET",
          headers: {
            "apikey": SUPABASE_PUBLISHABLE_KEY,
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
          },
          signal: ctrl.signal,
        },
      );
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        console.error("[auth] profile fetch error:", resp.status, txt);
        setProfile(null);
        return;
      }
      const arr = await resp.json();
      setProfile(Array.isArray(arr) && arr.length > 0 ? arr[0] : null);
    } catch (e) {
      console.error("[auth] profile fetch threw:", e);
      setProfile(null);
    } finally {
      clearTimeout(t);
    }
  }

  useEffect(() => {
    // Initial session load + subscribe to changes. All calls are wrapped
    // in try/catch + a safety timeout — we never want a Supabase failure
    // to hang the whole app on a blank screen. If something goes wrong,
    // we log it and proceed with no session (auth flow will show).
    let alive = true;
    const timeout = setTimeout(() => {
      if (alive) {
        console.warn("[SAMAS] Supabase getSession() timed out after 6s");
        setLoading(false);
      }
    }, 6000);

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) console.error("[SAMAS] getSession error:", error);
        if (!alive) return;
        setSession(data?.session || null);
        await loadProfile(data?.session || null);
      } catch (err) {
        console.error("[SAMAS] getSession threw:", err);
      } finally {
        if (alive) {
          setLoading(false);
          clearTimeout(timeout);
        }
      }
    })();

    let unsubscribe = () => {};
    try {
      const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, s) => {
        if (!alive) return;
        setSession(s);
        await loadProfile(s);
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    } catch (err) {
      console.error("[SAMAS] onAuthStateChange failed:", err);
    }

    return () => { alive = false; clearTimeout(timeout); unsubscribe(); };
  }, []);

  const refetchProfile = () => loadProfile(session);

  return {
    session,
    user: session?.user || null,
    profile,
    loading,
    refetchProfile,
  };
}

// -----------------------------------------------------------
// Shared style helpers. `C` is the app's color palette (passed
// down from App.jsx) so the auth screens match the rest of SAMAS.
// -----------------------------------------------------------
function fieldStyle(C, invalid) {
  return {
    background: C.card,
    border: "1.5px solid " + (invalid ? C.red : C.border),
    borderRadius: 12,
    padding: "12px 14px",
    fontSize: 14,
    fontFamily: "inherit",
    color: C.text,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };
}

function primaryBtn(C, disabled) {
  return {
    background: disabled ? C.creamDk : C.accent,
    color: disabled ? C.textMd : "#fff",
    border: "none",
    borderRadius: 12,
    padding: "13px",
    fontSize: 14,
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };
}

function linkBtn(C) {
  return {
    background: "transparent",
    border: "none",
    color: C.accent,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 4,
  };
}

function ErrorLine({ text, C }) {
  if (!text) return null;
  return (
    <div style={{ background: C.red + "18", border: "1px solid " + C.red + "55", color: C.red, borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
      {text}
    </div>
  );
}

// -----------------------------------------------------------
// OAuthButtons — Continuar con Google / Continuar con Apple
// -----------------------------------------------------------
// Apple's App Store guideline 4.8 requires that any iOS app offering
// third-party login (Google, Facebook, etc.) MUST also offer Sign in
// with Apple. So these two ship together — we can't add Google alone.
//
// SETUP (Manuel does this on the provider side):
//   See supabase/OAUTH_SETUP.md for the full walk-through. Until the
//   providers are enabled in Supabase Dashboard → Authentication →
//   Providers, tapping these buttons returns "provider not enabled"
//   from Supabase, which we surface as a friendly inline message.
//
// HOW IT WORKS WHEN ENABLED:
//   1. supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })
//      kicks off the OAuth dance — opens the provider login in a new
//      tab (web) or in-app browser (Capacitor with @capacitor/browser).
//   2. After the user authenticates, the provider redirects to our
//      Supabase callback URL, which auto-creates / signs in the user.
//   3. The onAuthStateChange listener (in useSupabaseSession) picks
//      up the new session and the auth gate unmounts this view.
//
// CAPACITOR NATIVE FLOW (post-Cohen, when we wire it):
//   Need an iOS URL scheme (CFBundleURLTypes in Info.plist) +
//   @capacitor/browser plugin + an App.addListener('appUrlOpen')
//   handler that calls supabase.auth.exchangeCodeForSession(...) on
//   the redirect URL. Documented in OAUTH_SETUP.md.
// -----------------------------------------------------------
function OAuthButtons({ C, busy, setBusy, onError }) {
  async function start(provider) {
    if (busy) return;
    setBusy(true);
    onError(null);
    try {
      const native = isCapacitor();
      const redirectTo = native
        ? "samas://auth/callback"
        : (typeof window !== "undefined" ? window.location.origin : undefined);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          // skipBrowserRedirect: when true, supabase-js returns the
          // OAuth URL without auto-navigating. We need this on
          // Capacitor so we can open the URL in the system Safari
          // instead of the in-app WebView (Google blocks WebView
          // OAuth flows since 2021). On the web build we let
          // supabase-js navigate the current tab as usual.
          skipBrowserRedirect: native,
        },
      });
      if (error) {
        const msg = String(error.message || "").toLowerCase();
        if (msg.includes("provider is not enabled") || msg.includes("not enabled")) {
          onError(provider === "apple"
            ? "Próximamente — habilitando Sign in with Apple."
            : "Próximamente — habilitando Continuar con Google.");
        } else {
          onError(error.message);
        }
        setBusy(false);
        return;
      }
      // Native Capacitor — open the OAuth URL in system Safari.
      // The provider redirects to samas://auth/callback, which iOS
      // routes back to the app. The Shell's appUrlOpen handler
      // (in src/v2/Shell.jsx) catches it and calls
      // supabase.auth.exchangeCodeForSession.
      if (native && data?.url) {
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url: data.url, presentationStyle: "popover" });
        // Don't clear busy — when the user comes back via the deep
        // link, the appUrlOpen handler signals success and the
        // auth gate unmounts this view.
        return;
      }
      // On the web build, supabase-js already navigated the current
      // tab; we don't reach this line in practice.
    } catch (e) {
      onError(e?.message || String(e));
      setBusy(false);
    }
  }

  // Apple-style + Google-style button styling. Apple per their HIG:
  // black background, white "Continue with Apple" text + glyph.
  // Google per their guidelines: white background, gray border, the
  // multi-color "G" logo. Keeping the buttons simple and brand-correct
  // helps the App Store reviewer recognize compliance at a glance.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
      {/* Apple — first, since iOS users expect it. */}
      <button onClick={() => start("apple")} disabled={busy} style={{
        background: "#000",
        color: "#fff",
        border: "1px solid #000",
        borderRadius: 12,
        padding: "12px",
        fontSize: 14,
        fontWeight: 600,
        cursor: busy ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        width: "100%",
        boxSizing: "border-box",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        opacity: busy ? 0.7 : 1,
      }}>
        {/*  glyph */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.05 12.04c-.04-3.51 2.86-5.19 2.99-5.27-1.63-2.39-4.18-2.72-5.08-2.76-2.16-.22-4.22 1.27-5.32 1.27-1.11 0-2.79-1.24-4.59-1.21-2.36.04-4.55 1.37-5.77 3.48-2.46 4.27-.63 10.59 1.78 14.05 1.18 1.69 2.58 3.59 4.42 3.52 1.78-.07 2.45-1.15 4.6-1.15s2.76 1.15 4.62 1.11c1.91-.03 3.12-1.71 4.28-3.41 1.36-1.96 1.92-3.86 1.95-3.96-.04-.02-3.74-1.43-3.78-5.67M13.83 1.78c.98-1.18 1.64-2.83 1.46-4.46-1.41.06-3.13.94-4.14 2.12-.91 1.05-1.7 2.71-1.49 4.32 1.58.12 3.19-.8 4.17-1.98"/>
        </svg>
        Continuar con Apple
      </button>

      {/* Google */}
      <button onClick={() => start("google")} disabled={busy} style={{
        background: "#fff",
        color: "#1f1f1f",
        border: "1px solid #dadce0",
        borderRadius: 12,
        padding: "12px",
        fontSize: 14,
        fontWeight: 600,
        cursor: busy ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        width: "100%",
        boxSizing: "border-box",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        opacity: busy ? 0.7 : 1,
      }}>
        {/* Google "G" logo — official 4-color paths. */}
        <svg width="16" height="16" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continuar con Google
      </button>

      {/* Divider — "o" between OAuth and email/password. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        marginTop: 4, marginBottom: 4,
      }}>
        <div style={{ flex: 1, height: 1, background: C.border }}/>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textMd, letterSpacing: 0.5, textTransform: "uppercase" }}>
          o con email
        </div>
        <div style={{ flex: 1, height: 1, background: C.border }}/>
      </div>
    </div>
  );
}

// -----------------------------------------------------------
// LOGIN
// -----------------------------------------------------------
function LoginView({ C, onSwitchSignup, onSwitchForgot }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  // 0.1.3 — separate busy flag for OAuth so a stuck OAuth dance
  // doesn't lock out the email/password path.
  const [oauthBusy, setOauthBusy] = useState(false);
  // hCaptcha token (samas-0.4.19). See SignupView for the same pattern.
  const [captchaToken, setCaptchaToken] = useState(null);

  const submit = async () => {
    setErr(null);
    if (!email || !password) {
      setErr("Ingresá email y contraseña.");
      return;
    }
    if (isCaptchaEnabled() && !captchaToken) {
      setErr("Resolvé el captcha para continuar.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
      // captchaToken (samas-0.4.19) — only sent when hCaptcha is
      // enabled at build time. Supabase Dashboard captcha-enforcement
      // gates whether this is required server-side.
      ...(captchaToken ? { options: { captchaToken } } : {}),
    });
    setBusy(false);
    if (error) {
      // Supabase error messages are in English; map the common ones.
      const msg = error.message.toLowerCase();
      if (msg.includes("invalid login")) setErr("Email o contraseña incorrectos.");
      else if (msg.includes("email not confirmed")) setErr("Todavía no confirmaste tu email. Revisá tu bandeja.");
      else setErr(error.message);
    }
    // On success the onAuthStateChange listener in useSupabaseSession picks
    // it up and the auth gate unmounts this screen. No redirect needed.
  };

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 900, color: C.text, margin: 0, marginBottom: 4 }}>Iniciá sesión</h1>
      <div style={{ fontSize: 13, color: C.textMd, marginBottom: 18 }}>Bienvenido de vuelta a SAMAS.</div>

      <ErrorLine text={err} C={C} />

      <OAuthButtons C={C} busy={oauthBusy} setBusy={setOauthBusy} onError={setErr} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <input
          type="email"
          autoComplete="email"
          placeholder="tu@email.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setErr(null); }}
          style={fieldStyle(C)}
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          style={fieldStyle(C)}
        />
      </div>

      {/* hCaptcha widget (samas-0.4.19). Renders only when
          VITE_HCAPTCHA_SITEKEY is set at build time. */}
      <CaptchaWidget onToken={setCaptchaToken} onExpire={() => setCaptchaToken(null)} theme="dark" />

      <button onClick={submit} disabled={busy} style={primaryBtn(C, busy)}>
        {busy ? "Ingresando…" : "Ingresar"}
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <button onClick={onSwitchForgot} style={linkBtn(C)}>¿Olvidaste tu contraseña?</button>
        <button onClick={onSwitchSignup} style={linkBtn(C)}>Crear cuenta</button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------
// SIGNUP
// -----------------------------------------------------------
function SignupView({ C, onSwitchLogin, onSignupDone }) {
  // nombre + apellido captured here flow into auth.users.raw_user_meta_data
  // via the supabase.auth.signUp options.data field. The handle_new_user
  // trigger reads them from raw_user_meta_data and writes them onto the
  // public.profiles row, so by the time the user lands inside the app
  // their displayName ("Manuel Goldsztein") and initials ("MG") are
  // already correct in displayUser, getMe(), every Avatar render, etc.
  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passConfirm, setPassConfirm] = useState("");
  // university_key (string) selected from AR_UNIVERSITIES. Empty
  // string = "Ninguna" — no claim, no badge, no trigger work.
  // If the user picks a uni AND signs up with that uni's email
  // domain, the profiles_social BEFORE-INSERT trigger flips
  // university_verified to true so the badge renders right away.
  const [uniKey, setUniKey] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false); // 0.1.3 OAuth dance
  // hCaptcha token (samas-0.4.19). Null until the user solves the
  // challenge. When isCaptchaEnabled() is false the field is ignored
  // and signup proceeds without a captcha.
  const [captchaToken, setCaptchaToken] = useState(null);

  const nombreOk   = nombre.trim().length >= 1;
  const apellidoOk = apellido.trim().length >= 1;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const pwdLenOk = password.length >= 8;
  const pwdHasNumSym = /[^a-zA-Z\s]/.test(password); // digit or symbol
  const pwdMatch = password && password === passConfirm;
  const captchaOk = !isCaptchaEnabled() || !!captchaToken;
  const allOk = nombreOk && apellidoOk && emailOk && pwdLenOk && pwdHasNumSym && pwdMatch && captchaOk;

  const submit = async () => {
    setErr(null);
    if (!nombreOk)   return setErr("Ingresá tu nombre.");
    if (!apellidoOk) return setErr("Ingresá tu apellido.");
    if (!emailOk) return setErr("Email inválido.");
    if (!pwdLenOk) return setErr("La contraseña debe tener al menos 8 caracteres.");
    if (!pwdHasNumSym) return setErr("La contraseña debe incluir al menos un número o símbolo.");
    if (!pwdMatch) return setErr("Las contraseñas no coinciden.");
    if (isCaptchaEnabled() && !captchaToken) return setErr("Resolvé el captcha para continuar.");

    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // raw_user_meta_data — picked up by the handle_new_user trigger
        // (see supabase/schema.sql) and copied onto public.profiles.
        // The optional `university` field is read by the social
        // provisioning step (see ensureProfile / getMe in
        // api/social.js) and the BEFORE-INSERT trigger on
        // profiles_social validates it against the email domain.
        data: {
          nombre:   nombre.trim(),
          apellido: apellido.trim(),
          ...(uniKey ? { university: uniKey } : {}),
        },
        // captchaToken (samas-0.4.19) — only sent when hCaptcha is
        // enabled at build time. Supabase Dashboard must also have
        // captcha protection turned on for this to be enforced; until
        // then it's a no-op passthrough.
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
    setBusy(false);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered")) setErr("Ya existe una cuenta con ese email.");
      else setErr(error.message);
      return;
    }

    // If the project requires email confirmation (recommended), Supabase
    // returns a user but no session. The app will see no session until
    // the user clicks the confirmation link in their inbox.
    onSignupDone(email);
  };

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 900, color: C.text, margin: 0, marginBottom: 4 }}>Creá tu cuenta</h1>
      <div style={{ fontSize: 13, color: C.textMd, marginBottom: 18 }}>Dos minutos y ya estás invirtiendo.</div>

      <ErrorLine text={err} C={C} />

      <OAuthButtons C={C} busy={oauthBusy} setBusy={setOauthBusy} onError={setErr} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            type="text"
            autoComplete="given-name"
            placeholder="Nombre"
            value={nombre}
            onChange={(e) => { setNombre(e.target.value); setErr(null); }}
            style={{ ...fieldStyle(C, nombre.length > 0 && !nombreOk), flex: 1 }}
          />
          <input
            type="text"
            autoComplete="family-name"
            placeholder="Apellido"
            value={apellido}
            onChange={(e) => { setApellido(e.target.value); setErr(null); }}
            style={{ ...fieldStyle(C, apellido.length > 0 && !apellidoOk), flex: 1 }}
          />
        </div>
        <input
          type="email"
          autoComplete="email"
          placeholder="tu@email.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setErr(null); }}
          style={fieldStyle(C, email.length > 0 && !emailOk)}
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder="Contraseña (mín. 8 con número o símbolo)"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setErr(null); }}
          style={fieldStyle(C, password.length > 0 && (!pwdLenOk || !pwdHasNumSym))}
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder="Confirmar contraseña"
          value={passConfirm}
          onChange={(e) => { setPassConfirm(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && allOk) submit(); }}
          style={fieldStyle(C, passConfirm.length > 0 && !pwdMatch)}
        />

        {/* University dropdown — optional. A native <select> looks
            uglier than a custom popover but plays nicely with iOS's
            picker UX (the wheel) and saves us a whole component. The
            empty option means "no claim", which is what most users
            should pick if they're not students. */}
        <div>
          <label style={{
            display: "block", fontSize: 11, fontWeight: 700, color: C.textMd,
            marginBottom: 6, paddingLeft: 2,
          }}>Universidad (opcional)</label>
          <select
            value={uniKey}
            onChange={(e) => { setUniKey(e.target.value); setErr(null); }}
            style={{
              ...fieldStyle(C),
              // Native selects pick up a default chrome on iOS that
              // looks fine — we just want our font + colors. The
              // appearance:none lets us own the chevron later if
              // needed; for now the OS chevron is acceptable.
              appearance: "none", WebkitAppearance: "none",
              paddingRight: 32,
              backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23${(C.textMd || '#888').replace('#','')}' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 12px center",
            }}
          >
            <option value="">Ninguna</option>
            {AR_UNIVERSITIES.map((u) => (
              <option key={u.key} value={u.key}>{u.label}</option>
            ))}
          </select>
          {uniKey && (
            <div style={{
              fontSize: 11, color: C.textMd, marginTop: 6, lineHeight: 1.45,
              paddingLeft: 2,
            }}>
              Si te registrás con tu mail universitario, tu perfil queda verificado.
            </div>
          )}
        </div>
      </div>

      {/* hCaptcha widget (samas-0.4.19). Renders only when
          VITE_HCAPTCHA_SITEKEY is set at build time — otherwise
          this component returns null and the form is unchanged. */}
      <CaptchaWidget onToken={setCaptchaToken} onExpire={() => setCaptchaToken(null)} theme="dark" />

      <button onClick={submit} disabled={!allOk || busy} style={primaryBtn(C, !allOk || busy)}>
        {busy ? "Creando…" : "Crear cuenta"}
      </button>

      <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
        <button onClick={onSwitchLogin} style={linkBtn(C)}>¿Ya tenés cuenta? Iniciá sesión</button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------
// CONFIRM EMAIL — shown after signup succeeds, tells user to
// check their inbox for the verification link.
// -----------------------------------------------------------
function ConfirmEmailView({ C, email, onBackToLogin }) {
  return (
    <div>
      <div style={{ width: 54, height: 54, borderRadius: 16, background: C.accent + "22", color: C.accent, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
          <polyline points="22,6 12,13 2,6"/>
        </svg>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 900, color: C.text, margin: 0, marginBottom: 6 }}>Confirmá tu email</h1>
      <div style={{ fontSize: 13, color: C.textMd, lineHeight: 1.55, marginBottom: 18 }}>
        Te mandamos un link de confirmación a <strong style={{ color: C.text }}>{email}</strong>.
        Clickealo desde tu mail y volvé a esta pantalla para iniciar sesión.
        <br /><br />
        Si no llegó en unos minutos, revisá la carpeta de spam.
      </div>
      <button onClick={onBackToLogin} style={primaryBtn(C)}>Volver al login</button>
    </div>
  );
}

// -----------------------------------------------------------
// FORGOT PASSWORD
// -----------------------------------------------------------
function ForgotView({ C, onSwitchLogin }) {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setErr(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErr("Email inválido.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: C.text, margin: 0, marginBottom: 6 }}>Revisá tu email</h1>
        <div style={{ fontSize: 13, color: C.textMd, lineHeight: 1.55, marginBottom: 18 }}>
          Si existe una cuenta con ese email, te llegó un link para resetear tu contraseña.
        </div>
        <button onClick={onSwitchLogin} style={primaryBtn(C)}>Volver al login</button>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, color: C.text, margin: 0, marginBottom: 6 }}>Recuperá tu contraseña</h1>
      <div style={{ fontSize: 13, color: C.textMd, marginBottom: 18 }}>Te mandamos un link para resetearla.</div>

      <ErrorLine text={err} C={C} />

      <input
        type="email"
        autoComplete="email"
        placeholder="tu@email.com"
        value={email}
        onChange={(e) => { setEmail(e.target.value); setErr(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        style={{ ...fieldStyle(C), marginBottom: 12 }}
      />

      <button onClick={submit} disabled={busy} style={primaryBtn(C, busy)}>
        {busy ? "Enviando…" : "Enviar link"}
      </button>

      <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
        <button onClick={onSwitchLogin} style={linkBtn(C)}>Volver</button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------
// VERIFY WHATSAPP — shown when logged-in user has phone_verified=false
// -----------------------------------------------------------
function VerifyWhatsAppView({ C, onVerified }) {
  // stage: "phone" -> user types phone; "code" -> user types OTP
  const [stage, setStage] = useState("phone");
  const [phone, setPhone] = useState("+54");
  const [code, setCode] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // Basic E.164-ish check. Twilio will reject anything wildly invalid.
  const phoneOk = /^\+?[1-9]\d{7,14}$/.test(phone.replace(/\s+/g, ""));

  async function sendCode() {
    setErr(null);
    if (!phoneOk) return setErr("Número inválido. Usá formato internacional, ej. +549…");
    setBusy(true);
    try {
      const { status, ok, body } = await callEdgeFunction("send-otp", { phone });
      if (!ok) {
        console.error("[SAMAS] send-otp HTTP", status, body);
        setErr(body?.error || `Error ${status}`);
      } else if (body?.error) {
        setErr(body.error);
      } else {
        setStage("code");
      }
    } catch (e) {
      console.error("[SAMAS] send-otp threw:", e);
      setErr((e && e.message) || "Error de red.");
    }
    setBusy(false);
  }

  async function verifyCode() {
    setErr(null);
    if (!/^\d{4,8}$/.test(code.trim())) return setErr("Código inválido.");
    setBusy(true);
    try {
      const { status, ok, body } = await callEdgeFunction("verify-otp", {
        phone,
        code: code.trim(),
      });
      if (!ok) {
        console.error("[SAMAS] verify-otp HTTP", status, body);
        setErr(body?.error || `Error ${status}`);
      } else if (body?.error) {
        setErr(body.error);
      } else if (!body?.verified) {
        const reasonMsg = {
          no_code: "No hay código pendiente. Pedí uno nuevo.",
          expired: "El código expiró. Pedí uno nuevo.",
          phone_mismatch: "El número no coincide. Volvé y pedí otro código.",
          too_many_attempts: "Demasiados intentos. Pedí un código nuevo.",
          wrong_code: "Código incorrecto. Reintentá.",
        }[body?.reason] || "Código incorrecto o expirado. Reintentá.";
        setErr(reasonMsg);
        if (body?.reason === "wrong_code") setCode("");
      } else {
        onVerified();
      }
    } catch (e) {
      console.error("[SAMAS] verify-otp threw:", e);
      setErr((e && e.message) || "Error de red.");
    }
    setBusy(false);
  }

  return (
    <div>
      <div style={{ width: 54, height: 54, borderRadius: 16, background: C.green + "22", color: C.green, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.97L2 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.91 6.45 17.5 2 12.04 2z"/>
        </svg>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 900, color: C.text, margin: 0, marginBottom: 6 }}>
        {stage === "phone" ? "Verificá tu WhatsApp" : "Pegá el código"}
      </h1>
      <div style={{ fontSize: 13, color: C.textMd, lineHeight: 1.5, marginBottom: 18 }}>
        {stage === "phone"
          ? "Necesitamos confirmar tu número para proteger tu cuenta. Te mandamos un código por WhatsApp."
          : `Te mandamos un código al ${phone} por WhatsApp. Puede tardar unos segundos.`}
      </div>

      <ErrorLine text={err} C={C} />

      {stage === "phone" ? (
        <>
          <input
            type="tel"
            inputMode="tel"
            placeholder="+5491112345678"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && phoneOk) sendCode(); }}
            style={{ ...fieldStyle(C, phone.length > 3 && !phoneOk), marginBottom: 12, fontFamily: "monospace", letterSpacing: 1 }}
          />
          <button onClick={sendCode} disabled={!phoneOk || busy} style={primaryBtn(C, !phoneOk || busy)}>
            {busy ? "Enviando…" : "Mandarme el código"}
          </button>
          <div style={{ fontSize: 10, color: C.textLt, marginTop: 12, textAlign: "center", lineHeight: 1.5 }}>
            Durante desarrollo, el número tiene que estar joineado al sandbox de Twilio.
          </div>
        </>
      ) : (
        <>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={8}
            value={code}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setErr(null); }}
            onPaste={(e) => {
              // Same sanitize as the keyboard path so a paste of
              // "Tu código es 482719 — válido por 5 min" still ends
              // up as 482719 in the input.
              const text = (e.clipboardData || window.clipboardData)?.getData("text") || "";
              const digits = text.replace(/\D/g, "").slice(0, 8);
              if (digits) {
                e.preventDefault();
                setCode(digits);
                setErr(null);
              }
            }}
            onKeyDown={(e) => { if (e.key === "Enter") verifyCode(); }}
            style={{ ...fieldStyle(C), marginBottom: 12, fontFamily: "monospace", letterSpacing: 8, textAlign: "center", fontSize: 20, fontWeight: 700 }}
          />
          {/* Paste-from-clipboard button — saves the user from
              alt-tabbing back to WhatsApp to read each digit. The
              onPaste handler above covers the keyboard path; this
              button is for users who don't know they can long-press
              the input. */}
          <button
            type="button"
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                const digits = (text || "").replace(/\D/g, "").slice(0, 8);
                if (digits) {
                  setCode(digits);
                  setErr(null);
                }
              } catch (_) {
                // Clipboard read can be blocked on iOS WebView if no
                // recent user gesture — the button click itself
                // qualifies but be safe.
              }
            }}
            disabled={busy}
            style={{
              padding: "8px 14px", borderRadius: 999,
              background: "transparent", border: "1px solid " + C.border,
              color: C.textMd, fontFamily: "inherit",
              fontSize: 12, fontWeight: 600,
              cursor: busy ? "default" : "pointer",
              display: "inline-flex", alignItems: "center", gap: 6,
              marginBottom: 12,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Pegar código
          </button>
          <button onClick={verifyCode} disabled={busy} style={primaryBtn(C, busy)}>
            {busy ? "Verificando…" : "Verificar"}
          </button>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            <button onClick={() => { setStage("phone"); setCode(""); setErr(null); }} style={linkBtn(C)}>Cambiar número</button>
            <button onClick={sendCode} disabled={busy} style={linkBtn(C)}>Reenviar</button>
          </div>
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------
// FLOW ORCHESTRATOR — mounts one of the views above depending
// on whether there's a session and whether the phone is verified.
// -----------------------------------------------------------
export function SupabaseAuthFlow({ C, session, profile, onVerified }) {
  // Local view state. "login" default when no session; "verify"
  // when there is a session but phone is unverified. Signup /
  // forgot are triggered from buttons on the login screen.
  const [view, setView] = useState(() => (session ? "verify" : "login"));
  const [pendingEmail, setPendingEmail] = useState(null);

  // If the session appears while we're showing login/signup/forgot,
  // jump to verify (unless the phone is already verified — in which
  // case the parent gate unmounts us entirely).
  useEffect(() => {
    if (session && profile && !profile.phone_verified && view !== "verify") {
      setView("verify");
    } else if (!session && view === "verify") {
      setView("login");
    }
  }, [session, profile, view]);

  // Container card + backdrop. position:absolute inset:0 so it fills
  // whatever parent mounts it (the phone frame in mobile, the full
  // viewport on web).
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 80,
      background: C.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, boxSizing: "border-box",
      overflowY: "auto",
    }}>
      <div style={{
        width: "100%", maxWidth: 380,
        background: C.cream,
        border: "1px solid " + C.border,
        borderRadius: 18,
        padding: "28px 22px",
        boxShadow: "0 24px 48px rgba(0,0,0,0.35)",
      }}>
        {/* brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: C.accent + "22", color: C.accent, fontSize: 18, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>S</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text, letterSpacing: 2 }}>SAMAS</div>
        </div>

        {view === "login" && (
          <LoginView
            C={C}
            onSwitchSignup={() => setView("signup")}
            onSwitchForgot={() => setView("forgot")}
          />
        )}
        {view === "signup" && (
          <SignupView
            C={C}
            onSwitchLogin={() => setView("login")}
            onSignupDone={(email) => { setPendingEmail(email); setView("confirm"); }}
          />
        )}
        {view === "confirm" && (
          <ConfirmEmailView
            C={C}
            email={pendingEmail}
            onBackToLogin={() => setView("login")}
          />
        )}
        {view === "forgot" && (
          <ForgotView
            C={C}
            onSwitchLogin={() => setView("login")}
          />
        )}
        {view === "verify" && (
          <VerifyWhatsAppView
            C={C}
            onVerified={onVerified}
          />
        )}
      </div>
    </div>
  );
}
