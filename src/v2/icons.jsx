// ============================================================
// SAMAS v2 — Inline SVG icon set (from design_handoff/icons.jsx)
// ============================================================
// Stroke-based 24x24 icons. Each one is a single-path SVG so we can
// pass `stroke` through unchanged. Default `currentColor` so the icon
// inherits whatever color the parent text has — that's how we get
// the active-tab accent color and the muted-tab textMute color from
// the tab bar without per-icon prop drilling.
// ============================================================

import React from "react";

const Icon = ({ d, size = 20, stroke = "currentColor", sw = 1.7, fill = "none" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
       strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export const Ico = {
  Wallet: (p) => <Icon d="M3 7v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2zm0 0a2 2 0 0 1 2-2h12M17 14h.01" {...p}/>,
  Chart:  (p) => <Icon d="M3 21V5m0 16h18M7 17v-6m4 6V9m4 8v-4m4 4V7" {...p}/>,
  Users:  (p) => <Icon d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" {...p}/>,
  News:   (p) => <Icon d="M4 5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zm0 0v14a2 2 0 0 0 2 2M8 7h7M8 11h7M8 15h4" {...p}/>,
  Send:   (p) => <Icon d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" {...p}/>,
  Recv:   (p) => <Icon d="M12 5v14m0 0l-7-7m7 7l7-7" {...p}/>,
  Add:    (p) => <Icon d="M12 5v14M5 12h14" {...p}/>,
  Search: (p) => <Icon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2l-4.35-4.35" {...p}/>,
  Bell:   (p) => <Icon d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" {...p}/>,
  Eye:    (p) => <Icon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" {...p}/>,
  EyeOff: (p) => <Icon d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A10 10 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12A3 3 0 1 1 9.88 9.88M1 1l22 22" {...p}/>,
  Up:     (p) => <Icon d="M7 17l10-10M7 7h10v10" {...p}/>,
  Down:   (p) => <Icon d="M17 7l-10 10M17 17H7V7" {...p}/>,
  Repeat: (p) => <Icon d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" {...p}/>,
  Heart:  (p) => <Icon d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" {...p}/>,
  Comment:(p) => <Icon d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" {...p}/>,
  Bookmark:(p)=> <Icon d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" {...p}/>,
  Trend:  (p) => <Icon d="M23 6l-9.5 9.5-5-5L1 18M17 6h6v6" {...p}/>,
  Fire:   (p) => <Icon d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.4-2.6 0-5.6 2-7 .5 2.5 2 4.5 4 6 2 1.5 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.5.5-3 1.5-4.5.4 1.7 1.5 3 3 3.5z" {...p}/>,
  Back:   (p) => <Icon d="M19 12H5m7 7l-7-7 7-7" {...p}/>,
  Star: (p) => <Icon d="M12 2l3.1 6.3 7 1-5 4.9 1.1 7-6.2-3.3-6.2 3.3 1.1-7-5-4.9 7-1L12 2z" {...p}/>,
  List: (p) => <Icon d="M3 6h18M3 12h18M3 18h18" {...p}/>,
  Briefcase: (p) => <Icon d="M3 7h18v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7zm5-4h8a2 2 0 0 1 2 2v2H6V5a2 2 0 0 1 2-2zM3 13h18" {...p}/>,
  Sun:  (p) => <Icon d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" {...p}/>,
  Moon: (p) => <Icon d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" {...p}/>,
  // SAMAS brand mark — two open Cs forming an "S" with a green dot
  // in the middle gap. Matches the company logo. The animated variant
  // lives in SamasLogo.jsx; this one is the static version used in
  // chrome (headers, splash, etc.).
  Logo: ({ size = 28, color = "currentColor", dotColor = "#22C55E" }) => (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path
        d="M 71.66 34.18 A 22 22 0 1 0 53.82 59.66"
        stroke={color} strokeWidth="11"
        strokeLinecap="round" strokeLinejoin="round"
      />
      <path
        d="M 28.34 65.82 A 22 22 0 1 0 46.18 40.34"
        stroke={color} strokeWidth="11"
        strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="50" cy="50" r="7" fill={dotColor}/>
    </svg>
  ),
};
