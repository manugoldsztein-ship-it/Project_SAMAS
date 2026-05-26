// ============================================================
// useEdgeSwipeBack — iOS-style swipe-from-left-edge back gesture
// ============================================================
// Returns { bind, style } that the consumer spreads onto the outer
// container of a sub-shell. While the gesture is in progress the
// container translates with the finger; if the user releases past
// the threshold we call onBack(); otherwise we snap back to 0.
//
// Why this is imperative (no React state during drag):
//   The previous version called setDx() on every touchmove, which
//   re-rendered the entire sub-shell (Broker / Social are large
//   trees) at 60fps. That fought the touch loop and showed up as
//   choppy frames. We now mutate `el.style.transform` directly via
//   a callback ref — React doesn't see the drag at all, and the
//   browser composites a translate3d on the GPU. Result: buttery
//   60fps even on the heaviest shells.
//
// Tuning knobs:
//   EDGE_PX        max distance from left edge for touchstart to count
//   THRESHOLD_PCT  fraction of viewport width needed to commit the back
//   MAX_DRAG       cap on the visual translation so the shell doesn't
//                  fly off-screen if the user keeps swiping
//   SETTLE_MS      duration of the snap-back / commit animation
// ============================================================

import { useRef, useCallback } from "react";

const EDGE_PX = 28;
const THRESHOLD_PCT = 0.30;
const MAX_DRAG = 320;
const SETTLE_MS = 240;
const EASE = "cubic-bezier(.2,.8,.2,1)";

export function useEdgeSwipeBack(onBack) {
  const elRef = useRef(null);
  const startRef = useRef(null);
  // Latest onBack via ref so the touch handlers don't need to be
  // recreated when the parent passes a fresh callback every render.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  // Callback ref — we get a chance to set up the element when React
  // mounts it. Establishing translate3d up-front promotes the element
  // to its own GPU layer so the first drag frame doesn't cost a
  // layer creation.
  const setEl = useCallback((node) => {
    elRef.current = node;
    if (node) {
      node.style.transform = "translate3d(0,0,0)";
      node.style.willChange = "transform";
    }
  }, []);

  const setX = (x, withTransition) => {
    const el = elRef.current;
    if (!el) return;
    el.style.transition = withTransition ? `transform ${SETTLE_MS}ms ${EASE}` : "none";
    el.style.transform = `translate3d(${x}px,0,0)`;
  };

  const cancel = useCallback(() => {
    startRef.current = null;
    setX(0, true);
  }, []);

  const onTouchStart = useCallback((e) => {
    const t = e.touches?.[0];
    if (!t) return;
    if (t.clientX > EDGE_PX) return;
    startRef.current = { x: t.clientX, y: t.clientY, dx: 0, armed: false };
  }, []);

  const onTouchMove = useCallback((e) => {
    const start = startRef.current;
    if (!start) return;
    const t = e.touches?.[0];
    if (!t) return;
    const ddx = t.clientX - start.x;
    const ddy = Math.abs(t.clientY - start.y);
    // Cancel on dominantly vertical motion (page scroll, not back gesture).
    if (ddy > Math.max(40, ddx)) { cancel(); return; }
    // Cancel on leftward motion.
    if (ddx < 0) { cancel(); return; }
    const dx = Math.min(ddx, MAX_DRAG);
    start.dx = dx;
    // Imperative DOM write — no React re-render. translate3d keeps it
    // on the GPU layer.
    setX(dx, false);
  }, [cancel]);

  const onTouchEnd = useCallback(() => {
    const start = startRef.current;
    if (!start) return;
    const dx = start.dx;
    startRef.current = null;
    const w = (typeof window !== "undefined" ? window.innerWidth : 400) || 400;
    if (dx > w * THRESHOLD_PCT) {
      // Commit: animate fully off-screen, then signal the parent so
      // the sub-shell unmounts. By the time onBack fires, the wallet
      // underneath is fully revealed.
      setX(w, true);
      setTimeout(() => {
        if (onBackRef.current) onBackRef.current();
      }, SETTLE_MS);
    } else {
      // Cancel: snap back to 0 with the same easing.
      setX(0, true);
    }
  }, []);

  const bind = {
    ref: setEl,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: cancel,
  };

  // `style` is kept for API compatibility with the previous version
  // but is now empty — all the visual feedback lives on the element
  // itself, mutated imperatively. Consumers can still spread it
  // without breaking.
  return { bind, style: {} };
}
