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
// initKeyboardCSSVar (samas-0.4.68)
// ----------------------------------------------------------
// Setea `--samas-kb-h` en document.documentElement con la altura del
// keyboard cuando se muestra/oculta. El AIChatCard (y cualquier modal
// con input) usa esa variable como bottom para posicionarse arriba del
// keyboard. Es global y se registra una vez al boot — sin race
// conditions con state de React. Si el plugin no carga (web), es no-op.
// ----------------------------------------------------------
let _kbInited = false;
export async function initKeyboardCSSVar() {
  if (_kbInited) return;
  _kbInited = true;
  if (!isNative) return;
  try {
    const { Keyboard } = await import("@capacitor/keyboard");
    const setVar = (h) => {
      document.documentElement.style.setProperty("--samas-kb-h", `${h}px`);
    };
    setVar(0);
    Keyboard.addListener("keyboardWillShow", (info) => {
      // +48 para compensar el QuickType bar que el plugin a veces no
      // incluye en info.keyboardHeight.
      setVar((info?.keyboardHeight || 0) + 48);
    });
    Keyboard.addListener("keyboardDidShow", (info) => {
      setVar((info?.keyboardHeight || 0) + 48);
    });
    Keyboard.addListener("keyboardWillHide", () => setVar(0));
    Keyboard.addListener("keyboardDidHide", () => setVar(0));
  } catch (e) {
    console.warn("[native] keyboard init:", e);
  }
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
// Foreground/background — Capacitor lifecycle bridge.
// ----------------------------------------------------------
// Pass a handler that receives `true` when the app goes to the
// foreground and `false` when it's backgrounded. Returns a cleanup
// function (call on unmount). Outside Capacitor it falls back to
// document.visibilitychange so the same hook works in the web build.
//
// Used by useFinnhubQuotes to suspend the 60s quote poll while the
// app is backgrounded — without this the WebView keeps fetching +
// re-rendering for hours, eventually getting killed by iOS for
// memory pressure.
/**
 * onAppUrlOpen(handler) — fires when iOS routes a deep link
 * (e.g. samas://auth/callback?code=...) back to the app.
 * Used by the OAuth flow (samas-0.1.5) to finish sign-in via
 * supabase.auth.exchangeCodeForSession.
 *
 * Returns a cleanup function. No-ops on the web build.
 */
export function onAppUrlOpen(handler) {
  if (typeof handler !== "function") return () => {};
  if (!isNative) return () => {};
  let canceled = false;
  let listener = null;
  (async () => {
    try {
      const { App } = await import("@capacitor/app");
      if (canceled) return;
      listener = await App.addListener("appUrlOpen", (event) => {
        const url = event?.url || "";
        if (url) handler(url);
      });
    } catch (e) {
      console.warn("[native] appUrlOpen listener failed:", e);
    }
  })();
  return () => {
    canceled = true;
    try { listener?.remove?.(); } catch {}
  };
}

export function onAppStateChange(handler) {
  if (typeof handler !== "function") return () => {};
  let cleanup = () => {};
  if (isNative) {
    let canceled = false;
    let listener = null;
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        if (canceled) return;
        listener = await App.addListener("appStateChange", (state) => {
          handler(!!state?.isActive);
        });
      } catch (e) {
        console.warn("[native] appStateChange listener failed:", e);
      }
    })();
    cleanup = () => {
      canceled = true;
      try { listener?.remove?.(); } catch {}
    };
  } else if (typeof document !== "undefined") {
    const onVis = () => handler(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    cleanup = () => document.removeEventListener("visibilitychange", onVis);
  }
  return cleanup;
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
