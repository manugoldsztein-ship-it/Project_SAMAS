// ============================================================
// AI CONSENT — one-time disclosure before any AI call leaves the
// app (samas-0.0.98).
// ============================================================
// Apple's privacy stance + plain decency say users should know
// their portfolio data is being sent to the AI provider when they tap
// any AI feature. This module:
//
//   1. Tracks consent in localStorage (samas_ai_consent_v1).
//   2. Exposes ensureAIConsent() — every AI client wrapper awaits
//      it. If the user has already accepted, resolves instantly.
//      If not, fires a CustomEvent that the global AIConsentModal
//      (in Shell.jsx) listens for. Modal mounts, user taps Acepto
//      or Rechazar, the deferred Promise resolves with the choice.
//
// localStorage is fine here — even if a user clears it, re-prompting
// once is the right behavior. We're not enforcing a legal contract,
// we're disclosing a data flow.
// ============================================================

const KEY = "samas_ai_consent_v1";

let pending = null;
let resolveCb = null;

export function hasAIConsent() {
  if (typeof localStorage === "undefined") return false;
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** Mark consent as granted + resolve any in-flight prompt. */
export function grantAIConsent() {
  try { localStorage.setItem(KEY, "1"); } catch {}
  if (resolveCb) { const r = resolveCb; resolveCb = null; pending = null; r(true); }
}

/** Resolve any in-flight prompt as denied. Doesn't persist (so the
    next AI tap re-prompts — denial is "not now," not "never"). */
export function denyAIConsent() {
  if (resolveCb) { const r = resolveCb; resolveCb = null; pending = null; r(false); }
}

/**
 * ensureAIConsent() — call before any AI request. Resolves with
 * true if the user has consented (now or earlier), false if they
 * tapped Rechazar on the prompt.
 */
export function ensureAIConsent() {
  // Global off-switch beats everything (samas-0.4.11). Returning
  // false here causes every gateOnConsent() to throw
  // AIConsentDeniedError, which every AI surface already catches +
  // silently hides itself. No re-render storm; just clean self-hide.
  if (isAIDisabled()) return Promise.resolve(false);
  if (hasAIConsent()) return Promise.resolve(true);
  if (pending) return pending;
  pending = new Promise((resolve) => {
    resolveCb = resolve;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("samas:ai-consent-request"));
    }
  });
  return pending;
}

/** For testing / Settings reset — un-grant consent. */
export function revokeAIConsent() {
  try { localStorage.removeItem(KEY); } catch {}
}

// ============================================================
// AI DISABLED — global off-switch (samas-0.4.11)
// ============================================================
// Distinct from consent. Consent is "did you agree to share data
// with the AI provider"; disabled is "I want NO AI features, period".
// A user can consent and later flip this on without re-prompting.
//
// When isAIDisabled() returns true:
//   - ensureAIConsent() resolves false → all gateOnConsent() calls
//     throw AIConsentDeniedError → every AI surface silently hides.
//   - getAIQuotaStatus() short-circuits to null → AIQuotaPill hides.
//   - Components that explicitly check this flag (Wallet header ?
//     button, Plus settings row, etc.) hide their UI.
//
// Persisted in localStorage so the choice survives reloads.
// Broadcasts a samas:ai-disabled-changed event so any mounted
// component can react without polling.
// ============================================================

const DISABLED_KEY = "samas_ai_disabled_v1";

export function isAIDisabled() {
  if (typeof localStorage === "undefined") return false;
  try { return localStorage.getItem(DISABLED_KEY) === "1"; } catch { return false; }
}

export function setAIDisabled(disabled) {
  try {
    if (disabled) localStorage.setItem(DISABLED_KEY, "1");
    else localStorage.removeItem(DISABLED_KEY);
  } catch (_) { /* noop */ }
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("samas:ai-disabled-changed", {
        detail: { disabled: !!disabled },
      }));
    }
  } catch (_) { /* SSR */ }
}
