// ============================================================
// SAMAS v2 — Toast system
// ============================================================
// Tiny pub/sub-based toaster. Anywhere in the app you can call
//
//   import { toast } from "./toast.jsx";
//   toast("Plan copiado al portapapeles.", { type: "success" });
//
// The <ToastHost T={T}/> component (mounted once at shell level)
// subscribes to the queue and renders an animated stack at the top
// of the screen, below the safe-area inset.
//
// Types: "info" | "success" | "error"
// ============================================================

import React, { useEffect, useState } from "react";
import { FONT } from "./theme.js";

const listeners = [];
let nextId = 1;

export function toast(message, opts = {}) {
  const id = nextId++;
  const t = {
    id,
    message: String(message || ""),
    type: opts.type || "info",
    duration: opts.duration || 3000,
  };
  listeners.forEach((fn) => fn({ kind: "add", toast: t }));
  setTimeout(() => {
    listeners.forEach((fn) => fn({ kind: "remove", id }));
  }, t.duration);
  return id;
}

// Convenience helpers
toast.success = (m, o = {}) => toast(m, { ...o, type: "success" });
toast.error = (m, o = {}) => toast(m, { ...o, type: "error" });
toast.info = (m, o = {}) => toast(m, { ...o, type: "info" });

function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// ----------------------------------------------------------
// ToastHost — mount once at shell level. Listens to the queue and
// renders the stack with slide-in / slide-out animation.
// ----------------------------------------------------------
export function ToastHost({ T }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    return subscribe((evt) => {
      if (evt.kind === "add") {
        setItems((cur) => [...cur, evt.toast]);
      } else {
        setItems((cur) => cur.filter((t) => t.id !== evt.id));
      }
    });
  }, []);

  if (items.length === 0) return null;

  return (
    <div style={{
      position: "fixed",
      top: "calc(env(safe-area-inset-top) + 12px)",
      left: 0, right: 0,
      zIndex: 9000,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
      pointerEvents: "none",
      padding: "0 16px",
    }}>
      <style>{`
        @keyframes samas-toast-in {
          from { opacity: 0; transform: translateY(-12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {items.map((t) => (
        <ToastItem key={t.id} toast={t} T={T} />
      ))}
    </div>
  );
}

function ToastItem({ toast, T }) {
  const palette = {
    success: { bg: T.accentSoft, fg: T.accent, border: T.accent },
    error:   { bg: T.dangerSoft, fg: T.danger, border: T.danger },
    info:    { bg: T.surface,    fg: T.text,   border: T.border },
  }[toast.type] || { bg: T.surface, fg: T.text, border: T.border };

  return (
    <div style={{
      maxWidth: 540, width: "100%",
      padding: "12px 16px", borderRadius: 14,
      background: palette.bg, color: palette.fg,
      border: `1px solid ${palette.border}55`,
      boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
      backdropFilter: "blur(8px)",
      pointerEvents: "auto",
      fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
      animation: "samas-toast-in 220ms cubic-bezier(.2,.8,.2,1)",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      {/* Icon by type */}
      <span style={{
        width: 22, height: 22, borderRadius: 6,
        background: palette.fg, color: palette.bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        {toast.type === "success" && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        )}
        {toast.type === "error" && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        )}
        {toast.type === "info" && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="8" x2="12" y2="13"/>
            <line x1="12" y1="16" x2="12" y2="16.01"/>
          </svg>
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{toast.message}</div>
    </div>
  );
}
