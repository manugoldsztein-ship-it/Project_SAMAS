// ============================================================
// SAMAS v2 — Shell (main container, post-auth)
// ============================================================
// 4-tab container that holds the new shell:
//   wallet → WalletPage (built — mock data for now)
//   broker → existing MobileApp from App.jsx (TODO: wire in next pass)
//   social → SocialPage (TODO)
//   news   → NewsPage   (TODO — reuse existing PageNoticias)
//
// Right now only the wallet tab has real content. The other 3 show
// a "Próximamente" placeholder so the navigation is visually wired
// end-to-end and we can iterate one tab at a time.
// ============================================================

import React, { useState, useEffect } from "react";
import { SAMAS_THEME, FONT } from "./theme.js";
import { SamasTabBar } from "./shared.jsx";
import { WalletPage } from "./Wallet.jsx";
import { BrokerShell } from "./Broker.jsx";

// localStorage flag for the Pro mode toggle. Default ON — power users
// see the full broker surface (ticker banner, distribución, top movers)
// out of the box. Flip OFF for a simpler beginner view.
const PRO_KEY = "samas_v2_pro_mode";

export function SamasShell({ user, isDark = true, isNativeApp = false, onToggleDark }) {
  const [tab, setTab] = useState("wallet");
  // balanceVisible is lifted here (not inside WalletPage) so the
  // user's choice persists when they navigate to another tab and
  // come back. Same UX as Brubank / MercadoPago.
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [proMode, setProMode] = useState(() => {
    if (typeof localStorage === "undefined") return true;
    const v = localStorage.getItem(PRO_KEY);
    return v === null ? true : v === "true";
  });
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PRO_KEY, String(proMode));
    }
  }, [proMode]);

  const T = isDark ? SAMAS_THEME.dark : SAMAS_THEME.light;
  // The chrome layout fix moved safe-area handling out of #root and
  // onto the chrome elements themselves. So inside the shell we now
  // consume the insets ourselves. On native we float the tab bar
  // 12px above the home indicator zone (safe-area-inset-bottom +
  // 12px). On web preview env() resolves to 0 so it's just 12.
  const tabBarBottom = isNativeApp
    ? "calc(env(safe-area-inset-bottom) + 12px)"
    : 12;

  // ---------- short-circuit: Broker is a NESTED sub-shell ----------
  // When the user taps "Invertir", we replace the entire main shell
  // with BrokerShell. BrokerShell has its OWN bottom nav (Portafolio
  // / Mercado / Watchlist / Órdenes) and a back arrow at the top to
  // return us here. The main 4-tab nav is hidden while inside Broker
  // — this gives the iOS-style "drill down into a section" feel the
  // legacy app had, without coupling the two navs together.
  if (tab === "broker") {
    return (
      <BrokerShell
        T={T}
        isNativeApp={isNativeApp}
        proMode={proMode}
        onBack={() => setTab("wallet")}
      />
    );
  }

  const renderTab = () => {
    switch (tab) {
      case "wallet":
        return (
          <WalletPage
            T={T}
            user={user}
            onTab={setTab}
            balanceVisible={balanceVisible}
            setBalanceVisible={setBalanceVisible}
            isDark={isDark}
            onToggleDark={onToggleDark}
            onOpenSettings={() => setShowSettings(true)}
          />
        );
      case "social":
        return <Placeholder T={T} title="Social" subtitle="Feed de traders y trades" />;
      case "news":
        return <Placeholder T={T} title="Noticias" subtitle="Mercados, Argentina, cripto" />;
      default:
        return null;
    }
  };

  return (
    <div style={{
      // Fill the parent #root padding box (which is inside the iOS
      // safe-area inset). This div is the page-level scroll container.
      position: "absolute", inset: 0,
      background: T.bg,
      overflow: "hidden",
      display: "flex", flexDirection: "column",
      fontFamily: FONT.sans,
      color: T.text,
    }}>
      {/* ---------- scrollable page content ---------- */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
      }}>
        {renderTab()}
      </div>

      {/* ---------- floating tab bar ---------- */}
      <SamasTabBar tab={tab} setTab={setTab} T={T} bottomInset={tabBarBottom} />

      {/* ---------- settings sheet (Pro toggle, etc.) ---------- */}
      {showSettings && (
        <SettingsSheet
          T={T}
          user={user}
          proMode={proMode}
          setProMode={setProMode}
          isDark={isDark}
          onToggleDark={onToggleDark}
          onClose={() => setShowSettings(false)}
          isNativeApp={isNativeApp}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------
// SettingsSheet — bottom sheet with Pro toggle + dark/light. Opened
// from the Wallet header avatar. Kept tiny on purpose: this isn't the
// full ProfileSheet from legacy, it's a focused settings panel for
// the toggles the user actually flips often.
// ----------------------------------------------------------
function SettingsSheet({ T, user, proMode, setProMode, isDark, onToggleDark, onClose, isNativeApp }) {
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 540,
        background: T.bgElev, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        padding: "20px 20px",
        paddingBottom: isNativeApp ? "calc(env(safe-area-inset-bottom) + 24px)" : 24,
      }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border }}/>
        </div>

        {/* User row */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12, marginBottom: 18,
          paddingBottom: 14, borderBottom: `1px solid ${T.border}`,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: user?.avatarColor || T.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: T.accentInk, fontFamily: FONT.display, fontSize: 16, fontWeight: 700,
          }}>{user?.initials || "??"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text }}>
              {user?.name || "Usuario"}
            </div>
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{user?.email || ""}</div>
          </div>
        </div>

        {/* Pro mode row */}
        <SettingsToggle
          T={T}
          title="Modo Pro"
          subtitle="Banner en vivo, distribución y top movers"
          value={proMode}
          onChange={setProMode}
        />

        {/* Dark mode row */}
        {onToggleDark && (
          <SettingsToggle
            T={T}
            title={isDark ? "Modo claro" : "Modo oscuro"}
            subtitle={isDark ? "Pasar a tema claro" : "Pasar a tema oscuro"}
            value={isDark}
            onChange={() => onToggleDark()}
          />
        )}

        <button onClick={onClose} style={{
          width: "100%", marginTop: 14, padding: 14, borderRadius: 14,
          background: T.surface, border: `1px solid ${T.border}`,
          color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
          cursor: "pointer",
        }}>Listo</button>
      </div>
    </div>
  );
}

function SettingsToggle({ T, title, subtitle, value, onChange }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 8,
      background: T.surface, border: `1px solid ${T.border}`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      cursor: "pointer", textAlign: "left",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
          {title}
        </div>
        <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
          {subtitle}
        </div>
      </div>
      <div style={{
        width: 44, height: 24, borderRadius: 12, flexShrink: 0,
        background: value ? T.accent : T.border,
        position: "relative", transition: "background 0.15s ease",
      }}>
        <div style={{
          position: "absolute", top: 2, left: value ? 22 : 2,
          width: 20, height: 20, borderRadius: "50%",
          background: "#fff", transition: "left 0.15s ease",
        }}/>
      </div>
    </button>
  );
}

// ----------------------------------------------------------
// Placeholder — temporary "Próximamente" screen for tabs not yet
// wired up. Once each tab gets its real component this goes away.
// ----------------------------------------------------------
function Placeholder({ T, title, subtitle }) {
  return (
    <div style={{
      paddingBottom: 110,
      minHeight: "100%",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        // Same safe-area-aware top inset as WalletPage so all tabs feel
        // visually consistent below the status bar / DI.
        padding: "calc(env(safe-area-inset-top) + 20px) 20px 0",
      }}>
        <div style={{
          fontFamily: FONT.display, fontSize: 28, fontWeight: 700,
          color: T.text, letterSpacing: -0.6,
        }}>{title}</div>
        {subtitle && (
          <div style={{
            fontFamily: FONT.sans, fontSize: 13, color: T.textMute, marginTop: 2,
          }}>{subtitle}</div>
        )}
      </div>

      <div style={{
        flex: 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 32,
      }}>
        <div style={{
          textAlign: "center",
          padding: "40px 24px",
          borderRadius: 22,
          background: T.surface,
          border: `1px solid ${T.border}`,
          maxWidth: 320,
        }}>
          <div style={{
            fontFamily: FONT.display, fontSize: 18, fontWeight: 700,
            color: T.text, marginBottom: 8,
          }}>Próximamente</div>
          <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5 }}>
            Esta sección está en desarrollo. Volvé pronto.
          </div>
        </div>
      </div>
    </div>
  );
}
