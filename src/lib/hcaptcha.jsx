// ============================================================
// hcaptcha.js (samas-0.4.19) — feature-flagged hCaptcha integration
// ============================================================
// Anti-bot protection on signup + login. Disabled by default — only
// activates when VITE_HCAPTCHA_SITEKEY is set at build time.
//
// WHY OPT-IN:
//   We don't have an abuse signal yet. Adding a captcha to every
//   signup adds friction and breaks the "2 minutos y ya estás
//   invirtiendo" promise. The infrastructure is here so when the
//   first abuse wave hits, flipping it on is a 5-minute config
//   change instead of a sprint.
//
// HOW TO ENABLE (when needed):
//
//   1. Sign up at https://www.hcaptcha.com/ (free for low traffic).
//      Get a sitekey + secret key.
//
//   2. Add to your .env (project root):
//        VITE_HCAPTCHA_SITEKEY=10000000-ffff-ffff-ffff-000000000001
//      (The example above is hCaptcha's TEST sitekey — always
//      "passes". Use it for local dev. Replace with your real
//      sitekey for production builds.)
//
//   3. In Supabase Dashboard → Authentication → Providers → Captcha:
//        - Toggle "Enable Captcha protection"
//        - Provider: hCaptcha
//        - Paste your hCaptcha SECRET (NOT the sitekey).
//      Supabase will then reject any auth.signUp / signIn that
//      doesn't include a valid captchaToken.
//
//   4. Rebuild the app (npm run build:cap) — the widget now
//      auto-renders on signup + login, and Supabase auth calls
//      include the token.
//
// FALLBACK BEHAVIOUR (default state today):
//   - isCaptchaEnabled() returns false
//   - <CaptchaWidget> renders nothing
//   - getCaptchaToken() returns null
//   - Supabase auth calls pass undefined, behave normally
//
// ============================================================

import React, { useEffect, useRef, useState } from "react";

// Read once. Vite inlines import.meta.env.VITE_* at build time.
const SITEKEY = import.meta.env.VITE_HCAPTCHA_SITEKEY || "";

export function isCaptchaEnabled() {
  return !!SITEKEY && typeof window !== "undefined";
}

// Loads the hCaptcha JS once. Subsequent calls return the same
// promise so we never inject the <script> twice.
let _hcLoadPromise = null;
function loadHCaptchaScript() {
  if (!isCaptchaEnabled()) return Promise.resolve(false);
  if (_hcLoadPromise) return _hcLoadPromise;
  _hcLoadPromise = new Promise((resolve) => {
    if (window.hcaptcha) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(true);
    s.onerror = () => {
      console.warn("[hcaptcha] script failed to load — proceeding without captcha");
      resolve(false);
    };
    document.head.appendChild(s);
  });
  return _hcLoadPromise;
}

// React widget. Renders nothing when disabled. When enabled, mounts
// the hCaptcha challenge in a div + reports the resulting token via
// onToken({ token: "..." }) and onExpire() when it expires.
export function CaptchaWidget({ onToken, onExpire, theme = "dark" }) {
  const [containerId] = useState(
    () => `samas-hcaptcha-${Math.random().toString(36).slice(2, 10)}`,
  );
  const widgetIdRef = useRef(null);

  useEffect(() => {
    if (!isCaptchaEnabled()) return;
    let cancelled = false;
    loadHCaptchaScript().then((ok) => {
      if (cancelled || !ok) return;
      if (!window.hcaptcha) return;
      try {
        widgetIdRef.current = window.hcaptcha.render(containerId, {
          sitekey: SITEKEY,
          theme,
          callback: (token) => onToken && onToken(token),
          "expired-callback": () => onExpire && onExpire(),
          "error-callback": () => onExpire && onExpire(),
        });
      } catch (e) {
        console.warn("[hcaptcha] render failed:", e?.message || e);
      }
    });
    return () => {
      cancelled = true;
      if (widgetIdRef.current != null && window.hcaptcha) {
        try { window.hcaptcha.reset(widgetIdRef.current); } catch (_e) { /* ignore */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isCaptchaEnabled()) return null;

  return (
    <div
      id={containerId}
      style={{
        display: "flex",
        justifyContent: "center",
        margin: "10px 0",
        minHeight: 78,  // hCaptcha widget is ~74px tall — reserve room
      }}
    />
  );
}

// Helper for forms that already manage their own captcha state.
// Returns the current token from the widget instance, or null if
// disabled / not yet solved. Most callers should prefer the
// onToken callback on <CaptchaWidget /> instead.
export function getCaptchaToken(widgetId) {
  if (!isCaptchaEnabled() || !window.hcaptcha) return null;
  try {
    return window.hcaptcha.getResponse(widgetId) || null;
  } catch {
    return null;
  }
}

// Reset the widget after a failed submit so the user can solve again.
export function resetCaptcha(widgetId) {
  if (!isCaptchaEnabled() || !window.hcaptcha) return;
  try { window.hcaptcha.reset(widgetId); } catch { /* ignore */ }
}
