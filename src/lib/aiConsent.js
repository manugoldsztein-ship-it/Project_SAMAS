// ============================================================
// AI CONSENT — one-time disclosure before any AI call leaves the
// app (samas-0.0.98).
// ============================================================
// Apple's privacy stance + plain decency say users should know
// their portfolio data is being sent to Anthropic when they tap
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
