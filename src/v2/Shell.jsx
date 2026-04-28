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
import { usePullToRefresh } from "./usePullToRefresh.jsx";
import { callRefreshFor } from "./refreshRegistry.js";
import {
  isBiometricAvailable, authenticateWithBiometric,
  isBiometricEnabled, setBiometricEnabled, debugBiometric,
} from "../lib/biometric.js";
import {
  isPushEnabled, setPushEnabled,
  registerPush, getPushPermission, clearPushLocal,
} from "../lib/push.js";
import { supabase } from "../lib/supabase.js";
import { LANGUAGES } from "../lib/languages.js";
import { t as tr } from "../lib/i18n.js";
import { toast } from "./toast.jsx";
import { seedDemoAccount, resetDemoAccount } from "../lib/demoSeed.js";

// localStorage flag for the Pro mode toggle. Default ON — power users
// see the full broker surface (ticker banner, distribución, top movers)
// out of the box. Flip OFF for a simpler beginner view.
const PRO_KEY = "samas_v2_pro_mode";

function SamasShellInner({ user, isDark = true, isNativeApp = false, onToggleDark, onLogout, lang = "es", setLang }) {
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

  // Cross-shell handoff: the Broker DoneScreen fires
  // "samas:share-trade" when the user taps "Compartir este trade"
  // on a filled order. We stash the trade payload in localStorage
  // (compose-prefill briefcase) and switch to the Social tab. The
  // SocialPage reads + clears the briefcase on mount and prefills
  // the compose box. Doing the handoff here (vs. props through
  // BrokerShell → Social) keeps the lazy-load boundaries clean.
  useEffect(() => {
    function onShareTrade(e) {
      try {
        const trade = e?.detail;
        if (!trade || !trade.ticker) return;
        localStorage.setItem("samas_pending_trade_share", JSON.stringify(trade));
      } catch {}
      setTab("social");
    }
    window.addEventListener("samas:share-trade", onShareTrade);
    return () => window.removeEventListener("samas:share-trade", onShareTrade);
  }, []);

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

  // Broker / Social are drill-in sub-shells with their OWN bottom nav.
  // We don't short-circuit anymore: instead the main Wallet layout
  // stays mounted underneath, and the sub-shell sits on top with
  // position:absolute. That way the iOS-style edge-swipe-back gesture
  // translates the sub-shell out of the way and reveals the Wallet
  // beneath it (instead of a black gap, which is what was happening
  // when we early-returned a single sub-shell on its own).
  //
  // The "background" Wallet is rendered with the tab fixed to "wallet"
  // even though the actual tab state is "broker"/"social" — that way
  // the user's destination after the swipe feels natural and the data
  // stays warm in memory.
  const inSubShell = tab === "broker" || tab === "social";
  const baseTab = inSubShell ? "wallet" : tab;

  const renderTab = () => {
    switch (baseTab) {
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
            lang={lang}
          />
        );
      case "news":
        return (
          <Suspense fallback={<TinyLoader T={T}/>}>
            <NewsPage T={T} lang={lang} />
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
      <ScrollWithPTR T={T} tab={baseTab}>
        {renderTab()}
      </ScrollWithPTR>

      {/* ---------- floating tab bar ----------
          Hidden while inside a drill-in sub-shell because the sub-shell
          renders its own bottom nav. The base tab bar reappears as the
          user swipes back and the sub-shell exits. */}
      {!inSubShell && (
        <SamasTabBar tab={tab} setTab={setTab} T={T} bottomInset={tabBarBottom} lang={lang} />
      )}

      {/* ---------- drill-in sub-shells (overlay) ----------
          Rendered ABOVE the main shell layout via position:absolute so
          the edge-swipe-back gesture (translateX) reveals the Wallet
          underneath as the user drags. */}
      {tab === "broker" && (
        <Suspense fallback={<TinyLoader T={T}/>}>
          <BrokerShell
            T={T}
            isNativeApp={isNativeApp}
            proMode={proMode}
            onBack={() => setTab("wallet")}
            lang={lang}
          />
        </Suspense>
      )}
      {tab === "social" && (
        <Suspense fallback={<TinyLoader T={T}/>}>
          <SocialPage
            T={T}
            isNativeApp={isNativeApp}
            onBack={() => setTab("wallet")}
            lang={lang}
            user={user}
          />
        </Suspense>
      )}

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
          lang={lang}
          setLang={setLang}
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
function SettingsSheet({ T, user, proMode, setProMode, isDark, onToggleDark, onLogout, onClose, isNativeApp, lang = "es", setLang }) {
  const [show2FA, setShow2FA] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  // Language picker is collapsed by default; tapping the row expands it
  // inline so we don't open another modal layer on top of this one.
  const [showLang, setShowLang] = useState(false);
  const activeLanguage = LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0];
  // Biometric state — capability detection on mount + current opt-in
  // pref. The toggle is hidden entirely on devices without biometric
  // (e.g. web preview, simulator without Face ID configured).
  const [bioType, setBioType] = useState("none");
  const [bioOn, setBioOn] = useState(isBiometricEnabled());
  // bioDiag is only surfaced when bioType ends up as "none" so the
  // user can see WHY (plugin missing / not enrolled / hardware error).
  const [bioDiag, setBioDiag] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = await isBiometricAvailable();
        if (!alive) return;
        setBioType(t);
        if (t === "none") {
          const dbg = await debugBiometric();
          if (!alive) return;
          const summary = dbg.plugin
            ? (dbg.info ? "Hardware no disponible o sin enrolar" : `Error: ${dbg.error}`)
            : "Plugin no disponible";
          setBioDiag(summary);
        }
      } catch (e) {
        setBioDiag(`Error: ${e?.message || String(e)}`);
      }
    })();
    return () => { alive = false; };
  }, []);
  // Push notifications state — current opt-in flag + the iOS
  // permission grant. They can disagree: a user can revoke the iOS
  // permission from System Settings while our flag is still "true",
  // in which case the toggle in our UI should reflect the OS reality.
  const [pushOn, setPushOn] = useState(isPushEnabled());
  const [pushPerm, setPushPerm] = useState("prompt"); // granted | denied | prompt | unsupported
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    getPushPermission().then((p) => { if (alive) setPushPerm(p); });
    return () => { alive = false; };
  }, []);
  async function togglePush(next) {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (!next) {
        // User flipping off: drop the local flag AND best-effort delete
        // any device_tokens row for this device so we stop receiving
        // pushes immediately. We don't ask iOS to revoke perms — that
        // requires a trip to Settings and isn't something we want to
        // bug the user about.
        clearPushLocal();
        setPushOn(false);
        try {
          if (user?.id) {
            await supabase.from("device_tokens")
              .delete()
              .eq("user_id", user.id)
              .eq("platform", "ios");
          }
        } catch (_) {}
        toast.info("Notificaciones desactivadas.");
        return;
      }
      // Enabling — set the flag first so the App.jsx effect picks up
      // and registers, then run register here too in case the user is
      // already past that effect (e.g. toggling on, off, on again in
      // one session).
      setPushEnabled(true);
      const { permission, token } = await registerPush(async (t) => {
        if (!user?.id) return;
        await supabase.from("device_tokens").upsert({
          user_id: user.id, token: t, platform: "ios",
          last_seen: new Date().toISOString(),
        }, { onConflict: "token" });
      });
      setPushPerm(permission);
      if (permission === "granted" && token) {
        setPushOn(true);
        toast.success("Notificaciones activadas.");
      } else if (permission === "denied") {
        setPushOn(false);
        clearPushLocal();
        toast.error("Permiso denegado. Activalo desde Ajustes de iOS.");
      } else {
        setPushOn(false);
        clearPushLocal();
        toast.error("No pudimos activar las notificaciones.");
      }
    } catch (e) {
      toast.error(`Push: ${e?.message || String(e)}`);
      clearPushLocal();
      setPushOn(false);
    } finally {
      setPushBusy(false);
    }
  }

  async function toggleBiometric(next) {
    if (!next) {
      // Disabling — no need to prompt.
      setBiometricEnabled(false);
      setBioOn(false);
      toast.info("Face ID desactivado.");
      return;
    }
    // Enabling — confirm with the actual biometric so we don't enable
    // for a user whose face isn't enrolled / who can't authenticate.
    try {
      const ok = await authenticateWithBiometric("Confirmá para activar Face ID");
      if (!ok) return;
      setBiometricEnabled(true);
      setBioOn(true);
      toast.success(`${bioType === "face" ? "Face ID" : "Touch ID"} activado.`);
    } catch (e) {
      toast.error("No pudimos verificar tu biometría.");
    }
  }

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
          title={tr("settings.pro_mode", lang)}
          subtitle={tr("settings.pro_mode_sub", lang)}
          value={proMode}
          onChange={setProMode}
        />

        {/* Dark mode row */}
        {onToggleDark && (
          <SettingsToggle
            T={T}
            title={isDark ? tr("settings.light_mode", lang) : tr("settings.dark_mode", lang)}
            subtitle={isDark ? tr("settings.theme_to_light", lang) : tr("settings.theme_to_dark", lang)}
            value={isDark}
            onChange={() => onToggleDark()}
          />
        )}

        {/* Language row + inline picker. The picker stays in this same
            sheet (no second modal layer) — tapping the row rotates the
            chevron and reveals the language list right below. Selecting
            a language collapses the list and persists via setLang
            (which already writes profiles.lang on the App.jsx side). */}
        {setLang && (
          <>
            <button
              onClick={() => setShowLang((v) => !v)}
              style={{
                width: "100%", padding: "12px 14px", borderRadius: 14,
                marginBottom: 8,
                background: showLang ? T.accent + "18" : T.surface,
                border: `1px solid ${showLang ? T.accent + "55" : T.border}`,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                cursor: "pointer", textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
                  {tr("settings.language", lang)}
                </div>
                <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
                  {activeLanguage.label}
                </div>
              </div>
              <svg
                width="14" height="14" viewBox="0 0 24 24"
                fill="none" stroke={T.textMute} strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
                style={{
                  transform: showLang ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 200ms",
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            {showLang && (
              <div style={{
                background: T.surface, borderRadius: 12,
                border: `1px solid ${T.border}`,
                padding: 6, marginBottom: 8,
              }}>
                {LANGUAGES.map((l) => {
                  const active = l.code === lang;
                  return (
                    <button
                      key={l.code}
                      onClick={() => { setLang(l.code); setShowLang(false); }}
                      style={{
                        width: "100%",
                        background: active ? T.accent + "22" : "transparent",
                        border: "none", borderRadius: 9,
                        padding: "11px 12px",
                        display: "flex", alignItems: "center", gap: 10,
                        cursor: "pointer", fontFamily: "inherit",
                        textAlign: "left", marginBottom: 2,
                      }}
                    >
                      <div style={{
                        width: 28, height: 28, borderRadius: 6,
                        background: T.bgElev,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: FONT.sans,
                        fontSize: 10, fontWeight: 800,
                        color: T.textMute, letterSpacing: 0.5,
                      }}>
                        {l.flag}
                      </div>
                      <span style={{
                        fontFamily: FONT.sans,
                        fontSize: 13,
                        fontWeight: active ? 700 : 500,
                        color: active ? T.accent : T.text,
                        flex: 1,
                      }}>
                        {l.label}
                      </span>
                      {active && (
                        <svg width="14" height="14" viewBox="0 0 24 24"
                          fill="none" stroke={T.accent} strokeWidth="3"
                          strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 12 10 16 18 8" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Face ID / Touch ID — when the device doesn't have biometry
            available we still show the row but with the reason in the
            subtitle, so users (and us) know whether it's a setup issue
            or a real lack of hardware. */}
        <SettingsToggle
          T={T}
          title={bioType === "face" ? tr("settings.faceid", lang) : bioType === "fingerprint" ? tr("settings.touchid", lang) : tr("settings.biometry", lang)}
          subtitle={
            bioType === "none"
              ? (bioDiag || tr("settings.bio_detecting", lang))
              : tr("settings.bio_unlock", lang)
          }
          value={bioOn}
          onChange={async (next) => {
            if (bioType === "none") return;
            try {
              await toggleBiometric(next);
            } catch (e) {
              toast.error(`Toggle error: ${e?.message || String(e)}`, { duration: 8000 });
            }
          }}
        />

        {/* Push notifications — only show on native (the web build can't
            register for APNs). The subtitle reflects iOS permission
            state so the user knows where to go if they need to grant it
            from System Settings. */}
        {isNativeApp && (
          <SettingsToggle
            T={T}
            title={tr("settings.push", lang)}
            subtitle={
              pushBusy ? tr("settings.push.busy", lang) :
              pushPerm === "denied" ? tr("settings.push.denied", lang) :
              pushPerm === "unsupported" ? tr("settings.push.unsupported", lang) :
              pushOn ? tr("settings.push.on_sub", lang) :
              tr("settings.push.off_sub", lang)
            }
            value={pushOn}
            onChange={togglePush}
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
              {tr("settings.mfa", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              {tr("settings.mfa_sub", lang)}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>

        {/* ---------- Demo section ----------
            Investor-demo helpers: seed a curated portfolio (so the
            Wallet hero, sparkline, holdings list and broker PnL all
            render fully populated) or reset back to the empty-state
            onboarding flow. Both reload the page so usePersistedState
            picks up the new localStorage values cleanly. */}
        <div style={{
          marginTop: 6, marginBottom: 6,
          fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
          color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
          padding: "0 4px",
        }}>
          {tr("settings.demo.section", lang)}
        </div>
        <button
          onClick={() => {
            if (confirm(tr("settings.demo.seed_confirm", lang))) seedDemoAccount();
          }}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 8,
            background: T.surface, border: `1px solid ${T.accent}55`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            cursor: "pointer", textAlign: "left",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
              {tr("settings.demo.seed", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              {tr("settings.demo.seed_sub", lang)}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
        <button
          onClick={() => {
            if (confirm(tr("settings.demo.reset_confirm", lang))) resetDemoAccount();
          }}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 14,
            background: T.surface, border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            cursor: "pointer", textAlign: "left",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
              {tr("settings.demo.reset", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              {tr("settings.demo.reset_sub", lang)}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
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
              {tr("settings.logout", lang)}
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
        }}>{tr("settings.done", lang)}</button>
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
                {tr("settings.mfa", lang)}
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
              {tr("settings.logout_confirm", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5, marginBottom: 18 }}>
              {tr("settings.logout_confirm_sub", lang)}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmLogout(false)} style={{
                flex: 1, padding: 14, borderRadius: 14,
                background: T.surface, border: `1px solid ${T.border}`,
                color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}>{tr("settings.logout_cancel", lang)}</button>
              <button onClick={() => { setConfirmLogout(false); onClose(); onLogout(); }} style={{
                flex: 1, padding: 14, borderRadius: 14,
                background: T.danger, color: "#FFFFFF",
                fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer",
              }}>{tr("settings.logout_yes", lang)}</button>
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
// ScrollWithPTR — the page-level scroll container for the wallet/
// news tabs. Wraps the active tab content with the pull-to-refresh
// hook; when the user pulls past the threshold we call the refresh
// handler that the active tab registered via setRefreshHandler.
// ----------------------------------------------------------
function ScrollWithPTR({ T, tab, children }) {
  const { bind, indicator } = usePullToRefresh(() => callRefreshFor(tab));
  return (
    <div
      {...bind}
      style={{
        flex: 1,
        overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {indicator}
      {children}
    </div>
  );
}

// ----------------------------------------------------------
// SamasShell — memoized export so SAMASApp's 60s Finnhub re-render
// (setBump → top-level state change) doesn't propagate down into
// the v2 tree. All shell props are stable across the bump because
// nothing in the shell consumes Finnhub state directly; without
// React.memo the entire 9.5k-line v2 subtree reconciles every minute
// and React's fiber retention compounds with the ASSETS mutation
// pattern, materially driving the iOS memory crash.
// ----------------------------------------------------------
export const SamasShell = React.memo(SamasShellInner);

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
