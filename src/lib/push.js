// ============================================================
// SAMAS — Push notifications (iOS/Android via @capacitor/push-notifications)
// ============================================================
// Same shape as biometric.js — every helper is safe on web (no-op),
// safe before the user grants permission (returns sensible defaults),
// and never throws into the calling component.
//
// Storage:
//   localStorage.samas_push_enabled = "true" | "false"
//     User opt-in flag. If "false" we never request permission again
//     until they re-enable from Settings.
//
//   Server-side: device_tokens table in Supabase. Each successful
//   registration upserts (user_id, token, platform). The send-push
//   edge function reads from there.
//
// Flow:
//   1. App boot → if enabled flag is true, call registerPush().
//   2. registerPush() → asks iOS for permission, then calls
//      PushNotifications.register() which fires either the
//      "registration" event (got APNs token) or "registrationError".
//   3. On token, we upsert it to device_tokens and store a copy in
//      localStorage so subsequent sessions know we already registered.
//   4. setupListeners() wires foreground "pushNotificationReceived"
//      and background-tap "pushNotificationActionPerformed".
//
// Why we keep a localStorage copy of the token: if the network is down
// at boot we still want to show "push enabled" in Settings without
// hitting Supabase.
// ============================================================

import { isNative } from "./native.js";

const ENABLED_KEY = "samas_push_enabled";
const TOKEN_KEY = "samas_push_token";

// ----- preference helpers (sync, localStorage-backed) -----
export function isPushEnabled() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(ENABLED_KEY) === "true";
}
export function setPushEnabled(on) {
  if (typeof localStorage === "undefined") return;
  if (on) localStorage.setItem(ENABLED_KEY, "true");
  else localStorage.removeItem(ENABLED_KEY);
}
export function getCachedToken() {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY) || null;
}
function cacheToken(token) {
  if (typeof localStorage === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// ----- plugin loader (dynamic so web bundle stays slim) -----
let pluginPromise = null;
function loadPlugin() {
  if (pluginPromise) return pluginPromise;
  if (!isNative) {
    pluginPromise = Promise.resolve(null);
    return pluginPromise;
  }
  pluginPromise = import("@capacitor/push-notifications")
    .then((m) => m?.PushNotifications || null)
    .catch((e) => {
      console.warn("[push] plugin load failed:", e?.message);
      return null;
    });
  return pluginPromise;
}

// ----- permission state -----
// Returns "granted" | "denied" | "prompt" | "unsupported"
export async function getPushPermission() {
  const plugin = await loadPlugin();
  if (!plugin) return "unsupported";
  try {
    const r = await plugin.checkPermissions();
    return r?.receive || "prompt";
  } catch (e) {
    console.warn("[push] checkPermissions:", e);
    return "prompt";
  }
}

// Ask iOS for notification permission and start the registration
// dance. Returns { permission, token } once the APNs token comes back,
// or rejects if permission was denied.
//
// onToken(token) is called BEFORE this resolves (so callers can upsert
// to Supabase from a place that has the user_id handy). It's also
// safe to ignore — getCachedToken() will reflect the latest value.
export async function registerPush(onToken) {
  const plugin = await loadPlugin();
  if (!plugin) {
    return { permission: "unsupported", token: null };
  }

  // Ask. iOS shows the prompt the first time; subsequent calls are
  // instant and just return the previous decision.
  let perm;
  try {
    perm = await plugin.requestPermissions();
  } catch (e) {
    console.warn("[push] requestPermissions:", e);
    return { permission: "denied", token: null };
  }
  if (perm?.receive !== "granted") {
    setPushEnabled(false);
    cacheToken(null);
    return { permission: perm?.receive || "denied", token: null };
  }

  // Wait for the registration callback. plugin.register() returns
  // void; the actual token comes through the "registration" event.
  // We promisify with a one-shot listener and a 10s safety timeout.
  const tokenPromise = new Promise((resolve, reject) => {
    let done = false;
    const okHandle = plugin.addListener("registration", (t) => {
      if (done) return; done = true;
      resolve(t?.value || null);
    });
    const errHandle = plugin.addListener("registrationError", (e) => {
      if (done) return; done = true;
      reject(new Error(e?.error || "registrationError"));
    });
    setTimeout(() => {
      if (done) return; done = true;
      reject(new Error("APNs registration timed out (10s)"));
    }, 10000);
    // Capacitor returns the listener handles synchronously in v8;
    // earlier versions returned promises. We support both shapes.
    Promise.resolve(okHandle).catch(() => {});
    Promise.resolve(errHandle).catch(() => {});
  });

  try {
    await plugin.register();
  } catch (e) {
    console.warn("[push] register call:", e);
    return { permission: "granted", token: null };
  }

  let token = null;
  try {
    token = await tokenPromise;
  } catch (e) {
    console.warn("[push] token:", e?.message);
  }

  if (token) {
    cacheToken(token);
    setPushEnabled(true);
    if (typeof onToken === "function") {
      try { await onToken(token); } catch (e) { console.warn("[push] onToken cb:", e); }
    }
  }
  return { permission: "granted", token };
}

// Call once at app boot AFTER you have registerPush()'d at least once.
// Wires foreground-receive and tap handlers. Returns a cleanup fn.
//
// onMessage({ title, body, data }) — fired when a push lands while the
//   app is in the foreground. iOS does NOT show a system banner in
//   this case, so we typically render an in-app toast.
// onAction({ data }) — fired when the user taps a notification (from
//   background or lock screen). data is whatever you put in the APNs
//   payload's `data` field. Use it for deep-linking.
export async function setupPushListeners({ onMessage, onAction } = {}) {
  const plugin = await loadPlugin();
  if (!plugin) return () => {};

  const handles = [];
  if (typeof onMessage === "function") {
    try {
      handles.push(await plugin.addListener("pushNotificationReceived", (n) => {
        try {
          onMessage({
            title: n?.title || "",
            body: n?.body || "",
            data: n?.data || {},
          });
        } catch (e) { console.warn("[push] onMessage:", e); }
      }));
    } catch (e) { console.warn("[push] add receive:", e); }
  }
  if (typeof onAction === "function") {
    try {
      handles.push(await plugin.addListener("pushNotificationActionPerformed", (a) => {
        try {
          onAction({
            data: a?.notification?.data || {},
            actionId: a?.actionId || "tap",
          });
        } catch (e) { console.warn("[push] onAction:", e); }
      }));
    } catch (e) { console.warn("[push] add action:", e); }
  }

  return () => {
    handles.forEach((h) => { try { h?.remove?.(); } catch {} });
  };
}

// Local convenience: clear server token + local prefs. Call on logout.
export function clearPushLocal() {
  setPushEnabled(false);
  cacheToken(null);
}
