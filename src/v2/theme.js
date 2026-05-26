// ============================================================
// SAMAS v2 — Design tokens (from design_handoff README)
// ============================================================
// New theme system for the Wallet-first shell. Lives alongside the
// existing C palette in App.jsx so we can roll it out screen-by-screen
// without breaking what already works.
//
// Why a new file: the old palette was built around the trading-app
// look (navy / cream / gold). The Wallet design uses a cooler base
// (#08090A) with a punchier oklch green accent and three font families
// (Inter / Inter Tight / JetBrains Mono). Mixing them inside a single
// constant would be confusing — keep them separate, pick at the page
// level.
//
// Color names match the README exactly so you can grep across the
// spec and the code.
// ============================================================

export const SAMAS_THEME = {
  dark: {
    bg: "#08090A",
    bgElev: "#0F1110",
    surface: "#161917",
    surfaceHi: "#1D211E",
    border: "rgba(255,255,255,0.08)",
    borderHi: "rgba(255,255,255,0.14)",
    text: "#F4F6F4",
    textMute: "rgba(244,246,244,0.62)",
    textDim: "rgba(244,246,244,0.38)",
    accent: "oklch(0.82 0.20 145)",
    accentDim: "oklch(0.62 0.16 145)",
    accentSoft: "oklch(0.30 0.10 145 / 0.35)",
    accentInk: "#06170D",
    danger: "oklch(0.70 0.20 25)",
    dangerSoft: "oklch(0.35 0.12 25 / 0.30)",
    warn: "oklch(0.82 0.16 80)",
    chart: "oklch(0.82 0.20 145)",
    isDark: true,
  },
  light: {
    bg: "#F4F6F3",
    bgElev: "#FAFBF9",
    surface: "#FFFFFF",
    surfaceHi: "#F0F2EE",
    border: "rgba(8,9,10,0.08)",
    borderHi: "rgba(8,9,10,0.14)",
    text: "#08090A",
    textMute: "rgba(8,9,10,0.62)",
    textDim: "rgba(8,9,10,0.40)",
    accent: "oklch(0.55 0.17 145)",
    accentDim: "oklch(0.45 0.14 145)",
    accentSoft: "oklch(0.85 0.10 145 / 0.55)",
    accentInk: "#FFFFFF",
    danger: "oklch(0.55 0.20 25)",
    dangerSoft: "oklch(0.92 0.06 25)",
    warn: "oklch(0.65 0.16 80)",
    chart: "oklch(0.55 0.17 145)",
    isDark: false,
  },
};

// Three font stacks. Sora (the old display font) is gone — the
// design uses Inter Tight for display, Inter for UI body, and
// JetBrains Mono for any tabular numeric (balances, prices, codes).
// All three are pulled from Google Fonts via @import in main.jsx.
export const FONT = {
  sans: '"Inter", -apple-system, system-ui, sans-serif',
  display: '"Inter Tight", -apple-system, system-ui, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", ui-monospace, monospace',
};

// Money formatting per the spec: ARS prints whole pesos with es-AR
// thousands separator (`$1.245.000`); USD prints two decimals
// (`US$4,218.42`). Always combine with `fontVariantNumeric:
// 'tabular-nums'` so values line up under each other in lists.
export const fmtMoney = (n, ccy = "ARS") => {
  const opts = ccy === "USD"
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { minimumFractionDigits: 0, maximumFractionDigits: 0 };
  return Number(n || 0).toLocaleString("es-AR", opts);
};

export const fmtPct = (n) => `${n >= 0 ? "+" : ""}${Number(n || 0).toFixed(2)}%`;
