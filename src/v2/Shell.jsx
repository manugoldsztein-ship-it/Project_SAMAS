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
import { SamasTabBar, Avatar, avatarPropsFor, initialsOf, AVATAR_PALETTE } from "./shared.jsx";
import { social as socialApi } from "./api/index.js";
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
import { seedSocialDemo } from "../lib/seedSocial.js";

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

  // Pro upsell modal — global because Wallet, Broker, etc all need
  // to be able to open it. Listens for "samas:open-pro-upsell" so
  // any view can pop it without having to thread a prop through.
  const [showProUpsell, setShowProUpsell] = useState(false);
  useEffect(() => {
    function open() { setShowProUpsell(true); }
    window.addEventListener("samas:open-pro-upsell", open);
    return () => window.removeEventListener("samas:open-pro-upsell", open);
  }, []);

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

  // Watchlist share — same handoff pattern as share-trade above. The
  // BrokerShell's WatchlistView dispatches "samas:share-watchlist"
  // when the user taps the Share button on a list. We stash a body
  // string in the briefcase (already-formatted in the dispatcher so
  // the format stays close to the source) and switch to Social.
  useEffect(() => {
    function onShareWatchlist(e) {
      try {
        const body = e?.detail?.body;
        if (!body) return;
        localStorage.setItem("samas_pending_text_share", body);
      } catch {}
      setTab("social");
    }
    window.addEventListener("samas:share-watchlist", onShareWatchlist);
    return () => window.removeEventListener("samas:share-watchlist", onShareWatchlist);
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
            proMode={proMode}
            onOpenProUpsell={() => setShowProUpsell(true)}
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

      {/* Pro upsell modal — global so any view can dispatch
          "samas:open-pro-upsell" or pass onOpenProUpsell down. */}
      {showProUpsell && (
        <ProUpsellModal
          T={T}
          lang={lang}
          isPro={proMode}
          onActivate={() => { setProMode(true); setShowProUpsell(false); }}
          onClose={() => setShowProUpsell(false)}
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
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  // Server-side social seed (Edge Function) — busy flag so the row
  // shows "Sembrando…" while the function runs and the button can't
  // be re-tapped mid-flight. Idempotent on the server, but the UX is
  // cleaner if we don't fire two seeds at once.
  const [seedingSocial, setSeedingSocial] = useState(false);
  // Privacy / Terms sub-sheets — App Store submission requires both
  // policies to be reachable from the app. We render them inline as
  // modals (same pattern as 2FA / EditProfile) instead of opening the
  // system browser so the content stays inside the app shell.
  const [showLegal, setShowLegal] = useState(null); // null | "privacy" | "terms"
  const [showChangelog, setShowChangelog] = useState(false);
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

        {/* Editar perfil — opens the social profile editor sheet
            so the user can change handle, display name, bio, and
            avatar color without dropping into SQL. */}
        <button onClick={() => setShowEditProfile(true)} style={{
          width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 8,
          background: T.surface, border: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", textAlign: "left",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
              {tr("settings.edit_profile", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              {tr("settings.edit_profile_sub", lang)}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>

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
        {/* Sembrar red social — calls the seed-social-demo Edge
            Function (service-role bypass of RLS) to bulk-create 12
            seed users with posts, replies, follows, likes, reposts,
            and DMs to the caller. Investor-pitch fixture so the
            Social tab never reads as empty. Idempotent on the server.
            See supabase/functions/seed-social-demo/index.ts. */}
        <button
          disabled={seedingSocial}
          onClick={async () => {
            if (seedingSocial) return;
            if (!confirm(tr("settings.demo.seed_social_confirm", lang))) return;
            setSeedingSocial(true);
            toast.info(tr("settings.demo.seed_social_running", lang));
            try {
              const result = await seedSocialDemo();
              toast.success(tr("settings.demo.seed_social_done", lang, {
                posts:   String(result?.postsCreated ?? 0),
                follows: String(result?.followsCreated ?? 0),
              }));
            } catch (e) {
              toast.error(tr("settings.demo.seed_social_fail", lang, {
                error: e?.message || String(e),
              }));
            } finally {
              setSeedingSocial(false);
            }
          }}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 8,
            background: T.surface, border: `1px solid ${T.accent}55`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            cursor: seedingSocial ? "default" : "pointer", textAlign: "left",
            opacity: seedingSocial ? 0.6 : 1,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
              {tr("settings.demo.seed_social", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              {seedingSocial
                ? tr("settings.demo.seed_social_running", lang)
                : tr("settings.demo.seed_social_sub", lang)}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>
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

        {/* ---------- About section ----------
            Legal rows required for App Store submission. Both screens
            are rendered inside the app via the LegalSheet component
            below — keeps the policy review inside our shell instead
            of bouncing the user out to Safari. */}
        <div style={{
          marginTop: 6, marginBottom: 6,
          fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
          color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
          padding: "0 4px",
        }}>
          {tr("settings.section.about", lang)}
        </div>
        <button
          onClick={() => setShowLegal("privacy")}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 8,
            background: T.surface, border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            cursor: "pointer", textAlign: "left",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
              {tr("settings.about.privacy", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              {tr("settings.about.privacy_sub", lang)}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <button
          onClick={() => setShowLegal("terms")}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 8,
            background: T.surface, border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            cursor: "pointer", textAlign: "left",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
              {tr("settings.about.terms", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              {tr("settings.about.terms_sub", lang)}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <button
          onClick={() => setShowChangelog(true)}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 14,
            background: T.surface, border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            cursor: "pointer", textAlign: "left",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
              {tr("settings.about.changelog", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              {tr("settings.about.changelog_sub", lang)}
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

      {/* Edit-profile sub-sheet — modifies the user's social
          profile (handle, display name, bio, avatar color). The
          sheet manages its own state and fetches via socialApi
          on open; on save it calls updateMe and closes. */}
      {showEditProfile && (
        <EditProfileSheet
          T={T}
          lang={lang}
          onClose={() => setShowEditProfile(false)}
        />
      )}

      {/* Privacy / Terms sub-sheet — same modal pattern as 2FA below. */}
      {showLegal && (
        <LegalSheet
          T={T}
          lang={lang}
          kind={showLegal}
          onClose={() => setShowLegal(null)}
        />
      )}

      {/* Changelog sub-sheet — list of recent patch notes. */}
      {showChangelog && (
        <ChangelogSheet
          T={T}
          lang={lang}
          onClose={() => setShowChangelog(false)}
        />
      )}

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

// ============================================================
// EditProfileSheet — modify the social profile (handle, display
// name, bio, avatar color). All fields persisted via
// socialApi.updateMe which routes to RLS-checked profiles_social
// UPDATE. Handle uniqueness checked live via a debounced query.
// ============================================================
function EditProfileSheet({ T, lang = "es", onClose }) {
  const [me, setMe] = useState(null);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarColor, setAvatarColor] = useState("#16C784");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [handleStatus, setHandleStatus] = useState(null); // 'checking' | 'available' | 'taken' | 'invalid' | null

  // Initial load — populate state from the existing social profile.
  useEffect(() => {
    let alive = true;
    socialApi.getMe().then((m) => {
      if (!alive) return;
      setMe(m);
      // Strip the leading @ if present so the input shows just the
      // handle text; the @ is rendered as a static prefix.
      setHandle((m.handle || "").replace(/^@/, ""));
      setDisplayName(m.displayName || "");
      setBio(m.bio || "");
      setAvatarColor(m.avatarColor || "#16C784");
    }).catch((e) => setErr(e.message));
    return () => { alive = false; };
  }, []);

  // Debounced handle availability check. Only fires when the
  // current handle differs from me.handle and passes the basic
  // validation (3-15 chars, alphanumeric + underscore only).
  useEffect(() => {
    if (!me) { setHandleStatus(null); return; }
    const trimmed = handle.trim();
    const stripped = trimmed.replace(/^@/, "");
    if (stripped === (me.handle || "").replace(/^@/, "")) {
      setHandleStatus(null);
      return;
    }
    if (!/^[A-Za-z0-9_]{3,15}$/.test(stripped)) {
      setHandleStatus("invalid");
      return;
    }
    setHandleStatus("checking");
    let alive = true;
    const id = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from("profiles_social")
          .select("user_id")
          .ilike("handle", "@" + stripped)
          .neq("user_id", me.id)
          .maybeSingle();
        if (!alive) return;
        setHandleStatus(data ? "taken" : "available");
      } catch {
        if (alive) setHandleStatus(null);
      }
    }, 350);
    return () => { alive = false; clearTimeout(id); };
  }, [handle, me]);

  const handleValid = handleStatus === null || handleStatus === "available";
  const canSave = me && displayName.trim().length >= 1 && handleValid && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setErr(null);
    try {
      const cleanHandle = "@" + handle.trim().replace(/^@/, "");
      await socialApi.updateMe({
        handle: cleanHandle,
        displayName: displayName.trim(),
        bio: bio.trim(),
        avatarColor,
      });
      onClose();
    } catch (e) {
      setErr(e.message || "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  // Live avatar preview uses the in-progress form values.
  const previewProps = avatarPropsFor(
    { displayName: displayName || me?.displayName || "?", avatarColor },
    T.accent,
  );

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 120,
      background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "92dvh",
        background: T.bgElev, color: T.text,
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        border: `1px solid ${T.border}`, borderBottom: "none",
        display: "flex", flexDirection: "column",
        animation: "samas-sheet-up 220ms cubic-bezier(.2,.8,.2,1)",
      }}>
        <style>{`
          @keyframes samas-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        `}</style>
        {/* Header */}
        <div style={{
          padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: `1px solid ${T.border}`,
        }}>
          <div style={{ fontFamily: FONT.display, fontSize: 17, fontWeight: 700 }}>
            {tr("profile.edit.title", lang)}
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{
            background: T.surface, border: `1px solid ${T.border}`,
            width: 30, height: 30, borderRadius: 10, color: T.textMute,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          {/* Avatar preview */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
            <Avatar T={T} initials={previewProps.initials} color={previewProps.color} size={72}/>
          </div>

          {/* Display name */}
          <Field T={T} label={tr("profile.edit.display_name", lang)}>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value.slice(0, 60))}
              maxLength={60}
              style={inputStyle(T)}
            />
          </Field>

          {/* Handle (with @ prefix as static element + availability indicator) */}
          <Field T={T} label={tr("profile.edit.handle", lang)}>
            <div style={{
              display: "flex", alignItems: "center",
              padding: "9px 12px", borderRadius: 12,
              background: T.surface, border: `1px solid ${T.border}`,
            }}>
              <span style={{ fontFamily: FONT.mono, fontSize: 14, color: T.textMute }}>@</span>
              <input
                type="text"
                value={handle.replace(/^@/, "")}
                onChange={(e) => setHandle(e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 15))}
                placeholder="usuario"
                style={{
                  flex: 1, marginLeft: 4,
                  background: "transparent", border: "none", outline: "none",
                  color: T.text, fontFamily: FONT.mono, fontSize: 14,
                }}
              />
              {handleStatus === "checking" && (
                <span style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute }}>verificando…</span>
              )}
              {handleStatus === "available" && (
                <span style={{ fontFamily: FONT.sans, fontSize: 12, color: T.accent, fontWeight: 700 }}>✓</span>
              )}
              {handleStatus === "taken" && (
                <span style={{ fontFamily: FONT.sans, fontSize: 11, color: T.danger, fontWeight: 700 }}>en uso</span>
              )}
              {handleStatus === "invalid" && (
                <span style={{ fontFamily: FONT.sans, fontSize: 11, color: T.danger, fontWeight: 700 }}>3-15 chars</span>
              )}
            </div>
          </Field>

          {/* Bio */}
          <Field T={T} label={tr("profile.edit.bio", lang)}>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 160))}
              rows={3}
              maxLength={160}
              placeholder={tr("profile.edit.bio_ph", lang)}
              style={{ ...inputStyle(T), resize: "none", minHeight: 60 }}
            />
            <div style={{
              fontFamily: FONT.mono, fontSize: 11, color: T.textMute,
              textAlign: "right", marginTop: 4,
            }}>{bio.length}/160</div>
          </Field>

          {/* Avatar color picker */}
          <Field T={T} label={tr("profile.edit.color", lang)}>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 8,
            }}>
              {AVATAR_PALETTE.map((c) => {
                const active = c === avatarColor;
                return (
                  <button
                    key={c}
                    onClick={() => setAvatarColor(c)}
                    aria-label={c}
                    style={{
                      aspectRatio: "1 / 1", borderRadius: 12,
                      background: c,
                      border: active ? `2px solid ${T.text}` : `2px solid transparent`,
                      cursor: "pointer", padding: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {active && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#06170D" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5"/>
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </Field>

          {err && (
            <div style={{
              marginTop: 8, padding: "8px 12px", borderRadius: 10,
              background: `${T.danger}15`, border: `1px solid ${T.danger}40`,
              color: T.danger, fontFamily: FONT.sans, fontSize: 12,
            }}>{err}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: 16, borderTop: `1px solid ${T.border}`,
          display: "flex", gap: 10,
        }}>
          <button onClick={onClose} style={{
            flex: 1, padding: 12, borderRadius: 12,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
            cursor: "pointer",
          }}>{tr("profile.edit.cancel", lang)}</button>
          <button
            onClick={save}
            disabled={!canSave}
            style={{
              flex: 1, padding: 12, borderRadius: 12,
              background: canSave ? T.accent : T.surface,
              color: canSave ? T.accentInk : T.textMute,
              border: canSave ? "none" : `1px solid ${T.border}`,
              fontFamily: FONT.sans, fontSize: 14, fontWeight: 700,
              cursor: canSave ? "pointer" : "default",
              opacity: busy ? 0.6 : 1,
            }}
          >{busy ? "…" : tr("profile.edit.save", lang)}</button>
        </div>
      </div>
    </div>
  );
}

// Small Field wrapper — label above, content below, consistent
// vertical rhythm. Reused by every input row in EditProfileSheet.
function Field({ T, label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
        color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
        marginBottom: 6,
      }}>{label}</div>
      {children}
    </div>
  );
}

function inputStyle(T) {
  return {
    width: "100%", boxSizing: "border-box",
    padding: "9px 12px", borderRadius: 12,
    background: T.surface, border: `1px solid ${T.border}`,
    color: T.text, fontFamily: FONT.sans, fontSize: 14,
    outline: "none",
  };
}

// ============================================================
// ProUpsellModal — "Activar Pro" sales pitch
// ============================================================
// Mounted at the shell level so any view can open it (Wallet hint
// card, Mercado heatmap toggle when locked, etc). Lists the Pro
// features as a scrollable cards grid + a sticky CTA at the bottom.
// During beta the CTA flips proMode on directly; in commercial
// launch it'll route to App Store IAP.
// ============================================================
const PRO_FEATURE_KEYS = [
  { key: "sector",   icon: "📊" },
  { key: "risk",     icon: "📈" },
  { key: "bench",    icon: "🆚" },
  { key: "chart",    icon: "📉" },
  { key: "heatmap",  icon: "🔥" },
  { key: "earnings", icon: "📅" },
  { key: "cashflow", icon: "💸" },
  { key: "tax",      icon: "🧾" },
  { key: "wl",       icon: "🎨" },
];

function ProUpsellModal({ T, lang = "es", isPro, onActivate, onClose }) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 120,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "92dvh",
        background: T.bgElev || T.bg, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border }}/>
        </div>

        {/* Header — accent badge + title + subtitle. The hero strip
            uses a green→accent-soft gradient to set the "this is
            premium" tone before the user reads anything. */}
        <div style={{
          padding: "16px 22px 14px",
          background: `linear-gradient(180deg, ${T.accentSoft} 0%, transparent 100%)`,
        }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 10px", borderRadius: 999,
            background: T.accent, color: T.accentInk,
            fontFamily: FONT.mono, fontSize: 10, fontWeight: 800,
            letterSpacing: 0.6, textTransform: "uppercase",
            marginBottom: 10,
          }}>
            ★ PRO
          </div>
          <div style={{
            fontFamily: FONT.display, fontSize: 24, fontWeight: 700,
            color: T.text, letterSpacing: -0.6, marginBottom: 6,
          }}>{tr("pro.upsell.title", lang)}</div>
          <div style={{
            fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
            lineHeight: 1.45,
          }}>{tr("pro.upsell.subtitle", lang)}</div>
        </div>

        {/* Feature grid — 9 cards, 1 column on phone width, 2 on
            wider devices. Each card is a stat-style block with an
            emoji icon, title, one-line description. */}
        <div style={{
          flex: 1, overflowY: "auto",
          padding: "8px 18px 12px",
        }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 8,
          }}>
            {PRO_FEATURE_KEYS.map((f) => (
              <div key={f.key} style={{
                padding: "12px 14px", borderRadius: 14,
                background: T.surface, border: `1px solid ${T.border}`,
                display: "flex", alignItems: "flex-start", gap: 12,
              }}>
                <div style={{
                  fontSize: 20, lineHeight: 1, flexShrink: 0,
                  width: 32, height: 32, borderRadius: 8,
                  background: T.bg, border: `1px solid ${T.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>{f.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
                    color: T.text, marginBottom: 2,
                  }}>{tr(`pro.upsell.feat.${f.key}`, lang)}</div>
                  <div style={{
                    fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
                    lineHeight: 1.4,
                  }}>{tr(`pro.upsell.feat.${f.key}_d`, lang)}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{
            marginTop: 12, padding: "10px 12px", borderRadius: 12,
            background: T.bg, border: `1px dashed ${T.border}`,
            fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
            lineHeight: 1.45, textAlign: "center",
          }}>{tr("pro.upsell.beta_note", lang)}</div>
        </div>

        {/* Sticky CTA */}
        <div style={{
          padding: "12px 18px calc(env(safe-area-inset-bottom) + 16px)",
          borderTop: `1px solid ${T.border}`,
          background: T.bgElev || T.bg,
          display: "flex", gap: 10,
        }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "13px 16px", borderRadius: 14,
              background: "transparent", border: `1px solid ${T.border}`,
              color: T.text, fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
              cursor: "pointer",
            }}
          >{tr("pro.upsell.cta_later", lang)}</button>
          <button
            onClick={isPro ? onClose : onActivate}
            disabled={isPro}
            style={{
              flex: 2, padding: "13px 16px", borderRadius: 14,
              background: T.accent, border: "none",
              color: T.accentInk, fontFamily: FONT.sans, fontSize: 14, fontWeight: 800,
              cursor: isPro ? "default" : "pointer",
              opacity: isPro ? 0.6 : 1,
              letterSpacing: 0.2,
            }}
          >{isPro ? "Pro activado ✓" : tr("pro.upsell.cta_activate", lang)}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LegalSheet — Privacy / Terms modal
// ============================================================
// Single component renders both screens, switched via the `kind`
// prop. Content is hardcoded prose (no CMS, no remote fetch) — the
// scope of the document fits inline and not loading network keeps
// the screen reachable even when offline.
//
// Both documents are scoped to the current state of the prototype
// (no real broker integration yet, no payments) and explicitly
// flag SAMAS as a not-yet-licensed financial product. When we
// onboard with Cohen and become a real ALyC-registered platform
// these docs need a legal review pass — for now they cover the
// bases we'd want a tester to see.
// ============================================================
function LegalSheet({ T, lang = "es", kind, onClose }) {
  // Prefer es content; en falls back if missing. Both legalText
  // versions are kept identical for the prototype since we don't
  // yet have a translated legal review.
  const isPrivacy = kind === "privacy";
  const title = tr(
    isPrivacy ? "settings.about.privacy" : "settings.about.terms",
    lang,
  );
  const lastUpdatedDate = "29 de abril de 2026";
  const lastUpdated = tr("settings.about.last_updated", lang, { date: lastUpdatedDate });
  const body = isPrivacy ? PRIVACY_TEXT_ES : TERMS_TEXT_ES;
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 110,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "92dvh",
        background: T.bgElev || T.bg, color: T.text,
        borderRadius: 22, border: `1px solid ${T.border}`,
        overflow: "hidden", display: "flex", flexDirection: "column",
      }}>
        <div style={{
          padding: "18px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: `1px solid ${T.border}`, flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.display, fontSize: 17, fontWeight: 700, color: T.text }}>
              {title}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              {lastUpdated}
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{
            width: 30, height: 30, borderRadius: 8,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, cursor: "pointer", padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div style={{
          padding: "16px 20px 20px",
          overflowY: "auto",
          fontFamily: FONT.sans, fontSize: 13, color: T.text,
          lineHeight: 1.6, whiteSpace: "pre-wrap",
        }}>
          {body}
        </div>
      </div>
    </div>
  );
}

// Static prose. Pulled from a one-pager template scoped to a
// pre-launch fintech prototype — placeholder until legal review.
// Argentine jurisdiction (CABA) for the SAMAS team's home base.
const PRIVACY_TEXT_ES = `Última actualización: 29 de abril de 2026.

SAMAS ("nosotros", "la app") es un prototipo de plataforma de inversión desarrollado en Buenos Aires, Argentina. Esta política describe qué datos recopilamos, cómo los usamos, y los derechos que tenés sobre ellos.

1. QUÉ DATOS RECOPILAMOS
Cuando creás una cuenta nos das tu nombre, apellido, email y opcionalmente tu teléfono y la universidad a la que asistís o asististe. Cuando interactuás con la app generamos datos sobre tus posts, mensajes, seguidores y operaciones simuladas. Si tu dispositivo lo permite y vos lo autorizás, recibimos un token de notificaciones push para mandarte alertas.

2. PARA QUÉ LOS USAMOS
Los datos sirven para que la app funcione: mostrarte tu perfil, ordenar tu feed, entregar tus mensajes, validar tu identidad y prevenir fraude. No vendemos tus datos a terceros. Si en el futuro habilitamos publicidad o recomendaciones personalizadas, te lo vamos a avisar antes y te vamos a dar la opción de desactivarlas.

3. DÓNDE SE GUARDAN
Tus datos viven en infraestructura de Supabase (PostgreSQL gestionado), con backups cifrados. Las imágenes que subís se guardan en Supabase Storage. Las operaciones bursátiles, cuando integremos con un broker, se encriptan en tránsito y en reposo.

4. CUÁNTO TIEMPO LOS GUARDAMOS
Mientras tu cuenta esté activa. Si la borrás, removemos tu información personal en un plazo de 30 días, salvo que la ley nos exija conservar registros adicionales (por ejemplo, transacciones financieras durante 10 años, según la Ley 25.246 de prevención de lavado de activos).

5. TUS DERECHOS
Como titular de los datos podés acceder, rectificar, actualizar y solicitar la supresión de tu información personal. Podés ejercer estos derechos escribiendo a privacidad@samas.app. La autoridad de aplicación en Argentina es la Agencia de Acceso a la Información Pública (AAIP).

6. SEGURIDAD
Usamos contraseñas hasheadas, autenticación de dos factores opcional, y RLS (Row Level Security) para que ningún usuario pueda ver datos de otro sin permiso. Ningún sistema es 100% seguro; te recomendamos activar 2FA y usar una contraseña única.

7. MENORES DE EDAD
SAMAS no está destinado a menores de 18 años. Si descubrimos que un menor abrió una cuenta, la cerramos.

8. CAMBIOS
Si actualizamos esta política, vas a ver un aviso en la app y podemos pedirte que aceptes los nuevos términos.

Contacto: privacidad@samas.app`;

const TERMS_TEXT_ES = `Última actualización: 29 de abril de 2026.

Bienvenido a SAMAS. Estos términos rigen el uso de la app durante su etapa de prototipo. Al usar SAMAS aceptás lo siguiente.

1. QUÉ ES SAMAS HOY
SAMAS es un prototipo. La sección "Invertir" simula operaciones bursátiles con datos de mercado en tiempo real, pero no ejecuta órdenes reales. Cuando integremos con un ALyC (Agente de Liquidación y Compensación) registrado en CNV, vamos a actualizar estos términos y te vamos a pedir que aceptes los nuevos.

2. LO QUE PODÉS HACER
Crear una cuenta, publicar posts, seguir a otros usuarios, mandar mensajes directos, simular operaciones y compartirlas en tu feed. Esperamos que uses la app de buena fe — sin spam, sin acoso, sin contenido ilegal y sin intentar romper la infraestructura.

3. LO QUE NO PODÉS HACER
- Hacerte pasar por otro usuario o por SAMAS.
- Postear contenido que sea ilegal, falso o que viole derechos de terceros (incluyendo derechos de propiedad intelectual).
- Recolectar datos de otros usuarios sin su permiso (scraping, harvesting).
- Manipular el feed con prácticas de "pump and dump" u otras formas de manipulación de mercado.
- Vincular SAMAS con esquemas piramidales, criptos no listadas o estafas.
- Intentar acceder a partes de la app o de la infraestructura para las que no estás autorizado.

4. CONTENIDO QUE PUBLICÁS
Vos seguís siendo el dueño de lo que publicás. Al subir contenido nos otorgás una licencia mundial, no exclusiva, gratuita, para mostrarlo dentro de la app. Si borrás el contenido, terminamos de mostrarlo. Nos reservamos el derecho de remover contenido que viole estos términos.

5. INSIGNIAS DE VERIFICACIÓN
La insignia "Universidad" se asigna automáticamente cuando tu email de registro coincide con un dominio universitario reconocido. La insignia "Idóneo CNV" la asigna el equipo de SAMAS después de verificar que estás en el registro público de la CNV. Mantener falsamente una insignia (por ejemplo, declarando una universidad a la que no asistís) puede resultar en suspensión de tu cuenta.

6. SIN ASESORAMIENTO FINANCIERO
Nada de lo que veas en SAMAS — feed, trades compartidos, opiniones de otros usuarios — constituye asesoramiento financiero. Las decisiones de inversión son tuyas y tu responsabilidad. Cuando integremos con un broker real, vas a ver advertencias específicas antes de cada orden.

7. LIMITACIÓN DE RESPONSABILIDAD
SAMAS se ofrece "tal cual", sin garantías. No respondemos por pérdidas indirectas, lucro cesante, ni por contenido publicado por otros usuarios. Nuestra responsabilidad total nunca va a exceder el monto que nos hayas pagado en los últimos 12 meses (que durante el prototipo es cero).

8. SUSPENSIÓN
Podemos suspender o cerrar tu cuenta si rompés estos términos, si la ley nos obliga, o si detectamos actividad fraudulenta. Vas a recibir un aviso por email salvo casos urgentes.

9. JURISDICCIÓN
Estos términos se rigen por las leyes de la República Argentina. Cualquier disputa se resuelve en los Tribunales Ordinarios de la Ciudad Autónoma de Buenos Aires.

10. CAMBIOS
Si cambiamos estos términos te avisamos por la app o por email. Si seguís usando SAMAS después del aviso, considerás aceptados los nuevos términos.

Contacto: legal@samas.app`;

// ============================================================
// ChangelogSheet — Novedades (what's new) modal
// ============================================================
// Static list of recent patches, newest first. Same modal shape as
// LegalSheet so the two screens read as a coherent "About" cluster.
// Each entry has a version label, a one-line title, and a few
// bullet points describing what changed. Designed to read at a
// glance — investors / users / Cohen reviewers should be able to
// skim the iteration cadence without reading commit messages.
//
// Updating this list: add a new entry at the top of CHANGELOG.
// Versions older than ~10 patches drop off the visible list; we
// don't paginate because the prototype's history is short.
// ============================================================
function ChangelogSheet({ T, lang = "es", onClose }) {
  const title = tr("settings.about.changelog", lang);
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 110,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "92dvh",
        background: T.bgElev || T.bg, color: T.text,
        borderRadius: 22, border: `1px solid ${T.border}`,
        overflow: "hidden", display: "flex", flexDirection: "column",
      }}>
        <div style={{
          padding: "18px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: `1px solid ${T.border}`, flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.display, fontSize: 17, fontWeight: 700, color: T.text }}>
              {title}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              SAMAS prototype · feature/samas-rebrand
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{
            width: 30, height: 30, borderRadius: 8,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, cursor: "pointer", padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: "8px 20px 20px" }}>
          {CHANGELOG.map((entry) => (
            <div key={entry.version} style={{
              padding: "16px 0",
              borderBottom: `1px solid ${T.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                <span style={{
                  fontFamily: FONT.mono, fontSize: 11, fontWeight: 800,
                  color: T.accent, letterSpacing: 0.5,
                  background: T.accentSoft, padding: "2px 8px", borderRadius: 6,
                }}>
                  samas-{entry.version}
                </span>
                <span style={{
                  fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text,
                }}>{entry.title}</span>
              </div>
              <ul style={{
                margin: "6px 0 0", paddingLeft: 18,
                fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
                lineHeight: 1.5,
              }}>
                {entry.bullets.map((b, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
          <div style={{
            padding: "16px 0 4px",
            fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
            textAlign: "center", lineHeight: 1.5,
          }}>
            Más viejas que esto las podés mirar en GitHub.
          </div>
        </div>
      </div>
    </div>
  );
}

// CHANGELOG — newest first. Keep entries terse (3 bullets max,
// 12 words per bullet). The point of this screen is iteration
// velocity at a glance, not exhaustive release notes.
const CHANGELOG = [
  {
    version: "0.0.53",
    title: "Swipe arreglado, news global y colores por categoría",
    bullets: [
      "Swipe-to-delete en posts: el panel rojo ahora calza exacto sobre la card (sin offset abajo, esquinas izquierdas cuadradas).",
      "News desde CNBC, MarketWatch y Bloomberg Línea para CEDEARs, ETFs, oro y BTC — antes eran solo Finnhub.",
      "Tiles de fallback en Mercado ahora codifican categoría: CEDEAR=azul, Acciones=verde, Crypto=naranja, ETF=violeta, Commodity=oro, Bono=cielo.",
    ],
  },
  {
    version: "0.0.52",
    title: "Consistencia visual en el broker",
    bullets: [
      "Logos reales (Apple, YPF, NVIDIA, etc.) en cada fila — antes solo se veían las letras del ticker en un cuadrado gris.",
      "Sparkline determinística por ticker: misma acción dibuja siempre el mismo gráfico, distinta de las otras (antes todos los verdes eran idénticos).",
      "Columna de precio con ancho fijo: las sparklines ahora se alinean verticalmente fila a fila, sin importar si el precio es $452 o $8.342.000.",
    ],
  },
  {
    version: "0.0.51",
    title: "Sembrar red social para el demo",
    bullets: [
      "Botón \"Sembrar red social\" en Settings → Demo (idempotente).",
      "12 usuarios AR con posts, hilos, follows, likes y DMs.",
      "Edge Function seed-social-demo (service-role bypassa RLS).",
    ],
  },
  {
    version: "0.0.41",
    title: "Pantalla de Novedades",
    bullets: [
      "Nueva sección Acerca de → Novedades con el changelog.",
      "Lista todas las versiones recientes con un resumen por release.",
    ],
  },
  {
    version: "0.0.40",
    title: "Seguidores y privacidad",
    bullets: [
      "Tap en el contador de seguidores / siguiendo abre la lista.",
      "Política de privacidad y Términos de uso integrados en Settings.",
    ],
  },
  {
    version: "0.0.39",
    title: "Pegar OTP, portafolio y hashtags",
    bullets: [
      "Pegar código en el SMS de WhatsApp — cero alt-tab.",
      "Botón Pegar mi portafolio: snapshot de tus holdings al compose.",
      "#hashtags clicables y lightbox de imágenes a fullscreen.",
    ],
  },
  {
    version: "0.0.38",
    title: "Fotos en posts",
    bullets: [
      "Adjuntá fotos a tus posts (cámara o galería iOS).",
      "Storage bucket público con RLS por usuario, 8 MB max.",
    ],
  },
  {
    version: "0.0.37",
    title: "Defensas en News y @menciones",
    bullets: [
      "News no se queda colgado: timeouts en cada paso + retry.",
      "@menciones clicables abren el perfil; \"Se unió en abril 2026\".",
    ],
  },
  {
    version: "0.0.36",
    title: "CNV idóneo, Trending y swipe-to-delete",
    bullets: [
      "Nueva insignia azul CNV idóneo además de la verde de universidad.",
      "Pestaña Trending: posts ranqueados por likes + reposts + comments.",
      "Swipe a la izquierda para borrar tus propios posts.",
    ],
  },
  {
    version: "0.0.35",
    title: "Verificación de universidad argentina",
    bullets: [
      "Dropdown de universidades en signup con 13 unis AR.",
      "Email institucional → insignia verde verificada al instante.",
    ],
  },
  {
    version: "0.0.34",
    title: "Polish del thread view",
    bullets: [
      "Nav inferior se oculta sobre overlays.",
      "Linkify y autoscroll en DMs y respuestas.",
    ],
  },
  {
    version: "0.0.33",
    title: "Editar perfil",
    bullets: [
      "Sheet de edición desde Settings: handle, nombre, bio, color.",
      "Validación de handle disponible en tiempo real.",
    ],
  },
  {
    version: "0.0.32",
    title: "Tap-anywhere-on-post",
    bullets: [
      "Cualquier parte del post abre el thread, sin pelear con los botones.",
    ],
  },
];

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
