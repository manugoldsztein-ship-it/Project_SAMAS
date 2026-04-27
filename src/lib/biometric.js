// ============================================================
// SAMAS — Biometric authentication wrapper (static import)
// ============================================================
// Static import works around a Capacitor 8 quirk where dynamic
// import("@aparajita/capacitor-biometric-auth") never resolves.
// The plugin has a web fallback that throws "Not implemented",
// so static import is safe in non-native builds too.
// ============================================================

import { BiometricAuth } from "@aparajita/capacitor-biometric-auth";

const ENABLED_KEY = "samas_biometric_enabled";

export async function debugBiometric() {
  if (!BiometricAuth) return { plugin: false };
  try {
    const info = await BiometricAuth.checkBiometry();
    return { plugin: true, info };
  } catch (e) {
    return { plugin: true, error: String(e?.message || e), code: e?.code };
  }
}

export async function isBiometricAvailable() {
  if (!BiometricAuth) return "none";
  try {
    const info = await BiometricAuth.checkBiometry();
    console.log("[biometric] checkBiometry:", info);
    if (!info?.isAvailable) return "none";
    // v10 BiometryType enum: 1=touchId, 2=faceId,
    // 3=fingerprintAuthentication, 4=faceAuthentication, 5=iris.
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
  if (!BiometricAuth) throw new Error("Biometric no disponible.");
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: "Usar PIN",
      allowDeviceCredential: false,
      iosFallbackTitle: "",
    });
    return true;
  } catch (e) {
    const code = e?.code || "";
    if (code === "userCancel" || code === "appCancel" || code === "systemCancel") {
      return false;
    }
    throw e;
  }
}

export function isBiometricEnabled() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(ENABLED_KEY) === "true";
}

export function setBiometricEnabled(on) {
  if (typeof localStorage === "undefined") return;
  if (on) localStorage.setItem(ENABLED_KEY, "true");
  else localStorage.removeItem(ENABLED_KEY);
}
