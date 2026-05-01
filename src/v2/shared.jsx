// ============================================================
// SAMAS v2 — Shared chrome (TabBar, Sparkline, Pill, Avatar)
// ============================================================
// Components used by every page in the new shell. Kept in their own
// file (not split per-component) because the design treats them as
// one design-system layer — easier to grep and tweak together.
// ============================================================

import React, { useState, useMemo, useEffect } from "react";
import { FONT } from "./theme.js";
import { Ico } from "./icons.jsx";
import { t as tr } from "../lib/i18n.js";
import { hapticNative } from "../lib/native.js";

// ----------------------------------------------------------
// useShellEntryDone — drops the GPU compositing layer after a
// shell's entry animation completes (samas-0.0.87).
// ----------------------------------------------------------
// On iOS WebKit, `animation: ... translateX(...)` promotes the
// element to a persistent compositing layer that behaves like a
// stacking context — ANY position:fixed descendant gets trapped
// inside it and can't escape past sibling z-index 40 chrome (like
// the floating bottom nav). The fix: after the animation duration
// elapses, swap `animation` to "none" so the browser drops the
// compositing layer. After that, position:fixed children render
// against the document root and cover the nav as expected.
//
// Usage:
//   const entryDone = useShellEntryDone(260);
//   <div style={{
//     animation: entryDone ? "none" : "samas-shell-in 240ms ...",
//   }}>
// ----------------------------------------------------------
export function useShellEntryDone(durationMs = 260) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDone(true), durationMs);
    return () => clearTimeout(t);
  }, []);
  return done;
}

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
  // Closed polygon for the fill: stroke path + line down to bottom-
  // right corner + line to bottom-left + close. Gives the
  // Apple-Stocks area-chart look (subtle gradient fading from the
  // line color to transparent toward the bottom).
  const areaPts = `${pts} ${w.toFixed(1)},${h.toFixed(1)} 0.0,${h.toFixed(1)}`;
  // Unique id per gradient instance — derived from the color hex
  // so we don't render N <defs> for the same color, but stable
  // across re-renders. SVG <defs> with the same id are harmless
  // duplicates as long as the gradient definition matches.
  const gradId = `samas-spark-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
  // Note: a dashed open-price reference line was added in 0.0.68 and
  // pulled in 0.0.69 — looked too busy on small thumbnails.
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={sw}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Sample sparkline series — used by the wallet hero + any future
// surface that doesn't yet have real history data wired up. Per-asset
// rendering uses sparkSeriesFor() below instead so the same row in
// Mercado / Portafolio / Watchlist always lands on the same shape.
export const SAMAS_SPARKS = {
  up:    [4, 5, 4, 6, 5, 7, 6, 8, 7, 9, 10, 11, 10, 12],
  down:  [12, 11, 10, 11, 9, 10, 8, 9, 7, 6, 7, 5, 6, 4],
  flat:  [7, 6, 8, 7, 8, 7, 9, 7, 8, 7, 9, 8, 7, 8],
  bull:  [3, 4, 3, 5, 6, 5, 7, 8, 7, 9, 8, 10, 11, 13],
  bear:  [10, 11, 9, 10, 8, 9, 7, 8, 6, 7, 5, 6, 4, 3],
};

// ----------------------------------------------------------
// ASSET IDENTITY — shared logo / fallback / spark / normalizer
// ----------------------------------------------------------
// One source of truth for "this is what an asset looks like in a row."
// Used by Mercado, Portafolio, Watchlist, the AssetSheet header, the
// Compare sheet, and the watchlist add-asset picker — every place
// that previously had its own ad-hoc tile + ticker.slice(0,4) tile
// rendering with a category color that always fell through to gray
// because the source data uses `cat`, not `category`.
// ----------------------------------------------------------

// Stable color palette for the initials fallback. We hash the ticker
// to pick one — that way GGAL is always the same blue, AAPL is always
// the same orange, etc. A user opening Portafolio + Mercado side by
// side sees matching tiles for the same row. Used only when the asset
// has no category set; assets with a known category use
// CATEGORY_PALETTES below so the fallback color encodes the kind of
// asset (Acciones=green, CEDEAR=blue, Crypto=orange, etc.) instead of
// being arbitrary.
const FALLBACK_PALETTE = [
  "#3B82F6", "#16C784", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
];

// Per-category palettes for the fallback tile. Each category gets a
// small spread of hues in the same family so two CEDEARs sit next to
// each other in different shades of blue, making them distinguishable
// without breaking the "this kind of asset is blue" mental model.
//
// Keys cover both the source-data shape (raw `cat`: "Acciones",
// "CEDEAR", "Crypto", "ETF", "Commodity") and the legacy uppercase
// keys ("ACCION", "CEDEAR", "CRYPTO", "ETF", "COMMOD", "BONO") so
// the function lands on a palette regardless of which name the
// caller passed.
const CATEGORY_PALETTES = {
  // Acciones argentinas — green family.
  "Acciones":  ["#16C784", "#10B981", "#059669"],
  "ACCION":    ["#16C784", "#10B981", "#059669"],
  // CEDEARs — blue family.
  "CEDEAR":    ["#2563EB", "#3B82F6", "#1D4ED8"],
  // Crypto — bitcoin-orange family.
  "Crypto":    ["#F7931A", "#F59E0B", "#D97706"],
  "CRYPTO":    ["#F7931A", "#F59E0B", "#D97706"],
  // ETFs — violet family.
  "ETF":       ["#7C3AED", "#8B5CF6", "#6D28D9"],
  // Commodities — gold family.
  "Commodity": ["#C9A84C", "#D4AF37", "#B45309"],
  "COMMOD":    ["#C9A84C", "#D4AF37", "#B45309"],
  // Bonds — sky family.
  "Bono":      ["#0EA5E9", "#06B6D4", "#0284C7"],
  "BONO":      ["#0EA5E9", "#06B6D4", "#0284C7"],
};

// FNV-1a 32-bit. Cheap, deterministic, no deps. Used for both the
// fallback color picker and the sparkline RNG seed.
function hashTicker(s) {
  let h = 2166136261 >>> 0;
  const t = String(s || "");
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Mulberry32 PRNG — deterministic 32-bit seeded. Same ticker → same
// random walk every render so the sparkline doesn't shimmer between
// re-renders.
function mulberry32(seed) {
  return function() {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * normalizeAsset(raw) — accept either of the legacy field shapes
 * (`cat` or `category`, `change` or `changePct`) and return one
 * canonical object. The renderer never has to know which shape the
 * caller had. Pass-through for everything else so existing fields
 * (price, currency, logo, etc.) stay intact.
 */
export function normalizeAsset(raw) {
  if (!raw) return null;
  const category = raw.category ?? raw.cat ?? null;
  const changePct = typeof raw.changePct === "number" ? raw.changePct
                  : typeof raw.change === "number" ? raw.change
                  : 0;
  return { ...raw, category, changePct };
}

/**
 * sparkSeriesFor(asset, n) — deterministic per-asset 1-month sparkline
 * data. Endpoint is biased toward the asset's `changePct` (or `change`)
 * so a -3% asset's line ends below where it started; noise scales
 * with that magnitude. Same ticker + same changePct always returns
 * the exact same series — no shimmer between re-renders.
 *
 * Returns 16 floats; pass to <Sparkline data={...}/>.
 */
export function sparkSeriesFor(asset, n = 16) {
  const ticker = asset?.ticker || "?";
  const changePct = Number(
    asset?.changePct ?? asset?.change ?? asset?.chg1m ?? 0
  );
  const rng = mulberry32(hashTicker(ticker));
  const target = changePct / 100;
  // Floor the noise so flat assets still draw a recognizable line.
  const noiseAmp = Math.max(Math.abs(target) * 1.4, 0.006);
  const out = [];
  let drift = 0;
  for (let i = 0; i < n; i++) {
    const progress = i / (n - 1);
    drift += (rng() - 0.5) * noiseAmp;
    out.push(100 * (1 + target * progress + drift));
  }
  return out;
}

/**
 * AssetLogo — `<img>` of the brand logo (Clearbit URLs in our ASSETS
 * table) with a deterministic initials fallback when the URL is
 * missing or 404s. The container is a white card so colored or
 * partially-transparent PNGs stay legible on both dark and light
 * themes — same pattern Robinhood / Cocos use.
 *
 * Props:
 *   asset  { ticker, logo? }
 *   size   pixel side length (default 40)
 *   T      theme object (border color)
 */
export function AssetLogo({ asset, size = 40, T }) {
  const [failed, setFailed] = useState(false);
  const ticker = asset?.ticker || "?";
  const logoUrl = asset?.logo;
  const radius = Math.round(size * 0.3);

  if (logoUrl && !failed) {
    return (
      <div style={{
        width: size, height: size, borderRadius: radius,
        background: "#ffffff",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, overflow: "hidden",
        border: T?.border ? `1px solid ${T.border}` : "none",
      }}>
        <img
          src={logoUrl}
          alt={ticker}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{
            width: size - 10, height: size - 10,
            objectFit: "contain",
          }}
        />
      </div>
    );
  }

  // Deterministic fallback. If the asset has a category, pick from
  // that family's palette so the color encodes the kind of asset
  // (CEDEAR=blue, Acciones=green, Crypto=orange, …) — same mental
  // model as the deleted CATEGORY_TILES dict but actually wired up
  // this time and using a richer palette. If the category is
  // unknown, fall back to the legacy ticker-hash palette.
  const cat = asset?.category ?? asset?.cat;
  const palette = CATEGORY_PALETTES[cat] || FALLBACK_PALETTE;
  const bg = palette[hashTicker(ticker) % palette.length];
  const initials = ticker.slice(0, Math.min(3, ticker.length));
  return (
    <div style={{
      width: size, height: size, borderRadius: radius,
      background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#ffffff",
      fontFamily: FONT.mono,
      fontSize: Math.max(9, Math.round(size * 0.28)),
      fontWeight: 800, letterSpacing: 0.5,
      flexShrink: 0,
    }}>{initials}</div>
  );
}

// useMemo'd sparkline — wraps Sparkline for callers that want
// per-asset deterministic history without recomputing every render.
export function AssetSparkline({ asset, color, w = 50, h = 20, sw = 1.5 }) {
  const data = useMemo(
    () => sparkSeriesFor(asset),
    [asset?.ticker, asset?.changePct, asset?.change, asset?.chg1m],
  );
  return <Sparkline data={data} color={color} w={w} h={h} sw={sw}/>;
}

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
          <button key={t.id} onClick={() => {
            // Light haptic on tab switch — only when actually changing.
            // Tapping the tab you're already on shouldn't buzz.
            if (!active) hapticNative("tap").catch(() => {});
            setTab(t.id);
          }} style={{
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
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  // Multi-word ("Manuel Goldsztein"): first letter of the first two
  // words → "MG". This is the canonical case for users who set their
  // real name (nombre + apellido).
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  // Single-word ("manugoldsztein", "elena"): take the first two
  // characters so we never render a sad single-letter avatar. Users
  // who only ever set one name (or who somehow ended up with their
  // email local-part as displayName) still get a proper tile.
  return parts[0].slice(0, 2).toUpperCase();
};

// Eight-color palette for avatar tints. The first entry (SAMAS green)
// is the brand default; the rest spread across hue space so two
// adjacent feed posts from different authors look visually distinct.
// Pick by stable hash on a stable seed (user_id is best, email is OK,
// display name is a last resort) so the same user always renders the
// same color across sessions and devices.
export const AVATAR_PALETTE = [
  "#16C784", // SAMAS green
  "#3B82F6", // blue
  "#F59E0B", // amber
  "#EC4899", // pink
  "#8B5CF6", // violet
  "#06B6D4", // cyan
  "#EF4444", // red
  "#10B981", // emerald
];

export function deriveAvatarColor(seed) {
  if (!seed) return AVATAR_PALETTE[0];
  // 32-bit djb2-ish hash. Plenty for 8 buckets.
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

// avatarPropsFor — single source of truth for "given a user-ish
// object, what initials and what color do I render in the avatar
// tile?". Accepts a partial user with any subset of:
//   { displayName, name, initials, avatarColor, email, id }
// and returns { initials, color }, both always strings. Used by
// Social compose, Profile, message threads, and the Wallet header.
export function avatarPropsFor(u, fallbackColor) {
  const u0 = u || {};
  const name = u0.displayName || u0.name || "";
  const initials =
    u0.initials ||
    (name ? initialsOf(name) : "") ||
    (u0.email ? u0.email.slice(0, 2).toUpperCase() : "??");
  const color =
    u0.avatarColor ||
    deriveAvatarColor(u0.id || u0.email || name) ||
    fallbackColor ||
    AVATAR_PALETTE[0];
  return { initials, color };
}

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
export function ChromeBtn({ T, children, onClick, dot, ...rest }) {
  // Spread `rest` so callers can pass aria-label / title / etc. without
  // the wrapper silently dropping them. samas-0.4.4 caught this when
  // the new "?" Explain button in Wallet header had its aria-label
  // ignored.
  return (
    <button onClick={onClick} {...rest} style={{
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
// News / Broker / Social to avoid a flash of "Cargando…" text.
// Renders a div sized to the props and animates a light gradient
// across it. The @keyframes samas-skel definition lives in
// Shell.jsx's global <style> block so we don't re-inject it on
// every render.
// ----------------------------------------------------------
export function Skeleton({ T, width = "100%", height = 14, borderRadius = 8, marginBottom = 0, style }) {
  return (
    <div style={{
      width, height, borderRadius, marginBottom,
      background: `linear-gradient(90deg, ${T.surface} 0%, ${T.bgElev} 50%, ${T.surface} 100%)`,
      backgroundSize: "200% 100%",
      animation: "samas-skel 1.4s ease-in-out infinite",
      ...(style || {}),
    }}/>
  );
}

// ----------------------------------------------------------
// Composite skeletons — match the EXACT layout of the row they
// replace so the loading → loaded transition feels like the same
// shape filling in, not a different component swapping. Used by
// the Broker / Social loaders so the user sees the eventual list
// silhouette while data is in flight.
// ----------------------------------------------------------

// AssetRowSkeleton — mirrors AssetRow's redesigned layout
// (samas-0.0.66: no logo, bigger ticker, sparkline 64×28, price
// column 96w with stacked solid-bg pill). Used by MercadoView /
// PortafolioView / WatchlistView while assets/holdings are loading.
export function AssetRowSkeleton({ T, isLast = false }) {
  return (
    <div style={{
      width: "100%", padding: "14px 0",
      borderBottom: isLast ? "none" : `1px solid ${T.border}`,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Skeleton T={T} width={68} height={17} borderRadius={6} marginBottom={6} />
        <Skeleton T={T} width="60%" height={13} borderRadius={6} />
      </div>
      <Skeleton T={T} width={64} height={28} borderRadius={6} />
      <div style={{ width: 96, marginLeft: 6, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <Skeleton T={T} width={74} height={15} borderRadius={6} />
        <Skeleton T={T} width={56} height={20} borderRadius={6} />
      </div>
    </div>
  );
}

// AssetRowSkeletonList — N stacked AssetRowSkeletons inside the
// same horizontal padding the real list uses, so the loading state
// occupies exactly the same screen real estate as the resolved
// list. Default 6 rows ≈ a phone screen of content.
export function AssetRowSkeletonList({ T, count = 6 }) {
  return (
    <div style={{ margin: "0 16px" }}>
      {Array.from({ length: count }).map((_, i) => (
        <AssetRowSkeleton key={i} T={T} isLast={i === count - 1} />
      ))}
    </div>
  );
}

// PostCardSkeleton — mirrors a single PostCard in Social.jsx (the
// rounded card with avatar + handle/timestamp + body lines + an
// action row). Used by feed / search / ticker / profile loaders.
export function PostCardSkeleton({ T }) {
  return (
    <div style={{
      padding: 14, marginBottom: 8, borderRadius: 18,
      background: T.surface, border: `1px solid ${T.border}`,
    }}>
      {/* Author row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "center" }}>
        <Skeleton T={T} width={38} height={38} borderRadius={12} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Skeleton T={T} width="35%" height={13} borderRadius={6} marginBottom={5} />
          <Skeleton T={T} width="55%" height={11} borderRadius={6} />
        </div>
      </div>
      {/* Body lines — 3 of varying widths so it reads as text */}
      <Skeleton T={T} height={12} borderRadius={6} marginBottom={6} />
      <Skeleton T={T} height={12} borderRadius={6} marginBottom={6} />
      <Skeleton T={T} width="78%" height={12} borderRadius={6} marginBottom={12} />
      {/* Action row — 4 evenly-spaced pills, mirrors the heart /
          repost / comment / bookmark icons. */}
      <div style={{ display: "flex", gap: 22 }}>
        <Skeleton T={T} width={42} height={14} borderRadius={6} />
        <Skeleton T={T} width={42} height={14} borderRadius={6} />
        <Skeleton T={T} width={42} height={14} borderRadius={6} />
        <Skeleton T={T} width={42} height={14} borderRadius={6} />
      </div>
    </div>
  );
}

// DmThreadSkeleton — mirrors a row in MessagesView (avatar + name
// + last-message preview + relative timestamp on the right).
export function DmThreadSkeleton({ T }) {
  return (
    <div style={{
      padding: "12px 4px",
      borderBottom: `1px solid ${T.border}`,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <Skeleton T={T} width={42} height={42} borderRadius={14} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Skeleton T={T} width="45%" height={14} borderRadius={6} marginBottom={6} />
        <Skeleton T={T} width="78%" height={12} borderRadius={6} />
      </div>
      <Skeleton T={T} width={40} height={11} borderRadius={6} />
    </div>
  );
}

// UserRowSkeleton (samas-0.3.4) — mirrors a UserRow in
// FollowListView / SearchView (avatar + display name + handle on
// the left, optional follow button on the right). Used while
// users === null instead of "Cargando…" text.
export function UserRowSkeleton({ T }) {
  return (
    <div style={{
      padding: "12px 0",
      borderBottom: `1px solid ${T.border}`,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <Skeleton T={T} width={42} height={42} borderRadius={14} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Skeleton T={T} width="50%" height={14} borderRadius={6} marginBottom={6} />
        <Skeleton T={T} width="35%" height={11} borderRadius={6} />
      </div>
      <Skeleton T={T} width={84} height={28} borderRadius={999} />
    </div>
  );
}

// ReplyRowSkeleton (samas-0.3.4) — mirrors a ReplyRow in ThreadView
// (avatar + display name + reply body + tiny action row). Used
// while replies === null instead of "Cargando…" divider text.
export function ReplyRowSkeleton({ T }) {
  return (
    <div style={{
      padding: "10px 4px",
      borderBottom: `1px solid ${T.border}`,
      display: "flex", gap: 10,
    }}>
      <Skeleton T={T} width={32} height={32} borderRadius={10} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <Skeleton T={T} width={70} height={11} borderRadius={6} />
          <Skeleton T={T} width={50} height={11} borderRadius={6} />
        </div>
        <Skeleton T={T} height={12} borderRadius={6} marginBottom={4} />
        <Skeleton T={T} width="65%" height={12} borderRadius={6} />
      </div>
    </div>
  );
}
