// ============================================================
// SAMAS v2 — Shared chrome (TabBar, Sparkline, Pill, Avatar)
// ============================================================
// Components used by every page in the new shell. Kept in their own
// file (not split per-component) because the design treats them as
// one design-system layer — easier to grep and tweak together.
// ============================================================

import React from "react";
import { FONT } from "./theme.js";
import { Ico } from "./icons.jsx";
import { t as tr } from "../lib/i18n.js";

// ----------------------------------------------------------
// Sparkline — single polyline, no axes / labels.
// ----------------------------------------------------------
// Used inside cards next to numeric figures. We auto-scale each
// sparkline to its own min/max so the stroke uses the full vertical
// space — that's why a flat-trending series still looks like a
// proper line, not a hair against the bottom edge.
// ----------------------------------------------------------
export function Sparkline({ data, color, w = 60, h = 22, sw = 1.5 }) {
  if (!data || data.length < 2) return <div style={{ width: w, height: h }}/>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={sw}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Sample sparkline series — used until we wire the real history feed.
export const SAMAS_SPARKS = {
  up:    [4, 5, 4, 6, 5, 7, 6, 8, 7, 9, 10, 11, 10, 12],
  down:  [12, 11, 10, 11, 9, 10, 8, 9, 7, 6, 7, 5, 6, 4],
  flat:  [7, 6, 8, 7, 8, 7, 9, 7, 8, 7, 9, 8, 7, 8],
  bull:  [3, 4, 3, 5, 6, 5, 7, 8, 7, 9, 8, 10, 11, 13],
  bear:  [10, 11, 9, 10, 8, 9, 7, 8, 6, 7, 5, 6, 4, 3],
};

// ----------------------------------------------------------
// SamasTabBar — floating bottom nav with 4 tabs.
// ----------------------------------------------------------
// Sits 12px above the home indicator with a soft drop shadow + 1px
// border so it reads as a card on top of the page content. The active
// tab gets the accent color and a 24x3 indicator bar above its icon.
// Tab labels translate based on the user's chosen language.
// ----------------------------------------------------------
export function SamasTabBar({ tab, setTab, T, bottomInset = 12, lang = "es" }) {
  const tabs = [
    { id: "wallet", label: tr("tab.wallet", lang), ico: Ico.Wallet },
    { id: "broker", label: tr("tab.invest", lang), ico: Ico.Chart  },
    { id: "social", label: tr("tab.social", lang), ico: Ico.Users  },
    { id: "news",   label: tr("tab.news",   lang), ico: Ico.News   },
  ];
  return (
    <div style={{
      position: "absolute",
      left: 12, right: 12,
      // Native iOS gives us a home-indicator zone in safe-area-inset-bottom;
      // we lift the bar above it via the bottomInset prop. On the web preview
      // it's just 12.
      bottom: bottomInset,
      zIndex: 40,
      borderRadius: 28, padding: "10px 8px",
      background: T.surface,
      border: `1px solid ${T.border}`,
      boxShadow: "0 12px 30px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.04) inset",
      display: "flex", justifyContent: "space-around", alignItems: "center",
    }}>
      {tabs.map(t => {
        const active = t.id === tab;
        const TabIco = t.ico;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: "none", border: "none", cursor: "pointer", padding: "6px 10px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            color: active ? T.accent : T.textMute, position: "relative",
            fontFamily: FONT.sans, fontSize: 10, fontWeight: 600, letterSpacing: 0.2,
            transition: "color .15s",
          }}>
            {active && (
              <div style={{
                position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)",
                width: 24, height: 3, borderRadius: 2, background: T.accent,
              }} />
            )}
            <TabIco size={22} sw={active ? 2 : 1.7} />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------
// Pill — small chip, mono font, rounded ends.
// ----------------------------------------------------------
// Used everywhere in the design: deltas, tags, timestamps, "30 días",
// trade chips, etc. Default styling is muted (surfaceHi bg, textMute
// text); pass `color` and `bg` to override for accent / danger
// variants ("+2.34%" green chip, "BUY"/"SELL" trade chip, etc.).
// ----------------------------------------------------------
export function Pill({ children, T, color, bg, style }) {
  return (
    <span style={{
      fontFamily: FONT.mono, fontSize: 10, fontWeight: 600,
      padding: "3px 8px", borderRadius: 999,
      background: bg || T.surfaceHi, color: color || T.textMute,
      letterSpacing: 0.4, whiteSpace: "nowrap",
      display: "inline-block",
      ...(style || {}),
    }}>{children}</span>
  );
}

// ----------------------------------------------------------
// Avatar — circle with initials.
// ----------------------------------------------------------
// We don't support uploaded photos yet — every user gets a colored
// circle with their initials over an `accentInk`-style dark text so
// it works on both light- and dark-tinted color backgrounds.
// ----------------------------------------------------------
export function Avatar({ color, initials, size = 38 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size,
      background: color, display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: FONT.sans, fontWeight: 700, color: "#06170D",
      fontSize: Math.round(size * 0.4), flexShrink: 0,
    }}>{initials}</div>
  );
}

export const initialsOf = (name) => {
  if (!name) return "??";
  return name.trim().split(/\s+/).map(s => s[0]).slice(0, 2).join("").toUpperCase();
};

// ----------------------------------------------------------
// SectionHead — title + optional right-aligned action link.
// ----------------------------------------------------------
// Use above any list/card section. The title uses the display font
// (Inter Tight) at 18px; the action is a textual button in accent
// color. Both `whiteSpace: nowrap` so a long title doesn't push the
// action onto a new line — instead it'll get clipped (which is fine,
// section titles should be short).
// ----------------------------------------------------------
export function SectionHead({ T, title, action, onAction }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "0 4px", gap: 12,
    }}>
      <div style={{
        fontFamily: FONT.display, fontSize: 18, fontWeight: 700,
        color: T.text, letterSpacing: -0.4, whiteSpace: "nowrap",
      }}>{title}</div>
      {action && (
        <button onClick={onAction} style={{
          background: "none", border: "none", color: T.accent, cursor: "pointer",
          fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
          whiteSpace: "nowrap", flexShrink: 0,
        }}>{action}</button>
      )}
    </div>
  );
}

// ----------------------------------------------------------
// ChromeBtn — 40x40 muted icon button (search, bell, filter, etc.)
// ----------------------------------------------------------
// Optional `dot` prop adds a small accent ping in the corner — we use
// it for the bell when there are unread notifications.
// ----------------------------------------------------------
export function ChromeBtn({ T, children, onClick, dot }) {
  return (
    <button onClick={onClick} style={{
      width: 40, height: 40, borderRadius: 12, background: T.surface,
      border: `1px solid ${T.border}`, color: T.text, cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center",
      position: "relative",
    }}>
      {children}
      {dot && (
        <span style={{
          position: "absolute", top: 9, right: 9, width: 7, height: 7,
          borderRadius: "50%", background: T.accent,
          border: `1.5px solid ${T.surface}`,
        }}/>
      )}
    </button>
  );
}

// ----------------------------------------------------------
// Skeleton — shimmering placeholder block while data loads. Used by
// News / Wallet etc. to avoid a flash of "Cargando…" text. Renders
// a div sized to the props and animates a light gradient across it.
// ----------------------------------------------------------
export function Skeleton({ T, width = "100%", height = 14, borderRadius = 8, marginBottom = 0 }) {
  return (
    <div style={{
      width, height, borderRadius, marginBottom,
      background: `linear-gradient(90deg, ${T.surface} 0%, ${T.bgElev} 50%, ${T.surface} 100%)`,
      backgroundSize: "200% 100%",
      animation: "samas-skel 1.4s ease-in-out infinite",
    }}>
      <style>{`
        @keyframes samas-skel {
          0%   { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </div>
  );
}
