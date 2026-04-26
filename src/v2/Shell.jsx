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

import React, { useState } from "react";
import { SAMAS_THEME, FONT } from "./theme.js";
import { SamasTabBar } from "./shared.jsx";
import { WalletPage } from "./Wallet.jsx";
import { BrokerShell } from "./Broker.jsx";

export function SamasShell({ user, isDark = true, isNativeApp = false, onToggleDark }) {
  const [tab, setTab] = useState("wallet");
  // balanceVisible is lifted here (not inside WalletPage) so the
  // user's choice persists when they navigate to another tab and
  // come back. Same UX as Brubank / MercadoPago.
  const [balanceVisible, setBalanceVisible] = useState(true);

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
    </div>
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
