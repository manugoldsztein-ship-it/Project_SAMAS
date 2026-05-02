import React from "react";
import { createRoot } from "react-dom/client";
import SAMASApp from "./App.jsx";
import { initNative } from "./lib/native.js";
import { initDynamicType } from "./lib/dynamicType.jsx";
import { initErrorTracking, captureException } from "./lib/errorTracking.js";

// Initialize Sentry FIRST — before anything else can throw. samas-0.4.32.
// No-op when VITE_SENTRY_DSN is unset (default for dev / web preview).
// See src/lib/errorTracking.js for setup instructions.
initErrorTracking();

// Boot Capacitor integrations as soon as the script loads. No-op on
// the web — only does work when running inside the iOS/Android wrap.
// Fire-and-forget; we don't block the React render on it.
initNative();

// iOS Dynamic Type bridge (samas-0.4.20). Reads the scale that
// AppDelegate.swift pushed into window.__SAMAS_TYPE_SCALE__ and
// applies it via CSS zoom on document.body. No-op on web.
initDynamicType();

// Demo-reset hook: ?reset=1 wipes all SAMAS-persisted state before the app
// mounts (holdings, orders, balance, watchlists, plan, tutorial flag, etc.).
// Useful for recording a clean demo.
try {
  const params = new URLSearchParams(window.location.search);
  if (params.get("reset") === "1" || params.get("fresh") === "1") {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("samas_")) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    // Strip the query param so a page refresh doesn't keep re-resetting.
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState(null, "", clean);
  }
} catch {}

// Root-level error boundary. If anything throws during render (auth hook
// failing, import error, etc.) we show a visible fallback instead of a
// silent black screen — much easier to diagnose from a screenshot.
class RootBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[SAMAS] Root render error:", error, info);
    // Ship to Sentry too (samas-0.4.32). componentStack is the React
    // tree path that crashed — invaluable for diagnosis.
    captureException(error, {
      componentStack: info?.componentStack || null,
      where: "RootBoundary",
    });
  }
  render() {
    if (this.state.error) {
      return React.createElement(
        "div",
        {
          style: {
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            color: "#F7F7F5",
            background: "#0D1117",
            minHeight: "100vh",
            lineHeight: 1.5,
          },
        },
        React.createElement("h1", { style: { fontSize: 20, color: "#E05555", margin: 0, marginBottom: 8 } }, "SAMAS no pudo arrancar"),
        React.createElement("p", { style: { fontSize: 13, color: "#9CA3AF", marginBottom: 16 } }, "Algo falló durante la carga inicial. Abrí la consola del browser (F12 → Console) y copiame el error rojo."),
        React.createElement("pre", { style: { background: "#161B22", color: "#E05555", padding: 12, borderRadius: 8, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflow: "auto" } }, String(this.state.error?.stack || this.state.error)),
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  React.createElement(RootBoundary, null, React.createElement(SAMASApp))
);
