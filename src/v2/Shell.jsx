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

import React, { useState, useEffect, useMemo, Suspense, lazy } from "react";
import { SAMAS_THEME, FONT } from "./theme.js";
import { SamasTabBar } from "./shared.jsx";
import { WalletPage } from "./Wallet.jsx";
// Code-split the heavy tabs and the 2FA enrollment so they don't
// inflate the initial JS parse on cold launch. Wallet is the landing
// tab so it stays eagerly imported. Broker stays eager too because
// it's typically the first thing power users tap. Everything else
// loads on first navigation / first open.
const BrokerShell = lazy(() => import("./Broker.jsx").then((m) => ({ default: m.BrokerShell })));
const SocialPage  = lazy(() => import("./Social.jsx").then((m) => ({ default: m.SocialPage })));
const NewsPage    = lazy(() => import("./News.jsx").then((m) => ({ default: m.NewsPage })));
const MfaEnrollSection = lazy(() => import("../auth/Mfa.jsx").then((m) => ({ default: m.MfaEnrollSection })));
import { Onboarding } from "./Onboarding.jsx";

// localStorage flag for the Pro mode toggle. Default ON — power users
// see the full broker surface (ticker banner, distribución, top movers)
// out of the box. Flip OFF for a simpler beginner view.
const PRO_KEY = "samas_v2_pro_mode";

export function SamasShell({ user, isDark = true, isNativeApp = false, onToggleDark, onLogout }) {
  const [tab, setTab] = useState("wallet");
  // balanceVisible is lifted here (not inside WalletPage) so the
  // user's choice persists when they navigate to another tab and
  // come back. Same UX as Brubank / MercadoPago.
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  // Onboarding shows on first launch and once dismissed it never
  // re-appears (samas_v2_onboarded=true in localStorage).
  const [needsOnboarding, setNeedsOnboarding] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem("samas_v2_onboarded") !== "true";
  });
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

  // ---------- short-circuit: Onboarding (first launch) ----------
  if (needsOnboarding) {
    return (
      <Onboarding
        T={T}
        isNativeApp={isNativeApp}
        onDone={() => setNeedsOnboarding(false)}
      />
    );
  }

  // ---------- short-circuit: Broker is a NESTED sub-shell ----------
  // When the user taps "Invertir", we replace the entire main shell
  // with BrokerShell. BrokerShell has its OWN bottom nav (Portafolio
  // / Mercado / Watchlist / Órdenes) and a back arrow at the top to
  // return us here. The main 4-tab nav is hidden while inside Broker
  // — this gives the iOS-style "drill down into a section" feel the
  // legacy app had, without coupling the two navs together.
  if (tab === "broker") {
    return (
      <Suspense fallback={<TinyLoader T={T}/>}>
        <BrokerShell
          T={T}
          isNativeApp={isNativeApp}
          proMode={proMode}
          onBack={() => setTab("wallet")}
        />
      </Suspense>
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
        return (
          <Suspense fallback={<TinyLoader T={T}/>}>
            <SocialPage T={T} />
          </Suspense>
        );
      case "news":
        return (
          <Suspense fallback={<TinyLoader T={T}/>}>
            <NewsPage T={T} />
          </Suspense>
        );
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

      {/* ---------- settings sheet (Pro toggle, 2FA, logout, etc.) ---------- */}
      {showSettings && (
        <SettingsSheet
          T={T}
          user={user}
          proMode={proMode}
          setProMode={setProMode}
          isDark={isDark}
          onToggleDark={onToggleDark}
          onLogout={onLogout}
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
function SettingsSheet({ T, user, proMode, setProMode, isDark, onToggleDark, onLogout, onClose, isNativeApp }) {
  const [show2FA, setShow2FA] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  // Adapter: map v2 theme `T` -> legacy theme `C` shape that the
  // MfaEnrollSection expects. Same trick as the AI wizard.
  const C = useMemo(() => ({
    bg: T.bgElev, card: T.surface, creamDk: T.surface,
    border: T.border, accent: T.accent,
    text: T.text, textMd: T.textMute, textLt: T.textDim,
    green: T.accent, red: T.danger, gold: "#C9A84C",
    isDark: true,
  }), [T]);

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "92dvh",
        background: T.bgElev, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        padding: "20px 20px",
        paddingBottom: isNativeApp ? "calc(env(safe-area-inset-bottom) + 24px)" : 24,
        overflowY: "auto",
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

        {/* 2FA row — opens the legacy MfaEnrollSection in a sub-modal. */}
        <button onClick={() => setShow2FA(true)} style={{
          width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 8,
          background: T.surface, border: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", textAlign: "left",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
              Autenticación 2FA
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              Recomendado · Authenticator App
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>

        {/* Logout row — destructive style, two-step confirm. */}
        {onLogout && (
          <button
            onClick={() => setConfirmLogout(true)}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 8,
              background: T.surface, border: `1px solid ${T.danger}55`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.danger }}>
              Cerrar sesión
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.danger} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
            </svg>
          </button>
        )}

        <button onClick={onClose} style={{
          width: "100%", marginTop: 14, padding: 14, borderRadius: 14,
          background: T.surface, border: `1px solid ${T.border}`,
          color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
          cursor: "pointer",
        }}>Listo</button>
      </div>

      {/* 2FA enrollment sub-sheet */}
      {show2FA && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setShow2FA(false); }} style={{
          position: "fixed", inset: 0, zIndex: 110,
          background: "rgba(0,0,0,0.7)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 16,
        }}>
          <div style={{
            width: "100%", maxWidth: 540, maxHeight: "92dvh",
            background: T.bgElev, color: T.text,
            borderRadius: 22, border: `1px solid ${T.border}`,
            overflow: "hidden", display: "flex", flexDirection: "column",
          }}>
            <div style={{
              padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
              borderBottom: `1px solid ${T.border}`,
            }}>
              <div style={{ fontFamily: FONT.display, fontSize: 17, fontWeight: 700, color: T.text }}>
                Autenticación 2FA
              </div>
              <button onClick={() => setShow2FA(false)} style={{
                background: T.surface, border: `1px solid ${T.border}`,
                width: 30, height: 30, borderRadius: 10, color: T.textMute,
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
              <Suspense fallback={<TinyLoader T={T}/>}>
                <MfaEnrollSection C={C} />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      {/* Logout confirm */}
      {confirmLogout && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setConfirmLogout(false); }} style={{
          position: "fixed", inset: 0, zIndex: 120,
          background: "rgba(0,0,0,0.7)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 16,
        }}>
          <div style={{
            width: "100%", maxWidth: 420,
            background: T.bgElev, color: T.text,
            borderRadius: 22, border: `1px solid ${T.border}`,
            padding: 20,
          }}>
            <div style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 8 }}>
              ¿Cerrar sesión?
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5, marginBottom: 18 }}>
              Vas a tener que volver a ingresar email, contraseña y PIN cuando vuelvas.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmLogout(false)} style={{
                flex: 1, padding: 14, borderRadius: 14,
                background: T.surface, border: `1px solid ${T.border}`,
                color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}>Cancelar</button>
              <button onClick={() => { setConfirmLogout(false); onClose(); onLogout(); }} style={{
                flex: 1, padding: 14, borderRadius: 14,
                background: T.danger, color: "#FFFFFF",
                fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer",
              }}>Cerrar sesión</button>
            </div>
          </div>
        </div>
      )}
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

// ----------------------------------------------------------
// TinyLoader — minimal fallback for Suspense boundaries while the
// lazy chunk for a tab loads. Keeps the chrome (header background)
// and shows a centered subtle spinner so it doesn't feel like the
// app froze.
// ----------------------------------------------------------
function TinyLoader({ T }) {
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: T.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 999,
        border: `2px solid ${T.border}`,
        borderTopColor: T.accent,
        animation: "samas-spin 700ms linear infinite",
      }}/>
      <style>{`@keyframes samas-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
