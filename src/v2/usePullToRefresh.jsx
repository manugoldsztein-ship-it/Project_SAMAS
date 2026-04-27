// ============================================================
// usePullToRefresh — iOS-style pull-down-from-top to refresh
// ============================================================
// Returns { bind, indicator } you spread onto a scrollable container.
// `indicator` is a node you render at the very top of the scroll
// content; it shows a circular progress arc that fills as the user
// pulls past the threshold.
//
// Usage:
//   const { bind, indicator } = usePullToRefresh(refresh);
//   <div {...bind} style={{ overflowY: "auto" }}>
//     {indicator}
//     ...content...
//   </div>
//
// The hook only arms when the scroll container is at scrollTop=0,
// matching iOS native: you have to be at the very top to "pull".
// ============================================================

import React, { useRef, useState, useCallback } from "react";

const TRIGGER_PX = 70;   // pull distance (px) needed to fire
const MAX_PX = 110;      // cap on visual indicator size

export function usePullToRefresh(onRefresh) {
  const [pull, setPull] = useState(0);   // current pull distance (visual)
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const scrollEl = useRef(null);

  const onTouchStart = useCallback((e) => {
    if (refreshing) return;
    const el = e.currentTarget;
    scrollEl.current = el;
    if (el.scrollTop > 0) return;
    const t = e.touches?.[0];
    if (!t) return;
    startY.current = t.clientY;
  }, [refreshing]);

  const onTouchMove = useCallback((e) => {
    if (refreshing || startY.current == null) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dy = t.clientY - startY.current;
    if (dy <= 0) {
      setPull(0);
      return;
    }
    // Apply diminishing returns past the trigger so it feels
    // tensioned — same as iOS native.
    const eased = dy < TRIGGER_PX ? dy : TRIGGER_PX + (dy - TRIGGER_PX) * 0.4;
    setPull(Math.min(eased, MAX_PX));
  }, [refreshing]);

  const onTouchEnd = useCallback(async () => {
    if (refreshing) return;
    const passed = pull >= TRIGGER_PX;
    startY.current = null;
    if (passed) {
      setRefreshing(true);
      setPull(TRIGGER_PX);
      try { await Promise.resolve(onRefresh && onRefresh()); }
      catch {}
      setRefreshing(false);
      setPull(0);
    } else {
      setPull(0);
    }
  }, [pull, refreshing, onRefresh]);

  const bind = { onTouchStart, onTouchMove, onTouchEnd };

  // Visual: a centered spinner that grows / spins as the user pulls.
  const ratio = Math.min(pull / TRIGGER_PX, 1);
  const spinning = refreshing;
  const indicator = (pull > 0 || refreshing) ? (
    <div style={{
      height: pull,
      display: "flex", alignItems: "center", justifyContent: "center",
      transition: refreshing || startY.current == null ? "height 220ms cubic-bezier(.2,.8,.2,1)" : "none",
      overflow: "hidden",
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 999,
        border: "2px solid rgba(255,255,255,0.18)",
        borderTopColor: "rgba(34,197,94,0.95)",
        transform: spinning ? undefined : `rotate(${ratio * 360}deg)`,
        animation: spinning ? "samas-ptr-spin 700ms linear infinite" : "none",
        opacity: Math.max(0.3, ratio),
      }} />
      <style>{`
        @keyframes samas-ptr-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  ) : null;

  return { bind, indicator, refreshing };
}
