// ============================================================
// dynamicType.jsx (samas-0.4.20) — iOS Dynamic Type ↔ web bridge
// ============================================================
// Manuel showed me a screenshot of the Control Center text-size
// slider and asked us to be compatible. Native UIKit apps respond
// automatically; web apps inside a WKWebView don't, because our
// font sizes are explicit pixel values that ignore the system
// scale.
//
// HOW IT WORKS
//
//   1. The native side (ios/App/App/AppDelegate.swift) reads
//      UIApplication.shared.preferredContentSizeCategory at:
//        - app launch
//        - app foreground (settings change while backgrounded)
//        - UIContentSizeCategoryDidChangeNotification (Control
//          Center slider dragged while foreground)
//      It maps the category to a numeric multiplier (0.85 for
//      XS, 1.00 for default, up to 2.00 for AX5) and pushes to
//      JS via webView.evaluateJavaScript that sets
//      window.__SAMAS_TYPE_SCALE__ + dispatches a CustomEvent.
//
//   2. This module:
//        - Reads window.__SAMAS_TYPE_SCALE__ on init (default 1.0)
//        - Subscribes to "samas:type-scale-changed" events
//        - Applies the scale via CSS `zoom` on document.documentElement
//
//   3. CSS zoom is the only sane way to scale a px-based React
//      tree without rewriting every fontSize literal. WebKit
//      supports it natively. It scales fonts, padding, layout,
//      and SVG icons proportionally. Floating elements with
//      position:absolute/fixed continue to anchor correctly
//      because zoom acts on the layout box, not transform.
//
// FALLBACK BEHAVIOUR
//   - On web (no Capacitor / no native bridge): scale stays at 1.0.
//   - If the bridge fails for any reason: scale stays at 1.0, app
//     renders at default size (same as today).
//
// EXTENSION POINT
//   `subscribeToTypeScale(callback)` lets a UI surface react to
//   the scale (e.g. show a "AA" indicator in Settings). Most
//   components shouldn't need to subscribe — the CSS zoom
//   handles them automatically.
// ============================================================

let _currentScale = 1.0;
const _listeners = new Set();

// Read the initial value the native bridge may have already pushed.
// On web this is undefined → default 1.0.
function readInitialScale() {
  try {
    const v = typeof window !== "undefined" ? window.__SAMAS_TYPE_SCALE__ : null;
    if (typeof v === "number" && isFinite(v) && v >= 0.5 && v <= 3.0) return v;
  } catch (_e) { /* ignore */ }
  return 1.0;
}

function applyScale(scale) {
  _currentScale = scale;
  if (typeof document === "undefined") return;
  // Use CSS variable so consumers that want explicit calc(N * var(--samas-type-scale))
  // can opt in. The zoom on the root element is the broad-stroke fallback.
  try {
    document.documentElement.style.setProperty("--samas-type-scale", String(scale));
    // Apply zoom on body (not html) so iOS safe-area insets on html
    // stay accurate. Scale of 1 = no zoom; we still set explicitly
    // to overwrite a previous larger value when the user drags down.
    document.body.style.zoom = String(scale);
  } catch (_e) { /* ignore */ }
}

export function getTypeScale() {
  return _currentScale;
}

export function subscribeToTypeScale(callback) {
  _listeners.add(callback);
  return () => _listeners.delete(callback);
}

export function initDynamicType() {
  if (typeof window === "undefined") return;
  // Apply whatever scale the native bridge already pushed (or 1.0).
  applyScale(readInitialScale());
  // Listen for live changes (Control Center slider while
  // foreground) and foreground-resume re-pushes from
  // applicationDidBecomeActive.
  window.addEventListener("samas:type-scale-changed", (e) => {
    const next = e?.detail?.scale;
    if (typeof next !== "number" || !isFinite(next)) return;
    if (next < 0.5 || next > 3.0) return; // sanity clamp
    applyScale(next);
    for (const cb of _listeners) {
      try { cb(next); } catch (_e) { /* ignore */ }
    }
  });
}
