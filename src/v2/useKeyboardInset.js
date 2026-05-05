// useKeyboardInset (samas-0.4.55)
//
// Returns the height (in CSS pixels) currently covered by the on-screen
// keyboard. Backed by VisualViewport, which iOS WKWebView exposes too —
// so this works inside Capacitor + Safari + desktop Chrome.
//
// Why this exists: the AporteModal and ModalShell anchor their sheet to
// `flex-end` of a `position: fixed; inset: 0` wrapper. With Capacitor's
// `Keyboard.resize: "body"` (capacitor.config.json), the body shrinks
// when the keyboard opens but `position: fixed` still references the
// full visual viewport — so the sheet ends up behind the keyboard.
// Apply this hook's value as `bottom` on the wrapper and the sheet
// rides up above the keyboard automatically.
//
// 0.4.50 + 0.4.54 tried to fix this with `dvh` and a focus-defer trick;
// both still left the form covered on iPhone. This is the proper fix.

import { useEffect, useState } from "react";

export function useKeyboardInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    const onResize = () => {
      const overlap = window.innerHeight - vv.height - vv.offsetTop;
      setInset(Math.max(0, Math.round(overlap)));
    };

    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    onResize();

    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, []);

  return inset;
}
