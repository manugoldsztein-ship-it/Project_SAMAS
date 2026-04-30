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
import { hapticNative } from "../lib/native.js";
import { deleteAccount, exportData } from "../lib/account.js";
import { LivePricesProvider } from "./livePrices.jsx";

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
  // ProPricingSheet — second step of the activation flow, opened
  // from the upsell modal's CTA. Lives at the shell level so it can
  // outlive the upsell modal's own dismissal.
  const [showProPricing, setShowProPricing] = useState(false);
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

  // Notification → Social handoff (samas-0.0.73). Tapping a social
  // notification in the Wallet bell inbox dispatches one of two
  // events with the target id. We stash that id in localStorage and
  // switch to the Social tab; SocialPage's mount-effect reads the
  // briefcase and drills into ProfileView or ThreadView accordingly.
  // Same pattern as share-trade / share-watchlist above.
  useEffect(() => {
    function onOpenProfile(e) {
      try {
        const userId = e?.detail?.userId;
        if (!userId) return;
        localStorage.setItem("samas_pending_profile_id", userId);
      } catch {}
      setTab("social");
    }
    function onOpenThread(e) {
      try {
        const postId = e?.detail?.postId;
        if (!postId) return;
        localStorage.setItem("samas_pending_thread_post_id", postId);
      } catch {}
      setTab("social");
    }
    window.addEventListener("samas:open-profile", onOpenProfile);
    window.addEventListener("samas:open-thread", onOpenThread);
    return () => {
      window.removeEventListener("samas:open-profile", onOpenProfile);
      window.removeEventListener("samas:open-thread", onOpenThread);
    };
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
        lang={lang}
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
    <LivePricesProvider>
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
      {/* Global animation styles — injected once at the shell root so
          every interactive element in the tree picks them up. Two
          rules:
            1. Universal press-down: every button shrinks slightly
               while active. Adds a tactile "this is responsive"
               feel without per-component plumbing. We exclude the
               edge-swipe-back transform which lives on a div, not a
               button, and we exclude already-disabled buttons.
            2. samas-action-bump: the heart-bounce keyframe used by
               ActionBtn in Social.jsx when likedByMe flips on. Same
               keyframes tag works for any element that wants the
               "you tapped me" pop. */}
      <style>{`
        button:active:not(:disabled),
        [role="button"]:active:not([aria-disabled="true"]),
        .samas-pressable:active {
          transform: scale(0.97);
          transition: transform 80ms ease-out;
        }
        button:not(:active):not(:disabled),
        [role="button"]:not(:active):not([aria-disabled="true"]),
        .samas-pressable:not(:active) {
          transition: transform 140ms ease-out;
        }
        /* Tab content cross-fade (samas-0.0.81). The wrapper is keyed
           on the active tab id, so React re-mounts when the user
           switches and the keyframe fires fresh each time. Subtle —
           opacity 0→1 with a 4px translate so it reads as "the new
           page eased in" instead of "snap". 160ms is fast enough to
           not feel laggy on rapid taps but slow enough to be visible. */
        .samas-tab-content {
          animation: samas-tab-fade 160ms ease-out;
        }
        /* Opacity-only — no transform. Earlier we used translate3d(0,4px,0)
           for a subtle slide, but on iOS WebKit that promotes the
           wrapper to a compositing layer which behaves like a persistent
           stacking context. Children with position:fixed couldn't
           escape past the bottom nav (zIndex 40) because their zIndex
           only applied within that trapped layer. Pure opacity has no
           such side-effect. samas-0.0.83 fix. */
        @keyframes samas-tab-fade {
          0%   { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes samas-action-bump {
          0%   { transform: scale(1); }
          30%  { transform: scale(1.4); }
          60%  { transform: scale(0.92); }
          100% { transform: scale(1); }
        }
        /* Live-price tick flashes — applied to a price cell whose
           key changes each tick so the animation re-runs. The tint
           is loud at the start and fades to transparent over 600ms,
           which reads as "something just changed" without lingering
           in the user's peripheral vision. */
        @keyframes samas-tick-up {
          0%   { background-color: rgba(22, 199, 132, 0.30); }
          100% { background-color: transparent; }
        }
        @keyframes samas-tick-down {
          0%   { background-color: rgba(239, 68, 68, 0.30); }
          100% { background-color: transparent; }
        }
        /* Shimmer for the <Skeleton> primitive in shared.jsx —
           defined once globally instead of being re-injected by
           every Skeleton instance. */
        @keyframes samas-skel {
          0%   { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
        /* DoneScreen entry animations (samas-0.0.70). The success
           checkmark scales in with overshoot, then the path strokes
           itself in. Confetti pieces fall + rotate + fade — pure CSS,
           no JS / canvas. */
        @keyframes samas-done-circle-in {
          0%   { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.18); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes samas-done-check-draw {
          0%   { stroke-dashoffset: 32; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes samas-confetti-fall {
          0%   { transform: translate3d(0, -8px, 0) rotate(0deg); opacity: 1; }
          70%  { opacity: 1; }
          100% { transform: translate3d(var(--cx, 0), var(--cy, 80px), 0) rotate(var(--cr, 360deg)); opacity: 0; }
        }
        /* Promoted to global (samas-0.0.83) — used by AIAnalysisCard's
           result sheet + the existing inline modal spinners. Both were
           previously defined in scoped style blocks (Shell SettingsSheet,
           Broker InitialLoader) which only loaded when those components
           mounted; promoting them here so any component can rely on them. */
        @keyframes samas-sheet-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes samas-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes samas-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* ---------- scrollable page content ----------
          The keyed inner div re-mounts on every base-tab switch so
          the .samas-tab-content fade-in animation fires fresh — no
          more hard snap between Wallet ↔ News. */}
      <ScrollWithPTR T={T} tab={baseTab}>
        <div key={baseTab} className="samas-tab-content">
          {renderTab()}
        </div>
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
          "samas:open-pro-upsell" or pass onOpenProUpsell down. The
          CTA opens the pricing sheet rather than flipping proMode
          directly so the user (and a Cohen pitch attendee) actually
          sees what Pro costs and how the activation flow looks. */}
      {showProUpsell && (
        <ProUpsellModal
          T={T}
          lang={lang}
          isPro={proMode}
          onActivate={() => { setShowProUpsell(false); setShowProPricing(true); }}
          onClose={() => setShowProUpsell(false)}
        />
      )}

      {/* Pro pricing sheet — second step of the activation flow.
          Suscribirme is currently faked (no real billing yet), but
          flipping proMode + showing the success toast is enough for
          the pitch demo and for users to see the Pro screens. */}
      {showProPricing && (
        <ProPricingSheet
          T={T}
          lang={lang}
          onSubscribe={() => {
            setProMode(true);
            setShowProPricing(false);
            toast.success(tr("pro.pricing.success", lang));
          }}
          onClose={() => setShowProPricing(false)}
        />
      )}
    </div>
    </LivePricesProvider>
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

  // App Store self-service flows (Guideline 5.1.1(v)). Both call
  // their respective Edge Functions; UI state mirrored locally.
  // Export: showExport drives the modal visibility, exportPayload
  // holds the JSON string once the function returns. Delete:
  // showDelete drives the type-to-confirm modal, deleteTyped is
  // the user's input (we enable the destructive button only when
  // it matches the keyword).
  const [exportingBusy, setExportingBusy] = useState(false);
  const [exportPayload, setExportPayload] = useState(null);
  const [exportCopied, setExportCopied]   = useState(false);
  const [showDelete, setShowDelete]       = useState(false);
  const [deleteTyped, setDeleteTyped]     = useState("");
  const [deleting, setDeleting]           = useState(false);
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

        {/* ---------- My account section ----------
            App Store Guideline 5.1.1(v) requires apps that create
            accounts to surface (1) a way for the user to delete
            theirs, and (2) a way to download their data. Both are
            backed by Edge Functions that use the service role to
            do the heavy lifting (RLS-bypass + auth.admin.deleteUser).
            See supabase/functions/delete-user-account/index.ts and
            supabase/functions/export-user-data/index.ts. */}
        <div style={{
          marginTop: 6, marginBottom: 6,
          fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
          color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
          padding: "0 4px",
        }}>
          {tr("settings.section.legal_account", lang)}
        </div>
        {/* Descargar mis datos */}
        <button
          disabled={exportingBusy}
          onClick={async () => {
            if (exportingBusy) return;
            setExportingBusy(true);
            setExportCopied(false);
            try {
              const data = await exportData();
              setExportPayload(JSON.stringify(data, null, 2));
            } catch (e) {
              toast.error(tr("settings.account.export_fail", lang, {
                error: e?.message || String(e),
              }));
            } finally {
              setExportingBusy(false);
            }
          }}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 8,
            background: T.surface, border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            cursor: exportingBusy ? "default" : "pointer", textAlign: "left",
            opacity: exportingBusy ? 0.6 : 1,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
              {tr("settings.account.export", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              {exportingBusy
                ? tr("settings.account.export_running", lang)
                : tr("settings.account.export_sub", lang)}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
        {/* Borrar mi cuenta — destructive border + danger color so the
            user understands the gravity at a glance. The actual
            confirm flow happens in the modal below; tapping this
            row only opens that. */}
        <button
          onClick={() => { setDeleteTyped(""); setShowDelete(true); }}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 14,
            background: T.surface, border: `1px solid ${T.danger}55`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            cursor: "pointer", textAlign: "left",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.danger }}>
              {tr("settings.account.delete", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              {tr("settings.account.delete_sub", lang)}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.danger} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

      {/* Export-data sub-sheet — shows the JSON returned by the
          export-user-data Edge Function in a scrollable code
          block + a Copy button. We use clipboard.writeText
          (works in WKWebView under Capacitor 8+) instead of
          file save because no @capacitor/filesystem plugin is
          installed yet; the user can paste the JSON anywhere
          (Notes, Mail, Drive). Satisfies App Store data-export
          requirement. */}
      {exportPayload && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) { setExportPayload(null); setExportCopied(false); } }}
          style={{
            position: "fixed", inset: 0, zIndex: 130,
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
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 12 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border }}/>
            </div>
            <div style={{ padding: "16px 22px 8px" }}>
              <div style={{
                fontFamily: FONT.display, fontSize: 20, fontWeight: 700,
                color: T.text, marginBottom: 6,
              }}>{tr("settings.account.export_ready", lang)}</div>
              <div style={{
                fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
                lineHeight: 1.45,
              }}>{tr("settings.account.export_ready_sub", lang)}</div>
            </div>
            <div style={{
              flex: 1, overflow: "auto",
              margin: "0 18px 12px", padding: 14, borderRadius: 14,
              background: T.surface, border: `1px solid ${T.border}`,
              fontFamily: FONT.mono, fontSize: 11, lineHeight: 1.4,
              color: T.textMute, whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>{exportPayload}</div>
            <div style={{
              padding: "12px 18px calc(env(safe-area-inset-bottom) + 16px)",
              borderTop: `1px solid ${T.border}`,
              background: T.bgElev || T.bg,
              display: "flex", gap: 10,
            }}>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(exportPayload);
                    setExportCopied(true);
                    hapticNative("success").catch(() => {});
                    toast.success(tr("settings.account.export_copied", lang));
                  } catch (e) {
                    toast.error(`Clipboard: ${e?.message || String(e)}`);
                  }
                }}
                style={{
                  flex: 2, padding: "13px 16px", borderRadius: 14,
                  background: exportCopied ? T.accentSoft : T.accent,
                  border: "none",
                  color: exportCopied ? T.accent : T.accentInk,
                  fontFamily: FONT.sans, fontSize: 14, fontWeight: 800,
                  cursor: "pointer", letterSpacing: 0.2,
                }}
              >
                {exportCopied
                  ? tr("settings.account.export_copied", lang)
                  : tr("settings.account.export_copy", lang)}
              </button>
              <button
                onClick={() => { setExportPayload(null); setExportCopied(false); }}
                style={{
                  flex: 1, padding: "13px 16px", borderRadius: 14,
                  background: "transparent", border: `1px solid ${T.border}`,
                  color: T.text, fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
                  cursor: "pointer",
                }}
              >{tr("settings.done", lang)}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete-account sub-sheet — type-to-confirm modal. We require
          the user to type the literal keyword (BORRAR / DELETE based
          on lang) so a stray tap can't take down their data, and
          App Store reviewers see the affirmative-confirmation pattern
          they expect. The destructive button is disabled until the
          input matches exactly. */}
      {showDelete && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setShowDelete(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 130,
            background: "rgba(0,0,0,0.7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div style={{
            width: "100%", maxWidth: 420,
            background: T.bgElev || T.bg, color: T.text,
            borderRadius: 22, border: `1px solid ${T.border}`,
            padding: 20,
          }}>
            <div style={{
              fontFamily: FONT.display, fontSize: 18, fontWeight: 700,
              color: T.danger, marginBottom: 8,
            }}>{tr("settings.account.delete_title", lang)}</div>
            <div style={{
              fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
              lineHeight: 1.5, marginBottom: 14,
            }}>{tr("settings.account.delete_warning", lang)}</div>
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.text,
              marginBottom: 8,
            }}>{tr("settings.account.delete_type", lang)}</div>
            <input
              value={deleteTyped}
              onChange={(e) => setDeleteTyped(e.target.value)}
              disabled={deleting}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder={tr("settings.account.delete_placeholder", lang)}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 12,
                background: T.surface, border: `1px solid ${T.border}`,
                color: T.text, fontFamily: FONT.mono, fontSize: 14, fontWeight: 700,
                outline: "none", letterSpacing: 1.2, marginBottom: 16,
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { if (!deleting) setShowDelete(false); }}
                disabled={deleting}
                style={{
                  flex: 1, padding: "12px 14px", borderRadius: 12,
                  background: "transparent", border: `1px solid ${T.border}`,
                  color: T.text, fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
                  cursor: deleting ? "default" : "pointer",
                }}
              >{tr("settings.account.delete_cancel", lang)}</button>
              <button
                disabled={deleting || deleteTyped.trim().toUpperCase() !== tr("settings.account.delete_keyword", lang)}
                onClick={async () => {
                  if (deleting) return;
                  setDeleting(true);
                  try {
                    await deleteAccount();
                    toast.success(tr("settings.account.delete_done", lang));
                    // Close everything; the auth-state-change in
                    // App.jsx will route to the login screen now
                    // that signOut() ran inside deleteAccount.
                    setShowDelete(false);
                    if (onClose) onClose();
                  } catch (e) {
                    toast.error(tr("settings.account.delete_fail", lang, {
                      error: e?.message || String(e),
                    }));
                  } finally {
                    setDeleting(false);
                  }
                }}
                style={{
                  flex: 2, padding: "12px 14px", borderRadius: 12,
                  background: T.danger, border: "none",
                  color: "#fff", fontFamily: FONT.sans, fontSize: 13, fontWeight: 800,
                  cursor: (deleting || deleteTyped.trim().toUpperCase() !== tr("settings.account.delete_keyword", lang)) ? "default" : "pointer",
                  opacity: (deleting || deleteTyped.trim().toUpperCase() !== tr("settings.account.delete_keyword", lang)) ? 0.5 : 1,
                  letterSpacing: 0.2,
                }}
              >
                {deleting
                  ? tr("settings.account.delete_running", lang)
                  : tr("settings.account.delete_confirm", lang)}
              </button>
            </div>
          </div>
        </div>
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
// ProPricingSheet — "Suscribirme a Pro" plan selector
// ============================================================
// Reachable from the ProUpsellModal CTA. Two plans (monthly and
// annual), annual highlighted as the recommended pick because it's
// cheaper per month — same trick every consumer SaaS uses.
//
// The "Suscribirme" button does NOT yet hit App Store IAP — that's
// a separate cert + StoreKit wiring task. For the Cohen pitch and
// the prototype it fakes a ~700ms processing delay (so the user
// feels something happening), then activates Pro mode locally and
// shows a success toast. The legal blurb at the bottom flags this
// honestly so a tester reading carefully understands no money
// changed hands.
//
// Prices are in USD on purpose — Cohen will want to see a global
// monetization story, and CEDEAR/crypto users in AR think in dólares
// for subscription pricing anyway.
// ============================================================
function ProPricingSheet({ T, lang = "es", onSubscribe, onClose }) {
  const [plan, setPlan] = useState("annual"); // "monthly" | "annual"
  const [busy, setBusy] = useState(false);

  async function handleSubscribe() {
    if (busy) return;
    setBusy(true);
    // Light haptic the moment the user commits — same pattern as
    // App Store IAP feels on iOS. Fire-and-forget; we don't block
    // the UI on the haptic call.
    hapticNative("tap").catch(() => {});
    // Fake processing delay so the demo feels real. ~700ms is the
    // sweet spot — long enough to read as "doing something",
    // short enough that the investor doesn't think we hung.
    await new Promise((r) => setTimeout(r, 700));
    // Success haptic on completion — the iOS notification-style
    // double-tap pattern that broker / payment apps fire on a
    // confirmed transaction.
    hapticNative("success").catch(() => {});
    onSubscribe(plan);
    setBusy(false);
  }

  // Plan card — selectable button styled like a radio. When picked,
  // accent border + accent-soft tint background. The annual card
  // also shows a "Ahorrá 20%" chip and a star icon.
  function PlanCard({ id, label, price, period, hint, recommended }) {
    const active = plan === id;
    return (
      <button
        onClick={() => setPlan(id)}
        style={{
          width: "100%", padding: "14px 16px", borderRadius: 16,
          background: active ? T.accentSoft : T.surface,
          border: `1.5px solid ${active ? T.accent : T.border}`,
          display: "flex", alignItems: "center", gap: 12,
          cursor: "pointer", textAlign: "left", position: "relative",
        }}
      >
        {/* Radio dot — filled accent when active. */}
        <div style={{
          width: 20, height: 20, borderRadius: 10,
          border: `2px solid ${active ? T.accent : T.border}`,
          background: "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          {active && (
            <div style={{
              width: 10, height: 10, borderRadius: 5, background: T.accent,
            }}/>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontFamily: FONT.sans, fontSize: 14, fontWeight: 700,
            color: T.text, marginBottom: 2,
          }}>
            {label}
            {recommended && (
              <span style={{
                fontFamily: FONT.mono, fontSize: 9, fontWeight: 800,
                padding: "2px 6px", borderRadius: 999,
                background: T.accent, color: T.accentInk,
                letterSpacing: 0.6, textTransform: "uppercase",
              }}>★ {tr("pro.pricing.save", lang)}</span>
            )}
          </div>
          {hint && (
            <div style={{
              fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
            }}>{hint}</div>
          )}
        </div>
        <div style={{
          textAlign: "right",
          fontFamily: FONT.display,
          fontVariantNumeric: "tabular-nums",
        }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.text, lineHeight: 1.1 }}>
            {price}
          </div>
          <div style={{ fontFamily: FONT.sans, fontSize: 11, fontWeight: 600, color: T.textMute }}>
            {period}
          </div>
        </div>
      </button>
    );
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 130,
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

        {/* Header */}
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
          }}>★ PRO</div>
          <div style={{
            fontFamily: FONT.display, fontSize: 24, fontWeight: 700,
            color: T.text, letterSpacing: -0.6, marginBottom: 6,
          }}>{tr("pro.pricing.title", lang)}</div>
          <div style={{
            fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
            lineHeight: 1.45,
          }}>{tr("pro.pricing.subtitle", lang)}</div>
        </div>

        {/* Plans */}
        <div style={{
          flex: 1, overflowY: "auto",
          padding: "8px 18px 12px",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <PlanCard
            id="monthly"
            label={tr("pro.pricing.monthly", lang)}
            price="USD 5"
            period={tr("pro.pricing.per_month", lang)}
            hint={null}
          />
          <PlanCard
            id="annual"
            label={tr("pro.pricing.annual", lang)}
            price="USD 48"
            period={tr("pro.pricing.per_year", lang)}
            hint={tr("pro.pricing.annual_hint", lang)}
            recommended
          />

          {/* What's included — compact reminder of the 9 Pro features
              the user already saw on the upsell modal. We re-render
              them here as a tight checklist so the pricing screen
              answers "what am I paying for?" without making the user
              go back. Reuses existing pro.upsell.feat.* keys. */}
          <div style={{
            marginTop: 14, padding: "12px 14px", borderRadius: 14,
            background: T.surface, border: `1px solid ${T.border}`,
          }}>
            <div style={{
              fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
              color: T.textMute, letterSpacing: 0.5, textTransform: "uppercase",
              marginBottom: 8,
            }}>{tr("pro.pricing.includes", lang)}</div>
            {PRO_FEATURE_KEYS.map((f) => (
              <div key={f.key} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 0",
                fontFamily: FONT.sans, fontSize: 13, color: T.text,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke={T.accent} strokeWidth="3"
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0 }}>
                  <polyline points="6 12 10 16 18 8"/>
                </svg>
                <span>{tr(`pro.upsell.feat.${f.key}`, lang)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sticky CTA + legal blurb */}
        <div style={{
          padding: "12px 18px calc(env(safe-area-inset-bottom) + 16px)",
          borderTop: `1px solid ${T.border}`,
          background: T.bgElev || T.bg,
        }}>
          <button
            onClick={handleSubscribe}
            disabled={busy}
            style={{
              width: "100%", padding: "14px 16px", borderRadius: 14,
              background: T.accent, border: "none",
              color: T.accentInk, fontFamily: FONT.sans, fontSize: 15, fontWeight: 800,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.7 : 1,
              letterSpacing: 0.2,
              marginBottom: 8,
            }}
          >
            {busy ? tr("pro.pricing.cta_busy", lang) : tr("pro.pricing.cta_subscribe", lang)}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              width: "100%", padding: "10px", borderRadius: 12,
              background: "transparent", border: "none",
              color: T.textMute, fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
              cursor: busy ? "default" : "pointer",
              marginBottom: 6,
            }}
          >{tr("pro.pricing.cta_later", lang)}</button>
          <div style={{
            fontFamily: FONT.sans, fontSize: 10, color: T.textMute,
            textAlign: "center", lineHeight: 1.45,
          }}>{tr("pro.pricing.legal", lang)}</div>
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
    version: "0.0.95",
    title: "AI Trade Coach — sanity check before you confirm an order",
    bullets: [
      "New AI surface: every order's confirmation step now shows a Coach IA card above the Cancelar / Confirmar buttons. Auto-fires when the modal opens. Reads the user's holdings via JWT-scoped RLS, weighs the pending trade against the existing book, returns a verdict (Va / Atención / Revisar) + a one-line headline + a reason.",
      "Coach catches things like: \"$NVDA llegaría al 47% de tu cartera — concentración alta\", \"Estás cerrando 100% de tu posición en $YPF, asegurate que cambió la tesis\", \"Tu exposición a CEDEARs pasaría a 73%, mucho peso en una categoría\". Doesn't recommend buy/sell directly, just flags structural risk + sanity.",
      "New analyze-coach Edge Function (Claude Haiku, JWT-scoped, templated heuristic fallback). Heuristic verdict uses real concentration math + sector mix so the demo works without an Anthropic key.",
      "If the AI errors, the Coach card silently hides — never blocks the trade flow. Cohen demo: tap any asset → buy 100 NVDA → confirmation shows AI weighing in before the user taps Confirmar.",
    ],
  },
  {
    version: "0.0.94",
    title: "Revert TradingView — back to SVG chart",
    bullets: [
      "Manuel screenshotted blank chart through 0.0.90/91/92/93 across multiple fix attempts. Lightweight Charts wouldn't render in this Capacitor WebView setup despite static imports, single-effect, ISO date strings, width fallbacks, autoSize. Without remote devtools access on the device I can't dig deeper without burning more time.",
      "Reverting to the hand-rolled SVG line chart from before 0.0.90. Cohen demo gets a working chart back. TradingView is parked as a future-Pro feature for after we can connect Safari Web Inspector to the device and see what's actually failing.",
      "Removed the lightweight-charts dependency from package.json (~63KB gzipped lib gone) and the Velas/Área toggle (no candlestick option in SVG mode).",
    ],
  },
  {
    version: "0.0.93",
    title: "Chart third-time-fix: single effect + ISO date strings",
    bullets: [
      "0.0.92 still showed empty candles even though chart + crosshair rendered. Root cause was probably the two-useEffect dance combined with React 18 StrictMode double-mount: the chart re-created but the series effect didn't reliably re-fire on the second mount, leaving the chart with no series.",
      "Fix: collapsed both effects into ONE. createChart + addSeries + setData all happen in the same effect body. No inter-effect state drift, no race. Re-runs on theme / chart-type / data / tf change. Slight perf cost (chart re-mounts on candles↔área toggle) but it's fast and reliable.",
      "Time format: switched from Unix-seconds to ISO 'YYYY-MM-DD' strings. LWC accepts both but strings are more permissive about gaps and easier to debug. Each candle gets a unique ascending date.",
    ],
  },
  {
    version: "0.0.92",
    title: "Fix again: chart still blank — singlefile + width=0 culprits",
    bullets: [
      "0.0.91 fixed the race but Manuel still saw a blank chart. Two more issues with the Capacitor build: (1) vite-plugin-singlefile inlines everything into one HTML; dynamic import() can be flaky in that mode. Switched to static import — Lightweight Charts ships in the main bundle now (~63KB gzipped, free in singlefile mode where everything's already inlined).",
      "(2) Container clientWidth could be 0 at mount time when the AssetSheet was mid-slide-up. Added a fallback chain (container.clientWidth → parent's width → window-innerWidth - 64) plus minimum 280px floor so createChart always gets a positive width. Also enabled autoSize: true so the lib observes container size changes internally.",
      "Added try/catch around createChart + addSeries with console.warn so any future failure shows up in iOS Safari Web Inspector instead of silent blank-chart. Static-import path means the race-condition guard from 0.0.91 isn't strictly needed but stays in place as belt-and-braces.",
    ],
  },
  {
    version: "0.0.91",
    title: "Fix: empty chart in 0.0.90 — race condition + TV watermark",
    bullets: [
      "Manuel screenshotted GGAL with a blank chart area + a TV watermark in the corner. Two bugs in 0.0.90: (1) the series-add useEffect ran BEFORE the chart-create useEffect's dynamic import resolved, so it bailed on null chartRef and never re-ran. The chart was created but no candles/area got attached. (2) Lightweight Charts v5 ships with a TradingView attribution watermark that's on by default.",
      "Fix 1: new chartReady state flips true after createChart resolves; the series effect lists chartReady in its deps so it re-fires once the chart exists. Series gets attached, data renders.",
      "Fix 2: layout.attributionLogo: false on createChart — the TV watermark is gone. We keep our own subtle \"TRADINGVIEW\" mono-stamp below the chart for proper attribution.",
    ],
  },
  {
    version: "0.0.90",
    title: "TradingView Lightweight Charts on every asset",
    bullets: [
      "ProAssetChart upgraded from a hand-rolled SVG line to TradingView's open-source Lightweight Charts library (45KB, MIT licensed). Real candlestick series with proper price + time scales, crosshair, magnet snapping, dashed grid — the visual upgrade is substantial.",
      "Two modes via a Velas / Área toggle right under the chart: Velas shows OHLC candles (the TradingView signature look), Área shows the smooth area chart that matches Apple Stocks. Same data underneath; just two ways to visualize it.",
      "Each timeframe maps to a sensible candle interval — 1D = hourly bars, 1W = 6-hour bars, 1M = daily, 1Y = weekly, Todo = monthly. The deterministic random-walk we already had now produces synthetic OHLC (open=prev close, close=new value, high/low ±small wick noise) so the candles look real.",
      "Themed to SAMAS dark — accent green for up, danger red for down, transparent background, mono-stamp axes. Auto-resizes via ResizeObserver. Imported lazily so the 45KB doesn't bloat the initial bundle.",
    ],
  },
  {
    version: "0.0.89",
    title: "Preguntale a SAMAS — multi-turn AI chat about your portfolio",
    bullets: [
      "New \"Preguntale a SAMAS\" card on Wallet (right under Análisis IA). Tap → 92vh chat sheet slides up. Type a question, hit Send, get an answer that has YOUR portfolio in context. Multi-turn — keep going, follow-ups respect previous turns. Empty state has 3 starter prompts (diversification / performance / next move) so the user can demo without thinking up a question.",
      "Edge Function: supabase/functions/chat-portfolio/index.ts. Reads holdings via JWT-scoped RLS, builds a Spanish system prompt with a JSON dump of the user's positions + value-weighted gain%, sends the trimmed conversation history (last 12 turns) to Claude Haiku with the system prompt. 600 max_tokens for crisp 2-4 sentence replies.",
      "Templated server-side fallback when ANTHROPIC_API_KEY isn't set — keyword matching against the latest user message (concentración / diversificar / vender / comprar / etc.) plus real portfolio facts. Demoable today, no key required.",
      "UI niceties: thinking dots while waiting, auto-scroll to newest message, Enter sends + Shift+Enter newline, conversation persists across close+reopen until you tap Nueva.",
    ],
  },
  {
    version: "0.0.88",
    title: "AI compose helper — \"Sugerime un post\"",
    bullets: [
      "New ✦ button in the compose toolbar (left of Compartir cartera). Tap → server reads your holdings + last 3 trades via JWT-scoped RLS, asks Claude Haiku to draft a short social-style post (220 char cap) referencing one of your real positions, fills the textarea. Spinner inside the button while it thinks.",
      "Edge Function: supabase/functions/draft-post/index.ts. Templated fallback when ANTHROPIC_API_KEY isn't set picks your most recent trade or top holding and fills one of several sentence templates with real numbers (gain%, % of book, ticker name) — sounds like a real person before we wire the LLM.",
      "If you've already typed something in the textarea, we ask before overwriting. Otherwise the draft fills directly + focuses + auto-expands the compose so you can tweak before posting.",
    ],
  },
  {
    version: "0.0.87",
    title: "Nav-covers-content fix — global, not per-sheet",
    bullets: [
      "Real fix for the recurring \"floating bottom nav covers a sheet/menu\" bug. Root cause: BrokerShell + SocialPage + each drill-in overlay used a translateX-based slide-in entry animation; on iOS WebKit, translateX promotes the element to a persistent GPU compositing layer that behaves like a stacking context. Children with position:fixed got their z-index scoped to that trapped layer instead of the document root, so anything anchored at the bottom of the viewport (Comparar activos sheet, modals, AI sheets, etc.) lost the z-index race against the floating nav at zIndex 40.",
      "Fix: new useShellEntryDone hook (in shared.jsx). 260ms after mount it flips the shell's animation property to \"none\", which lets WebKit drop the compositing layer. Now position:fixed inside the shell renders against document root again. Applied to: BrokerShell, SocialPage main, plus 4 drill-in overlays (profile / thread / ticker / follow-list) via a new DrillInOverlay wrapper.",
      "Belt-and-braces: CompareSheet (the one Manuel screenshotted being covered) ALSO portaled to document.body — survives even if someone re-introduces a transform animation upstream.",
    ],
  },
  {
    version: "0.0.86",
    title: "AssetSheet alignment sweep — AI Insight chrome matches siblings",
    bullets: [
      "Fix: AI INSIGHT card on the AssetSheet had its header (icon + label + sentiment chip) floating OUTSIDE the card's padding line — visually misaligned with FUNDAMENTALS, RANGE, and the rest of the AssetSheet sections. Now uses the same card chrome (margin: 0 0 18px, padding: 14px 16px, borderRadius: 18) and the title typography matches the other section titles (mono 11 textMute uppercase). Header icon shrunk from 26 to 22px so the row height matches sibling card title rows.",
      "Bullet dots in the AI insight realigned: 8px circles with 6px top offset center on the first line of 13px text instead of sitting 4px below it. Wallet's numbered-bullet badges also got alignItems: flex-start so multi-line bullets don't stretch the badge to full row height.",
      "Loading + idle states no longer have nested-card chrome — they live INSIDE the same outer card now, so the section reads as one coherent unit instead of \"label outside · button inside · result inside another card\".",
    ],
  },
  {
    version: "0.0.85",
    title: "AI insight on every asset — tap a ticker, get a take",
    bullets: [
      "Tap any asset (NVDA / GGAL / AAPL / BTC / etc.) → the detail sheet now has an \"Análisis IA\" section. Tap to generate a one-line headline + 3 short bullets (fundamentals / news / valuation) + a thesis statement + a sentiment chip (Alcista / Neutral / Bajista).",
      "New analyze-asset Edge Function (twin of analyze-portfolio): takes a ticker, calls Claude Haiku, returns the structured response. Server-side templated fallback uses a curated per-ticker thesis library when ANTHROPIC_API_KEY isn't set — AAPL / NVDA / TSLA / GGAL / YPF / etc. each have their own pre-written take so the demo feels real before we wire the real LLM.",
      "Insights cached per-ticker per-session: re-opening the same asset's sheet doesn't burn another LLM call. Switching to a different ticker resets the panel cleanly.",
      "Visible to every user (not Pro-gated) — AI is the differentiator, Cohen needs to see this on every tap.",
    ],
  },
  {
    version: "0.0.84",
    title: "Bottom-nav stacking-context fix + AI demo fallback",
    bullets: [
      "Root-cause fix for the recurring \"bottom nav covers content / sheets\" bug. The samas-tab-fade animation (added in 0.0.81) used translate3d(0,4px,0) for a subtle slide; on iOS WebKit that promotes the wrapper to a persistent compositing layer that behaves like a stacking context, so children with position:fixed couldn't escape past the floating nav at zIndex 40. Switched to opacity-only animation — no transform, no trap. Fixes the AI sheet covering issue Manuel hit, plus any other in-page modal that was subtly being layered wrong.",
      "Belt-and-braces: AI analysis sheet is now portaled to document.body via React.createPortal. Even if some descendant adds a transform later, the sheet renders against the document root and z-index 100 wins.",
      "AI portfolio analysis works without an Anthropic key. The Edge Function detects the missing ANTHROPIC_API_KEY and falls back to a templated analysis built from the caller's actual portfolio data (concentration / win-loss split / sector mix). Shape-identical to the LLM response so the UI doesn't branch. Once you set the secret post-Cohen, real Claude responses replace the templates with zero code change.",
    ],
  },
  {
    version: "0.0.83",
    title: "AI portfolio analysis + compose layout fix",
    bullets: [
      "First real AI feature lands on Wallet: \"Análisis IA\" card. Tap → calls a new analyze-portfolio Edge Function that reads your holdings (RLS-scoped via JWT), passes them to Claude Haiku, and returns a one-line headline + 3 observations + concrete suggestion + concentration callout. Sheet animates up from the bottom with a thinking spinner, then renders the structured response. Result is cached for the session — re-tapping reopens without burning another LLM call.",
      "Edge Function: supabase/functions/analyze-portfolio/index.ts. Self-contained with the asset universe inline so it doesn't depend on the client bundle. Strict JSON-out prompt with hard length caps. ANTHROPIC_API_KEY env (already used by fetch-news) doubles as the auth here.",
      "Compose layout fix (the \"too much space, not centered\" thing): when there's a portfolio / trade / image attached, the textarea no longer expands to 7 rows on focus — stays at 3 so the attachment card sits flush with the placeholder. The huge dead-space-above-the-card visual went away.",
      "Promoted samas-sheet-up + samas-spin + samas-fade-in keyframes to the global Shell stylesheet so any sheet/spinner anywhere can rely on them (was previously scoped to specific component mount-times).",
    ],
  },
  {
    version: "0.0.82",
    title: "Bottom-nav clearance + compose-expand + Newest sort",
    bullets: [
      "Fixed: bottom nav covering content on big-screen iPhones. Replaced the hardcoded 110px bottom padding (17 sites) with calc(env(safe-area-inset-bottom) + 96px) so larger devices clear the floating tab bar properly. Last list item / menu / button no longer hides under the nav.",
      "Compose got real estate. Tapping the textarea now expands it ~3x taller (rows 3 → 7) and dims the rest of the page behind a backdrop. The compose floats above the bottom nav with a soft drop-shadow — feels like a sheet, not a static box. Tap-outside or hit Post to collapse.",
      "Social feed gets a \"Nuevos\" sub-tab next to Trending. Same scope, but ordered chronologically (newest first) instead of by engagement. Tab strip is now horizontally scrollable so the 5 tabs (Trending / Nuevos / Siguiendo / Trades / Carteras) fit on narrow phones without crushing labels.",
    ],
  },
  {
    version: "0.0.81",
    title: "UI polish: smoother tab transitions + extended press feedback",
    bullets: [
      "Every tab change now cross-fades in instead of snapping. New global .samas-tab-content class + samas-tab-fade keyframe (160ms ease-out, 4px subtle slide). Wired on the top-level Wallet/News/Invertir/Social switch, the Broker sub-tabs (Portafolio/Mercado/Watchlist/Órdenes), the Social outer nav (Feed/Search/Messages/Profile), and the FeedView inner tabs (Trending/Siguiendo/Trades/Carteras).",
      "Universal press-down feedback (already on <button>) now also fires for [role=\"button\"] elements and any element with the .samas-pressable class. Lets us add tactile press response to non-button list rows without re-tagging every site as <button>.",
      "Net effect: switching tabs feels iOS-native instead of \"web app snap\". Same React tree, just a wrapper div keyed on the active tab so re-mount triggers the keyframe each time.",
    ],
  },
  {
    version: "0.0.80",
    title: "Wallet moves to Supabase — balance + ledger fully durable",
    bullets: [
      "Step 3 of the persistence migration: cash balance (ARS + USD) and the transactions ledger now live in public.accounts + public.transactions. Reinstall the app and your saldo / movimientos are still there. Holdings + watchlists already moved in 0.0.76 + 0.0.78; with this patch every \"important\" piece of state is server-side.",
      "deposit / withdraw / swap each go through one helper that reads current balance, upserts the new value, and inserts a SIGNED-amount ledger row (positive=in, negative=out). SUM(amount) over the ledger reconciles the balance for free — useful when we want a server-side audit later.",
      "Bug fix: broker.js trade transactions (samas-0.0.76) were silently failing because the transactions.kind CHECK only allowed deposit/withdrawal/dividend/fee/adjustment. Loosened to also accept trade_buy / trade_sell / swap. From now on every fill writes a real ledger row.",
      "Demo seed now plants ~2.5M ARS + US$4,200 + 6 starter movements (deposit, swap legs, withdrawal, dividend) so the Wallet tab isn't an empty stage during the Cohen demo. Reset wipes accounts + transactions cleanly.",
    ],
  },
  {
    version: "0.0.79",
    title: "Portfolio shares: real card, can't be edited, dedicated tab",
    bullets: [
      "Portfolio sharing went from text-paste to a first-class post type. New posts.kind + posts.payload columns store the snapshot as structured jsonb (totalUsd / weighted gainPct / per-row holdings) — values come straight from the broker API and the user can't edit them in the textarea before posting. \"Verified by SAMAS\" badge on the card makes it visible.",
      "Compose UX: tapping \"Compartir cartera\" now attaches a read-only card preview above the textarea instead of dumping text. Body becomes optional commentary. Posts published with kind='portfolio' render the same card on the feed — accent border, gradient header, ticker chips that drill into per-asset feed.",
      "New \"Carteras\" sub-tab in the social feed. Filters posts where kind='portfolio' (backed by posts_kind_portfolio_idx partial index). Empty state has a single primary CTA that triggers sharePortfolio so the user lands on the compose with their own snapshot already attached.",
      "DB-side: posts_body_check loosened so portfolio posts can publish with an empty body (the card IS the post); text posts still require ≥1 char.",
    ],
  },
  {
    version: "0.0.78",
    title: "Watchlists move to Supabase — durable across reinstalls",
    bullets: [
      "Step 2 of the persistence migration: watchlists + their tickers now live in public.watchlists + public.watchlist_tickers (RLS-scoped to auth.uid). Create / rename / color-tag / reorder / delete all hit Supabase. Reinstall the app and your lists are still there.",
      "Reorder arrows now persist — watchlist_tickers stores an explicit position column, so the order you set sticks across sessions. No more \"why did NVDA jump back to the top\" after a relaunch.",
      "\"Cargar cuenta demo\" seeds three curated lists (Tecnología US / Acciones argentinas / Cripto, with color tags). \"Vaciar cuenta\" wipes them. Idempotent on re-run — re-tapping the seed button replaces the demo lists by name without touching anything you created.",
    ],
  },
  {
    version: "0.0.77",
    title: "Portfolio share: front-and-center in social compose",
    bullets: [
      "The compose toolbar's \"Pegar mi portafolio\" button got promoted from a tiny 36px circle to a labeled accent-bordered pill (\"Compartir cartera\" + pie-chart glyph). It's now the first action you read in the toolbar — impossible to miss during the Cohen demo.",
      "For-you empty state gets a secondary \"O compartí tu cartera\" CTA next to the existing \"Escribir una idea\" button. New accounts that land on an empty feed now see two equally-weighted ways to break the silence: write a thought, or hand-paste a snapshot of their book.",
      "Two new i18n keys (social.compose.portfolio_chip + social.feed.empty.cta_portfolio) wired in es + en. Existing portfolio-share plumbing untouched — this is purely visual emphasis.",
    ],
  },
  {
    version: "0.0.76",
    title: "Real persistence: holdings + orders move to Supabase",
    bullets: [
      "Mindset shift — treating SAMAS as the actual app, not a demo. Step 1 of the migration: holdings + orders + trade-ledger transactions now live in Supabase (RLS-scoped to auth.uid). Reinstall the app and your portfolio is preserved instead of vanishing.",
      "placeOrder is now an end-to-end pipeline: insert into orders → upsert holdings (computes weighted-avg cost on buys, deletes the row on full sells) → insert into transactions (audit log of every trade with sign convention buy=negative cash, sell=positive).",
      "Sell pre-check reads holdings before inserting the order so we don't end up with a \"filled\" sell against no position. cancelOrder is temporarily disabled — schema lacks an UPDATE policy on orders; tracked as a follow-up.",
      "Settings → \"Cargar cuenta demo\" now upserts 7 demo holdings into Supabase (idempotent on re-run); \"Vaciar cuenta\" deletes holdings + trade transactions. Watchlists / wallet balance still localStorage; they migrate in 0.0.77 / 0.0.78.",
    ],
  },
  {
    version: "0.0.75",
    title: "DM conversation: timestamps, date dividers, read receipts",
    bullets: [
      "Every bubble now shows its time underneath in tabular-nums (HH:MM 24h). Long threads finally read like a real DM app instead of a stack of body text.",
      "Date dividers (Hoy / Ayer / Lunes / 12 abr) appear between consecutive messages from different days — uppercase pill, surface bg, subtle.",
      "Read receipt: the last own message that the peer has read shows \"· Leído\" in accent color next to its timestamp. Pulled from dm_messages.read_at via the existing schema.",
      "Loading state replaced with 5 bubble-shaped shimmer skeletons (mixed left/right alignment, varied widths) so the silhouette of a real conversation is visible while messages load.",
    ],
  },
  {
    version: "0.0.74",
    title: "Inbox rows: real user avatars instead of generic emojis",
    bullets: [
      "0.0.73 used the 👤 emoji as the icon for social_follow rows. iOS rendered it as a dim generic contact silhouette and 8 rows in a row looked like placeholder data.",
      "Social-actor notifications (like / repost / reply / follow) now show a real avatar tile: initials parsed from the title + per-actor deterministic color, matching how the same user shows up in their profile page.",
      "Small kind-badge SVG (heart / plus / repost / reply) overlays the avatar's bottom-right corner, with a surface-colored border so it reads as a notch rather than two separate elements.",
    ],
  },
  {
    version: "0.0.73",
    title: "Bell drill-down: notifications are now tappable",
    bullets: [
      "Tap a social_like / social_repost / social_reply / mention notification → opens the post thread. Tap a social_follow → opens the follower's profile. Inbox auto-closes after the navigation.",
      "Cross-shell handoff via samas:open-profile / samas:open-thread CustomEvents (same pattern as share-trade), drained from localStorage by SocialPage's mount-effect.",
      "Inbox loading state replaced with shimmer skeleton rows that mirror the resolved row shape — no layout reflow when notifications arrive.",
      "Each actionable row now has a chevron indicator on the right so the user sees at a glance which notifications drill in.",
    ],
  },
  {
    version: "0.0.72",
    title: "AI Plan: real \"thinking\" moment + haptics",
    bullets: [
      "Without an Anthropic API key, the wizard's mock plan was returning instantly — skeleton flashed for one frame, plan snapped in. Felt fake. Added a deliberate 4-stage delay (~1.4s total) with rotating labels: Analizando → Calculando → Construyendo → Finalizando. Real-API path fires the same stages around the actual network call so the UX is consistent in either mode.",
      "Light haptic on Generar (synchronous, inside gesture context) + success haptic on plan ready + error haptic on rejection. Same pattern as the trade flow.",
      "PlanSkeleton header re-mounts via key={stage} so each stage label cross-fades in via the existing samas-fade class instead of snapping.",
    ],
  },
  {
    version: "0.0.71",
    title: "Fix: trade success haptic now fires reliably",
    bullets: [
      "0.0.70 wired the haptic in DoneScreen's useEffect — fired AFTER placeOrder resolved + state updated + screen mounted, by which point iOS WebView's gesture context was sometimes lost and the haptic silently dropped.",
      "Moved the call into confirmAndPlace, synchronously right after placeOrder resolves and BEFORE setDone schedules the new render. Same beat as the screen appearing.",
      "Also added an error-haptic on order failure so a rejected trade pings the wrist with a distinct pattern.",
    ],
  },
  {
    version: "0.0.70",
    title: "Trade Done screen — the moment of \"I just bought GGAL\"",
    bullets: [
      "Animated checkmark: circle scales in with overshoot, path strokes itself in, success haptic on the same beat. Filled orders also get a 14-piece confetti burst (pure CSS, no canvas).",
      "Two-column receipt-style position card: total invertido / total recibido on the left, your new position on the right. Reads like a real broker confirmation, not just \"Listo.\"",
      "Order ID footer in tabular mono: # ABC123XYZ — the touch that makes the screen feel transactional, not screenshotted.",
    ],
  },
  {
    version: "0.0.69",
    title: "Revert dashed reference line on sparklines",
    bullets: [
      "Pulled the dashed open-price reference line added in 0.0.68 — looked too busy on small thumbnails per Manuel's review.",
      "Sparklines back to clean stroke + area gradient. The other 0.0.68 changes (Wallet hero pill, empty-state copy, News audit) stay.",
    ],
  },
  {
    version: "0.0.68",
    title: "Polish pass: dashed reference, Wallet hero, empty-state copy",
    bullets: [
      "Sparklines now have an Apple-Stocks-style dashed open-price reference line at the y-level of the first data point — see-at-a-glance how far the asset has moved from its starting point.",
      "Wallet hero return-chip restyled as a solid-fill pill matching the AssetRow aesthetic AND now derived from live drift (no more jarring static \"+2.34%\" green while the total just ticked down).",
      "Trades empty-state copy nudges toward the Broker share-trade flow. News tab audited, pipeline confirmed healthy (94 cached articles, defensive timeouts + mock fallback already in place from prior patches).",
    ],
  },
  {
    version: "0.0.67",
    title: "Apple Stocks aesthetic now consistent everywhere",
    bullets: [
      "0.0.66 stripped logos from main rows + AssetSheet header but left them in CompareSheet (×2) and the watchlist's add-asset picker. Visible inconsistency: main lists logo-free, modals still had them. Now all four broker surfaces match.",
      "Compare-sheet picked grid: logo replaced with a bigger / bolder display-font ticker (16px, weight 800).",
      "Pickable list rows + AddAssetModal rows: same ticker treatment + change indicator promoted to a solid-fill pill matching the main row aesthetic.",
    ],
  },
  {
    version: "0.0.66",
    title: "Mercado redesign — Apple Stocks aesthetic",
    bullets: [
      "Dropped the logo column from every asset row + the AssetSheet header. Bigger / bolder ticker text on the left edge replaces the visual weight the logo was carrying.",
      "Sparkline upgraded to area chart with fill gradient (subtle line-color fade to transparent toward the bottom). 64×28 instead of 50×20 — reads as a tiny chart instead of a pencil stroke.",
      "Change indicator restyled as a SOLID FILLED PILL (white text on accent / danger background) under the price, instead of tinted text. Matches the broker-app convention Manuel referenced.",
    ],
  },
  {
    version: "0.0.65",
    title: "Loading skeletons across the app",
    bullets: [
      "Mercado / Portafolio / Watchlist now show 5-6 asset-row-shaped shimmer placeholders while data loads (was: bare \"Cargando…\" text).",
      "Mensajes shows 5 thread-shaped skeletons; ticker drill-in feed shows 3 post-card-shaped skeletons. News skeletons were already in place from 0.0.x.",
      "Composite skeletons live in shared.jsx (AssetRowSkeleton, PostCardSkeleton, DmThreadSkeleton) — match the exact silhouette of the resolved row, so loading → loaded reads as fill-in instead of swap.",
    ],
  },
  {
    version: "0.0.64",
    title: "Bell badge actually lights up — notification triggers + seed engagement",
    bullets: [
      "Found via Management API: supabase/social_notifications.sql migration was never applied — the four AFTER-INSERT triggers (notify_post_liked / _reposted / _replied / _user_followed) didn't exist. Applied + backfilled 80 notification rows for existing seed engagement.",
      "Seed function had a gap: only created seeded↔seeded engagement, nothing inbound to the caller. Added FOLLOWERS_OF_CALLER (8 seeded users follow you) + LIKERS_OF_CALLER_POSTS (6 like your first post). Idempotent on re-run.",
      "Manuel's iPhone now has 15 notifications waiting in the bell on next open. Future fresh demo accounts get the same effect automatically via the updated seed.",
    ],
  },
  {
    version: "0.0.63",
    title: "App Store gates: account deletion + data export",
    bullets: [
      "New \"Mi cuenta\" section in Settings with two flows required by App Store Guideline 5.1.1(v): \"Descargar mis datos\" (download all your data as JSON) and \"Borrar mi cuenta\" (permanent deletion with type-BORRAR confirm).",
      "Both backed by service-role Edge Functions: delete-user-account walks 19 user-keyed tables + cleans the post-images bucket folder + calls auth.admin.deleteUser; export-user-data assembles 18 parallel queries into a structured JSON.",
      "Type-to-confirm pattern on delete (the destructive button stays disabled until the user types BORRAR / DELETE in the input) — matches what App Store reviewers expect to see.",
    ],
  },
  {
    version: "0.0.62",
    title: "Onboarding polish — first impression for the pitch",
    bullets: [
      "Strings now flow through tr() (was hardcoded Spanish, broke for English-set users). New \"social\" slide added so the 4-tab story (Wallet / Invertir / Social / IA) matches what's in the app.",
      "SAMAS wordmark + green dot at the top of every slide so the user learns the brand mark before tapping in.",
      "Slide-in animation + horizontal swipe gesture + tap-a-dot to jump + haptic on every step + success haptic on \"Empezar\".",
    ],
  },
  {
    version: "0.0.61",
    title: "Live like / repost / reply counts in the feed",
    bullets: [
      "Realtime on posts.INSERT was already wired (new posts slide in without refresh). Filling in the gap: like / repost / reply counts now also tick live when someone else interacts with a post you're viewing.",
      "Subscriptions on likes / reposts / replies INSERT + DELETE; events authored by the current user are skipped so the local optimistic update (already there) doesn't double-count.",
      "During the Cohen demo, a coworker tapping like on Manuel's seeded post will visibly bump the heart count on his iPhone screen.",
    ],
  },
  {
    version: "0.0.60",
    title: "Wallet hero sparkline grows live",
    bullets: [
      "The 30-day chart on the Wallet hero used to be a fixed bull-curve squiggle, same shape every render. It now appends a point each tick from the live portfolio total — the line literally grows as you watch.",
      "Color follows the trend: green when the recent direction is up, red when down. Buffer rolls at 30 points (~75s of session) so the chart slides forward instead of growing forever.",
      "Seeds with 8 copies of the initial total so the chart has shape from the first render, then morphs into live data over the first half-minute.",
    ],
  },
  {
    version: "0.0.59",
    title: "Top movers re-rank live during the demo",
    bullets: [
      "TopMovers (Pro tile in Portafolio) now re-sorts every tick — winners and losers shuffle as session drift compounds with each asset's daily change.",
      "Each row's price flashes green/red on update with the same keyframes used in Mercado, so the eye sees \"this market is moving right now\".",
      "Composite delta = day's changePct + session drift since launch. Manageable demo movement: most ticks keep the rank, occasional swaps make it feel real.",
    ],
  },
  {
    version: "0.0.58",
    title: "Real brand logos in Mercado (finally)",
    bullets: [
      "Closing the gap from 0.0.52: I added Clearbit logo URLs to the legacy ASSETS table in App.jsx, but the v2 broker (the iOS UI you actually use) reads from src/v2/api/broker.js — that table had no logo field, so every row fell through to the colored-initials tile.",
      "Added logos for Apple, NVIDIA, Tesla, Microsoft, Alphabet, Galicia, YPF, Pampa, Bitcoin, Ethereum, SPY, QQQ, IWM, EWZ, GLD, SLV. Bonds (AL30) and Petróleo (USO) keep the colored fallback — no clean brand logo for those.",
      "Names canonicalized too: \"Apple\" not \"Apple Inc.\", \"YPF\" not \"YPF S.A.\".",
    ],
  },
  {
    version: "0.0.57",
    title: "Live price ticks across the broker",
    bullets: [
      "Every price in Mercado / Watchlist / Portafolio / AssetSheet ticks every 2.5s with a small random walk biased toward the asset's base price.",
      "Each tick flashes the cell green (up) or red (down) for 600ms — soft tint, fades to transparent, never lingers.",
      "Wallet hero total now ticks proportionally with the underlying holdings — both ARS and USD move in step with the asset drift.",
    ],
  },
  {
    version: "0.0.56",
    title: "Hotfix: \"Can't find variable: lang\" al agregar a watchlist",
    bullets: [
      "WatchlistPicker (la modal del ⭐ desde AssetSheet) usaba tr(\"settings.done\", lang) sin recibir lang como prop — ReferenceError, error boundary firea.",
      "Bug viejo, no tocado por los patches recientes; aparecía cualquier vez que tocabas la estrella en el detalle de un activo.",
      "Threadeé lang desde AssetSheet → WatchlistPicker. Hice un sweep de las otras 16 funciones que usan tr() — todas tienen lang ya, era el único caso.",
    ],
  },
  {
    version: "0.0.55",
    title: "Más smooth: bounce, press-down y haptics",
    bullets: [
      "Swipe-to-delete: el panel rojo ahora cubre toda la card (sin gap entre card y panel cuando overshootteás).",
      "Press-down universal: cualquier botón se achica un poquito (scale 0.97) al tocar, suelta con un poquito de bounce.",
      "Bounce en los botones de like / repost / save al activarlos + haptic light en cada tap social, en cambio de tab y en Suscribirme (success haptic en confirmación).",
    ],
  },
  {
    version: "0.0.54",
    title: "Pantalla de precios para Pro",
    bullets: [
      "El CTA del upsell modal ahora abre una pantalla de planes (USD 5/mes o USD 48/año, anual recomendado con -20%).",
      "\"Suscribirme\" simula el procesamiento ~700ms y activa Pro localmente — billing real con App Store IAP queda para antes del lanzamiento.",
      "Checklist de las 9 features Pro como recordatorio, copy honesto sobre el modo demo en el legal blurb.",
    ],
  },
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
      paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)",
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
