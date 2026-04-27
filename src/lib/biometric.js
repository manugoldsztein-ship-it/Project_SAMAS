// ============================================================
// SAMAS — Biometric authentication wrapper
// ============================================================
// Thin wrapper over @aparajita/capacitor-biometric-auth so the rest
// of the app doesn't have to deal with the plugin's quirks (or its
// absence on web / non-native builds).
//
// Plugin install (one-time):
//   npm install @aparajita/capacitor-biometric-auth
//   npx cap sync ios
//
// Info.plist entry (one-time, on the iOS native side):
//   <key>NSFaceIDUsageDescription</key>
//   <string>Usá Face ID para desbloquear SAMAS más rápido.</string>
//
//   plutil -insert NSFaceIDUsageDescription \
//     -string "Usá Face ID para desbloquear SAMAS más rápido." \
//     ios/App/App/Info.plist
//
// API (all async, all safe to call without the plugin installed):
//   isAvailable()  → "face" | "fingerprint" | "iris" | "none"
//                    Returns "none" when the plugin isn't installed,
//                    when running on web preview, or when the device
//                    has no enrolled biometric.
//   authenticate({ reason }) → boolean
//                    Triggers the Face ID / Touch ID prompt. Resolves
//                    true on success, false on user cancel, throws on
//                    hardware error.
//
// Storage:
//   localStorage.samas_biometric_enabled = "true" | "false"
//   The user can opt in / out via Settings; this flag controls
//   whether we prompt automatically on app open.
// ============================================================

const ENABLED_KEY = "samas_biometric_enabled";

// Cache the plugin module after first successful import so we don't
// pay the dynamic-import cost on every call.
let pluginPromise = null;
function loadPlugin() {
  if (pluginPromise) return pluginPromise;
  pluginPromise = import("@aparajita/capacitor-biometric-auth")
    .then((m) => {
      // v10 exports BiometricAuth as a named export. Try a couple of
      // shapes in case the build splits oddly or a future version
      // changes the export style.
      const plugin = m?.BiometricAuth || m?.default || m;
      console.log("[biometric] plugin loaded:", typeof plugin, Object.keys(plugin || {}));
      return plugin || null;
    })
    .catch((e) => {
      console.warn("[biometric] plugin import failed:", e?.message);
      return null;
    });
  return pluginPromise;
}

// Debug helper — exposes the raw checkBiometry response. Useful when
// the toggle isn't appearing and we need to know why.
export async function debugBiometric() {
  const plugin = await loadPlugin();
  if (!plugin) return { plugin: false };
  try {
    const info = await plugin.checkBiometry();
    return { plugin: true, info };
  } catch (e) {
    return { plugin: true, error: String(e?.message || e), code: e?.code };
  }
}

export async function isBiometricAvailable() {
  const plugin = await loadPlugin();
  if (!plugin) return "none";
  try {
    const info = await plugin.checkBiometry();
    console.log("[biometric] checkBiometry:", info);
    if (!info?.isAvailable) return "none";
    // v10 BiometryType enum:
    //   0 = none, 1 = touchId, 2 = faceId,
    //   3 = fingerprintAuthentication (Android),
    //   4 = faceAuthentication (Android),
    //   5 = irisAuthentication (Android)
    switch (info.biometryType) {
      case 1: return "fingerprint";
      case 2: return "face";
      case 3: return "fingerprint";
      case 4: return "face";
      case 5: return "iris";
      default: return "none";
    }
  } catch (e) {
    console.warn("[biometric] checkBiometry failed:", e);
    return "none";
  }
}

export async function authenticateWithBiometric(reason = "Desbloqueá SAMAS") {
  const plugin = await loadPlugin();
  if (!plugin) throw new Error("Biometric no disponible.");
  try {
    await plugin.authenticate({
      reason,
      cancelTitle: "Usar PIN",
      allowDeviceCredential: false,
      iosFallbackTitle: "",
    });
    return true;
  } catch (e) {
    // Aparajita's plugin throws on cancel / failure with a `code`
    // string. Treat user-cancel as "false" (not an exception).
    const code = e?.code || "";
    if (code === "userCancel" || code === "appCancel" || code === "systemCancel") {
      return false;
    }
    throw e;
  }
}

// User preference helpers (localStorage-backed).
export function isBiometricEnabled() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(ENABLED_KEY) === "true";
}

export function setBiometricEnabled(on) {
  if (typeof localStorage === "undefined") return;
  if (on) localStorage.setItem(ENABLED_KEY, "true");
  else localStorage.removeItem(ENABLED_KEY);
}
