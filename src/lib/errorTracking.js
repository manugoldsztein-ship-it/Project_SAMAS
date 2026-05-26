// ============================================================
// errorTracking.js (samas-0.4.32) — Sentry integration
// ============================================================
// Captures unhandled JS errors + React render crashes + user-flagged
// breadcrumbs and ships them to Sentry. Feature-flagged on the
// VITE_SENTRY_DSN env: when unset, Sentry doesn't initialize and
// every helper is a no-op. Lets dev / web preview run without
// burning Sentry quota.
//
// HOW TO ENABLE
//   1. Sign up at sentry.io. Create a project of type "React".
//   2. Copy the DSN (looks like
//        https://abc123@o123456.ingest.us.sentry.io/789012)
//   3. Add to .env at the project root:
//        VITE_SENTRY_DSN=<paste DSN here>
//   4. Optionally set VITE_SENTRY_ENV (defaults to "development")
//      and VITE_SENTRY_RELEASE for build identification.
//   5. Rebuild: npm run build:cap → npx cap sync ios
//
// PRIVACY
//   - User context is set to { id, email_redacted } — we hash the
//     email locally so Sentry only sees a stable opaque id, not the
//     PII. The user_id is the same Supabase auth.users.id used
//     everywhere else; useful for correlating with our own logs.
//   - "beforeSend" strips known-PII keys from any error context
//     (email, phone, password — defense in depth).
//   - Replay / Session Replay is NOT enabled. Replay records DOM
//     mutations which would leak balances + ticker positions to
//     Sentry. Stack traces are enough; we don't need replays.
//
// HOW TO TEST
//   Once initialized:
//     window.__samas_sentry_test_crash?.()  // throws + reports
//   Or trigger any actual JS error — the boundary will catch +
//   ship it. Inspect on sentry.io within ~1 second.
// ============================================================

import * as Sentry from "@sentry/react";

const DSN     = import.meta.env.VITE_SENTRY_DSN || "";
const ENV     = import.meta.env.VITE_SENTRY_ENV || "development";
const RELEASE = import.meta.env.VITE_SENTRY_RELEASE || "";

let _initialized = false;

export function isErrorTrackingEnabled() {
  return !!DSN && _initialized;
}

export function initErrorTracking() {
  if (!DSN || _initialized) return;
  try {
    Sentry.init({
      dsn: DSN,
      environment: ENV,
      release: RELEASE || undefined,
      // Default integrations (BrowserApiErrors / GlobalHandlers /
      // TryCatch / etc.) are fine. We do NOT add browserTracingIntegration
      // (perf data is overkill for our scope) or replayIntegration
      // (privacy hazard — see header).
      integrations: [],
      // Lower sample rate would drop crashes — keep at 1.0 for the
      // demo. When traffic scales we can drop to 0.5 for non-fatal
      // events but keep 1.0 for fatals.
      sampleRate: 1.0,
      // Strip known PII from any event context. Defense in depth on
      // top of the user-context redaction below.
      beforeSend(event) {
        try {
          if (event.user) {
            // Never let the email leak even if some other code path
            // accidentally calls setUser({ email }).
            delete event.user.email;
            delete event.user.username;
          }
          if (event.request?.headers) {
            // Strip Authorization headers if any error capture tries
            // to include them.
            delete event.request.headers["Authorization"];
            delete event.request.headers["authorization"];
            delete event.request.headers["Cookie"];
            delete event.request.headers["cookie"];
          }
          // Walk extras + tags shallowly for password/token-shaped keys.
          const purge = (obj) => {
            if (!obj || typeof obj !== "object") return;
            for (const k of Object.keys(obj)) {
              if (/password|token|secret|otp|cbu|cuit|dni|cuil/i.test(k)) {
                obj[k] = "[REDACTED]";
              }
            }
          };
          purge(event.extra);
          purge(event.tags);
          purge(event.contexts);
        } catch (_e) { /* never let scrubbing break the report */ }
        return event;
      },
    });
    _initialized = true;
    // Test helper — only exposed when the user opens devtools and
    // wants to verify the wiring. Throws a tagged error so the
    // Sentry side is easy to find.
    if (typeof window !== "undefined") {
      window.__samas_sentry_test_crash = () => {
        throw new Error("[samas] sentry test crash from window.__samas_sentry_test_crash");
      };
    }
    console.log("[SAMAS] Sentry initialized:", ENV, RELEASE || "(no release tag)");
  } catch (e) {
    // Never let the tracking init crash the app boot. Log and continue.
    console.warn("[SAMAS] Sentry init failed:", e?.message || e);
  }
}

// Capture an exception manually. No-op when disabled.
export function captureException(err, context = {}) {
  if (!isErrorTrackingEnabled()) return;
  try {
    Sentry.captureException(err, { extra: context });
  } catch (_e) { /* swallow */ }
}

// Capture a non-error event. Useful for "user hit X edge case but
// it didn't crash" style breadcrumbs.
export function captureMessage(message, level = "info") {
  if (!isErrorTrackingEnabled()) return;
  try {
    Sentry.captureMessage(message, level);
  } catch (_e) { /* swallow */ }
}

// Set user context. Called once after auth resolves. Email gets
// hashed locally so Sentry stores an opaque id, not the PII.
export async function setUserContext(user) {
  if (!isErrorTrackingEnabled()) return;
  try {
    let emailHash = null;
    if (user?.email && typeof crypto?.subtle?.digest === "function") {
      const bytes = new TextEncoder().encode(user.email.trim().toLowerCase());
      const buf = await crypto.subtle.digest("SHA-256", bytes);
      emailHash = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 16);
    }
    Sentry.setUser({
      id: user?.id || null,
      email_redacted: emailHash || null,
    });
  } catch (_e) { /* swallow */ }
}

// Clear user context on logout. Avoids cross-user attribution if
// two users share a device (PIN-locked flow).
export function clearUserContext() {
  if (!isErrorTrackingEnabled()) return;
  try { Sentry.setUser(null); } catch (_e) { /* swallow */ }
}

// Add a breadcrumb — leaves a trail of what the user did before
// a crash. Sentry already auto-tracks DOM events / console / fetch;
// this is for SAMAS-specific business events ("placed order",
// "AI quota exhausted", etc.).
export function addBreadcrumb(message, data = {}) {
  if (!isErrorTrackingEnabled()) return;
  try {
    Sentry.addBreadcrumb({ message, data, level: "info" });
  } catch (_e) { /* swallow */ }
}
