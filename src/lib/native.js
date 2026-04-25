// ============================================================
// NATIVE — Capacitor integration helpers
// ============================================================
// Single place where we touch the @capacitor/* packages so the rest
// of the app stays oblivious to whether we're running in a browser
// or wrapped in iOS/Android. Every helper is a no-op when outside
// the native shell, so importing this module is always safe.
//
// What this gives us:
//   - initNative(): once at boot — hides the splash screen, paints
//     the status bar, sets back-button behavior. Call inside a top-
//     level useEffect.
//   - hapticNative(kind): feels-like-native taps when the OS supports
//     it. Falls back to navigator.vibrate in browsers, then a no-op.
//   - isNative: boolean — true when running inside a Capacitor shell.
//
// We avoid top-level await — every Capacitor module is loaded lazily
// the first time a helper is called. Browser-only builds never
// resolve those imports, so the bundle stays small.
// ============================================================

// Detect Capacitor shell synchronously. Capacitor injects window.Capacitor
// when running inside a native app — works before any plugin loads.
export const isNative =
  typeof window !== "undefined" &&
  !!window.Capacitor &&
  typeof window.Capacitor.isNativePlatform === "function" &&
  window.Capacitor.isNativePlatform();

// ----------------------------------------------------------
// Boot — call once at app mount.
// ----------------------------------------------------------
export async function initNative() {
  if (!isNative) return;

  // Hide the splash screen now that React has mounted. Without this
  // the splash stays up until the OS times it out (~30s on iOS).
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch (e) { console.warn("[native] splash hide:", e); }

  // Paint the status bar to match our dark hero so it doesn't sit
  // awkwardly white against the black header.
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    if (StatusBar.setBackgroundColor) {
      await StatusBar.setBackgroundColor({ color: "#0E1A12" });
    }
  } catch (e) { console.warn("[native] statusbar:", e); }

  // Hardware back button — close modals via synthetic Escape rather
  // than exiting the app. iOS doesn't have hardware back; this is
  // mostly here for future Android support.
  try {
    const { App } = await import("@capacitor/app");
    App.addListener("backButton", () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
  } catch (e) { console.warn("[native] backbutton:", e); }
}

// ----------------------------------------------------------
// Haptic — light tactile feedback for button taps.
// ----------------------------------------------------------
// kind: "tap" | "success" | "warning" | "error"
export async function hapticNative(kind = "tap") {
  if (isNative) {
    try {
      const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
      if (kind === "success") return Haptics.notification({ type: NotificationType.Success });
      if (kind === "warning") return Haptics.notification({ type: NotificationType.Warning });
      if (kind === "error")   return Haptics.notification({ type: NotificationType.Error });
      return Haptics.impact({ style: ImpactStyle.Light });
    } catch {}
  }
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    if (kind === "success")      navigator.vibrate([10, 30, 10]);
    else if (kind === "warning") navigator.vibrate([20, 40, 20]);
    else if (kind === "error")   navigator.vibrate([50, 50, 50]);
    else                         navigator.vibrate(8);
  }
}
