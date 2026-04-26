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

  // Splash screen hide is deferred until the app actually has its
  // auth state resolved (see hideNativeSplash in App.jsx). Hiding
  // here on initNative — before React mounts — would show a blank
  // viewport for the 500ms-2s it takes to mount + auth check, which
  // looks like the app is broken. With the splash held until ready,
  // the user goes from logo → real screen with no flash of blank
  // chrome in between.

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

  // Keyboard handling — when the iOS keyboard appears, scroll the
  // focused input into view so it isn't hidden behind the keyboard.
  // The @capacitor/keyboard plugin (configured in capacitor.config.json
  // with resize: body) auto-resizes the webview, but inputs that are
  // already off-screen still need a scroll nudge.
  try {
    document.addEventListener("focusin", (e) => {
      const el = e.target;
      if (!el || !(el.matches?.("input, textarea, select"))) return;
      // Wait one frame so the keyboard has time to start animating
      // before we measure positions.
      setTimeout(() => {
        try {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {}
      }, 50);
    });
  } catch (e) { console.warn("[native] focus handler:", e); }
}

// ----------------------------------------------------------
// Hide the splash screen once the React app is ready. Call from
// the top-level component AFTER auth state resolves so the user
// goes directly from logo to the right screen with no flash of
// blank webview in between.
let _splashHidden = false;
export async function hideNativeSplash() {
  if (_splashHidden) return;
  _splashHidden = true;
  if (!isNative) return;
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch (e) { console.warn("[native] splash hide:", e); }
}

// ----------------------------------------------------------
// Theme update — keep iOS chrome color in sync with app theme.
// ----------------------------------------------------------
// Call whenever the user toggles dark/light mode. Updates:
//   - body + #root background (so safe-area zones match)
//   - StatusBar plugin background (for the OS chrome behind the
//     status bar text on Android; iOS uses overlay so it follows
//     the underlying webview color)
//   - StatusBar text color (Style.Dark = light text on dark bg,
//     Style.Light = dark text on light bg)
export async function updateNativeTheme(isDark) {
  if (typeof document !== "undefined") {
    const bg = isDark ? "#000000" : "#F7F7F5";
    document.documentElement.style.background = bg;
    document.body.style.background = bg;
    const root = document.getElementById("root");
    if (root) root.style.background = bg;
  }
  if (!isNative) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
    if (StatusBar.setBackgroundColor) {
      await StatusBar.setBackgroundColor({ color: isDark ? "#000000" : "#F7F7F5" });
    }
  } catch (e) { console.warn("[native] theme update:", e); }
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
