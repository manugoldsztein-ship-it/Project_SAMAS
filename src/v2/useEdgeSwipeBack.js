// ============================================================
// useEdgeSwipeBack — iOS-style swipe-from-left-edge back gesture
// ============================================================
// Returns { bind, style } you spread onto the outer container of a
// sub-shell. While the gesture is in progress the container
// translates with the finger; if the user releases past the threshold
// we call onBack(); otherwise we snap back to 0 with a transition.
//
// Tuning knobs:
//   EDGE_PX        max distance from left edge for touchstart to count
//   THRESHOLD_PCT  fraction of viewport width needed to commit the back
//   MAX_DRAG       cap on the visual translation so the shell doesn't
//                  fly off-screen if the user keeps swiping
// ============================================================

import { useRef, useState, useCallback } from "react";

const EDGE_PX = 28;
const THRESHOLD_PCT = 0.30;
const MAX_DRAG = 280;

export function useEdgeSwipeBack(onBack) {
  // Live drag distance during the gesture; null when idle.
  const [dx, setDx] = useState(null);
  const startRef = useRef(null);

  const onTouchStart = useCallback((e) => {
    const t = e.touches?.[0];
    if (!t) return;
    // Only arm the gesture when the touch starts within EDGE_PX of
    // the left side. Past that we leave the touch alone so it can be
    // a regular tap / scroll on whatever element is under the finger.
    if (t.clientX > EDGE_PX) return;
    startRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    setDx(0);
  }, []);

  const onTouchMove = useCallback((e) => {
    const start = startRef.current;
    if (!start) return;
    const t = e.touches?.[0];
    if (!t) return;
    const ddx = t.clientX - start.x;
    const ddy = Math.abs(t.clientY - start.y);
    // Cancel the gesture if the user is moving mostly vertically (it's
    // a scroll, not a back swipe).
    if (ddy > Math.max(40, ddx)) {
      startRef.current = null;
      setDx(null);
      return;
    }
    if (ddx < 0) {
      // Moved leftward — not a back gesture. Cancel.
      startRef.current = null;
      setDx(null);
      return;
    }
    setDx(Math.min(ddx, MAX_DRAG));
  }, []);

  const finish = useCallback(() => {
    const start = startRef.current;
    if (!start) return;
    const finalDx = dx ?? 0;
    startRef.current = null;
    const w = (typeof window !== "undefined" ? window.innerWidth : 400) || 400;
    if (finalDx > w * THRESHOLD_PCT) {
      // Commit: animate to off-screen then call onBack so the next
      // shell renders cleanly.
      setDx(w);
      setTimeout(() => {
        setDx(null);
        if (onBack) onBack();
      }, 180);
    } else {
      // Cancel: snap back.
      setDx(null);
    }
  }, [dx, onBack]);

  const onTouchEnd = useCallback(() => { finish(); }, [finish]);
  const onTouchCancel = useCallback(() => {
    startRef.current = null;
    setDx(null);
  }, []);

  // Visual feedback. While dragging we translate the container with
  // no transition so the motion tracks the finger; on release we add
  // a snappy transition back to 0 (or off-screen if committing).
  const dragging = dx != null;
  const style = dragging ? {
    transform: `translateX(${dx}px)`,
    transition: startRef.current
      ? "none"
      : "transform 180ms cubic-bezier(.2,.8,.2,1)",
    willChange: "transform",
  } : {
    transform: "translateX(0)",
    transition: "transform 180ms cubic-bezier(.2,.8,.2,1)",
  };

  const bind = { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };

  return { bind, style };
}
