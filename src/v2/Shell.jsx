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
import ReactDOM from "react-dom";
import { SAMAS_THEME, FONT } from "./theme.js";
import { SamasTabBar, Avatar, avatarPropsFor, AVATAR_PALETTE } from "./shared.jsx";
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
import { AITour, hasSeenAITour, resetAIToured } from "./AITour.jsx";
import { TutorialsHub } from "./Tutorials.jsx";
import { ExplainTermSheet } from "./ExplainTerm.jsx";
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
import { grantAIConsent, denyAIConsent, hasAIConsent, revokeAIConsent, isAIDisabled, setAIDisabled } from "../lib/aiConsent.js";
import { activatePlus, cancelPlus, getAIQuotaStatus } from "../lib/ai.js";
import { reauthWithPassword } from "../lib/reauth.js";
import { LivePricesProvider } from "./livePrices.jsx";

// localStorage flag for the Pro mode toggle. Default ON — power users
// see the full broker surface (ticker banner, distribución, top movers)
// out of the box. Flip OFF for a simpler beginner view.
const PRO_KEY = "samas_v2_pro_mode";

function SamasShellInner({ user, isDark = true, isNativeApp = false, onToggleDark, onLogout, lang = "es", setLang }) {
  const [tab, setTab] = useState("wallet");
  // Tab-focus refresh (samas-0.4.10). WalletPage stays mounted in
  // the background when the user goes to Invertir / Social / News;
  // its refresh() only fires on initial mount + pull-to-refresh,
  // so trades placed in BrokerShell wouldn't show up in
  // Movimientos when the user came back. Fix: when tab transitions
  // INTO wallet from something else, trigger callRefreshFor("wallet").
  const prevTabRef = React.useRef(tab);
  useEffect(() => {
    if (tab === "wallet" && prevTabRef.current !== "wallet") {
      callRefreshFor("wallet");
    }
    prevTabRef.current = tab;
  }, [tab]);
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

  // AI tour fires AFTER onboarding completes — gives the user a quick
  // walkthrough of the 17 AI surfaces. samas-0.3.2.
  const [showAITour, setShowAITour] = useState(false);
  // Tutorials hub — opened from Settings → 'Tutoriales y guías'.
  // samas-0.4.1.
  const [showTutorials, setShowTutorials] = useState(false);
  // Explain-term modal (samas-0.4.2) — opened from the ? button in
  // the Wallet header or any future surface that dispatches the
  // samas:explain-term event. detail.term optionally pre-fills.
  const [explainTermState, setExplainTermState] = useState(null); // null | { term: "" }
  useEffect(() => {
    function onExplain(e) {
      const initialTerm = e?.detail?.term ? String(e.detail.term) : "";
      setExplainTermState({ term: initialTerm });
    }
    window.addEventListener("samas:explain-term", onExplain);
    return () => window.removeEventListener("samas:explain-term", onExplain);
  }, []);
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

  // SAMAS Plus subscription state (samas-0.2.6). Distinct from
  // proMode — proMode is the free UI density toggle, isPlus is the
  // paid tier (US$5/mo) that removes the daily AI quota cap.
  // Hydrate from RPC on mount; refreshed when the user subscribes.
  const [isPlus, setIsPlus] = useState(false);
  useEffect(() => {
    let alive = true;
    getAIQuotaStatus().then((s) => {
      if (alive && s) setIsPlus(!!s.isPlus);
    });
    return () => { alive = false; };
  }, []);

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

  // Cross-shell deep-link to AssetSheet (samas-0.2.2). Anyone can
  // dispatch "samas:open-asset" with { ticker } to land the user on
  // the Invest tab with the AssetSheet pre-loaded for that ticker.
  // Currently used by proactive-insights inbox-row taps. Was originally
  // introduced as samas:harvest-sell with the tax-loss harvester (0.2.0,
  // reverted in 0.2.2) — same channel, neutralized name.
  useEffect(() => {
    function onOpenAsset(e) {
      try {
        const detail = e?.detail || {};
        if (!detail.ticker) return;
        localStorage.setItem("samas_pending_open_asset", JSON.stringify({
          ticker: detail.ticker,
          ts: Date.now(),
        }));
      } catch {}
      setTab("broker");
    }
    window.addEventListener("samas:open-asset", onOpenAsset);
    return () => window.removeEventListener("samas:open-asset", onOpenAsset);
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
        onDone={() => {
          setNeedsOnboarding(false);
          // Auto-launch the AI tour next mount frame so onboarding's
          // exit animation isn't covered. Skip if user has already
          // seen the tour (e.g. they re-onboarded after data wipe).
          if (!hasSeenAITour()) {
            setTimeout(() => setShowAITour(true), 350);
          }
        }}
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
            isPlus={isPlus}
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
          isPlus={isPlus}
          setIsPlus={setIsPlus}
          onOpenPlusUpsell={() => { setShowSettings(false); setShowProUpsell(true); }}
          onReplayAITour={() => {
            resetAIToured();
            setShowSettings(false);
            // Slight delay so the settings sheet's close animation
            // finishes before the tour overlay slams in.
            setTimeout(() => setShowAITour(true), 200);
          }}
          onOpenTutorials={() => {
            setShowSettings(false);
            setTimeout(() => setShowTutorials(true), 200);
          }}
          isDark={isDark}
          onToggleDark={onToggleDark}
          onLogout={onLogout}
          onClose={() => setShowSettings(false)}
          isNativeApp={isNativeApp}
          lang={lang}
          setLang={setLang}
        />
      )}

      {/* AI Tour — first-launch walkthrough of the 17 AI surfaces.
          Renders via portal so it sits above the tab bar / status
          bar / everything else. Self-marks samas_v2_ai_toured = true
          when finish/skip fires. Replayable from Settings. */}
      {showAITour && (
        <AITour T={T} lang={lang} onDone={() => setShowAITour(false)} />
      )}

      {/* Tutorials hub — list of guides, fullscreen overlay above
          everything else (samas-0.4.1). Opened from Settings →
          'Tutoriales y guías'. Read state persists in localStorage. */}
      {showTutorials && (
        <TutorialsHub T={T} lang={lang} onClose={() => setShowTutorials(false)} />
      )}

      {/* Explain-term modal (samas-0.4.2) — global AI glossary.
          Opened from the ? button in Wallet header, or any future
          component dispatching samas:explain-term { term? }. */}
      {explainTermState && (
        <ExplainTermSheet
          T={T} lang={lang}
          initialTerm={explainTermState.term || ""}
          onClose={() => setExplainTermState(null)}
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
          isPro={isPlus}
          onActivate={() => { setShowProUpsell(false); setShowProPricing(true); }}
          onClose={() => setShowProUpsell(false)}
        />
      )}

      {/* Plus pricing sheet — second step of the activation flow.
          Suscribirme is currently faked (no real billing yet);
          activatePlus() flips profiles_social.is_plus = true server-
          side via SECURITY DEFINER RPC. App Store IAP will replace
          this with proper receipt verification. */}
      {showProPricing && (
        <ProPricingSheet
          T={T}
          lang={lang}
          onSubscribe={async () => {
            try {
              await activatePlus();
              setIsPlus(true);
              setShowProPricing(false);
              toast.success(tr("pro.pricing.success", lang));
            } catch (e) {
              toast.error(tr("pro.pricing.error", lang, { err: e?.message || "" }));
            }
          }}
          onClose={() => setShowProPricing(false)}
        />
      )}

      {/* AI consent gate (samas-0.0.98). Listens for the global
          samas:ai-consent-request event fired by lib/aiConsent.js
          on every AI call. Resolves the in-flight Promise when the
          user taps Acepto / Rechazar so the calling code can proceed
          (or get an AIConsentDeniedError). */}
      <AIConsentGate T={T} lang={lang} />
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
function SettingsSheet({ T, user, proMode, setProMode, isPlus = false, setIsPlus, onOpenPlusUpsell, onReplayAITour, onOpenTutorials, isDark, onToggleDark, onLogout, onClose, isNativeApp, lang = "es", setLang }) {
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
  const [deletePassword, setDeletePassword] = useState("");  // 0.0.98 reauth gate
  const [deleteErr, setDeleteErr]         = useState(null);
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

        {/* SAMAS Plus row (samas-0.2.9) — distinct from Pro view
            below. Plus = paid AI subscription, Pro view = free UI
            density toggle. Active = green chip + "Cancelar" CTA.
            Inactive = gray chip + "Activar" CTA → opens upsell modal.
            Hidden when AI is globally disabled (samas-0.4.11) since
            Plus exists solely to remove the AI quota cap. */}
        {!isAIDisabled() && (
          <PlusSettingsRow
            T={T}
            isPlus={isPlus}
            setIsPlus={setIsPlus}
            onOpenPlusUpsell={onOpenPlusUpsell}
            lang={lang}
          />
        )}

        {/* Pro view density toggle row (free in both tiers). */}
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

        {/* Tutorials hub (samas-0.4.1) — opens the in-app guide
            list. Sits right above the AI tour replay so they read
            as a learning cluster. */}
        {onOpenTutorials && (
          <button
            onClick={onOpenTutorials}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 8,
              background: T.surface, border: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
                {tr("settings.tutorials.title", lang)}
              </div>
              <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
                {tr("settings.tutorials.sub", lang)}
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        )}

        {/* Replay AI tour (samas-0.3.2) — re-run the first-launch
            walkthrough of the 17 AI surfaces. Useful for a Cohen
            demo: open settings, tap → tour, hand the phone over. */}
        {onReplayAITour && (
          <button
            onClick={onReplayAITour}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 8,
              background: T.surface, border: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
                {tr("settings.ai_tour.title", lang)}
              </div>
              <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
                {tr("settings.ai_tour.sub", lang)}
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        )}

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
        {/* AI consent revoke (samas-0.1.1). The first-tap consent
            modal promises "podés desactivar las funciones IA desde
            Ajustes" — this is that switch. Tapping it clears the
            stored consent flag; the next AI tap re-prompts.
            Always-rendered (regardless of current state) so the
            user never has to hunt for it. */}
        <div style={{
          marginTop: 6, marginBottom: 6,
          fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
          color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
          padding: "0 4px",
        }}>
          {tr("settings.section.ai", lang)}
        </div>

        {/* AI master switch (samas-0.4.11) — when off, every AI
            surface across the app self-hides + the ? Explain button
            in Wallet header disappears + the Quota pill goes away.
            Distinct from the revoke-consent button below: this
            doesn't ask the user to re-consent later, it just turns
            the whole feature off until they flip it back on. */}
        <AIDisabledToggle T={T} lang={lang} />

        <button
          onClick={() => {
            revokeAIConsent();
            toast.success(tr("settings.ai.revoke_done", lang));
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
              {tr("settings.ai.revoke", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              {tr("settings.ai.revoke_sub", lang)}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9"/>
            <polyline points="3 4 3 12 11 12"/>
          </svg>
        </button>

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
          onClick={() => {
            setDeleteTyped("");
            setDeletePassword("");
            setDeleteErr(null);
            setShowDelete(true);
          }}
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
                outline: "none", letterSpacing: 1.2, marginBottom: 12,
                boxSizing: "border-box",
              }}
            />
            {/* Re-auth gate (0.0.98). Type-to-confirm proved INTENT,
                this proves IDENTITY. Even if the device is unlocked
                and someone has access to a session, they need the
                password to push delete through. */}
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.text, marginBottom: 8,
            }}>{tr("settings.account.delete_pwd_label", lang)}</div>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => { setDeletePassword(e.target.value); setDeleteErr(null); }}
              disabled={deleting}
              autoComplete="current-password"
              placeholder={tr("settings.account.delete_pwd_ph", lang)}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 12,
                background: T.surface, border: `1px solid ${deleteErr ? T.danger : T.border}`,
                color: T.text, fontFamily: FONT.sans, fontSize: 14,
                outline: "none", marginBottom: deleteErr ? 6 : 16,
                boxSizing: "border-box",
              }}
            />
            {deleteErr && (
              <div style={{
                fontFamily: FONT.sans, fontSize: 12, color: T.danger, marginBottom: 12,
              }}>{deleteErr}</div>
            )}
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
                disabled={
                  deleting ||
                  deleteTyped.trim().toUpperCase() !== tr("settings.account.delete_keyword", lang) ||
                  deletePassword.length < 1
                }
                onClick={async () => {
                  if (deleting) return;
                  setDeleting(true);
                  setDeleteErr(null);
                  try {
                    // Step 1: re-auth. Throws on wrong password —
                    // we surface the message inline + bail without
                    // ever calling deleteAccount.
                    await reauthWithPassword(deletePassword);
                    // Step 2: actually delete. deleteAccount() also
                    // signs out so App.jsx routes to login.
                    await deleteAccount();
                    toast.success(tr("settings.account.delete_done", lang));
                    setShowDelete(false);
                    if (onClose) onClose();
                  } catch (e) {
                    const msg = e?.message || String(e);
                    if (msg === "Contraseña incorrecta.") {
                      setDeleteErr(msg);
                    } else {
                      toast.error(tr("settings.account.delete_fail", lang, { error: msg }));
                    }
                  } finally {
                    setDeleting(false);
                  }
                }}
                style={{
                  flex: 2, padding: "12px 14px", borderRadius: 12,
                  background: T.danger, border: "none",
                  color: "#fff", fontFamily: FONT.sans, fontSize: 13, fontWeight: 800,
                  cursor: (deleting || deleteTyped.trim().toUpperCase() !== tr("settings.account.delete_keyword", lang) || deletePassword.length < 1) ? "default" : "pointer",
                  opacity: (deleting || deleteTyped.trim().toUpperCase() !== tr("settings.account.delete_keyword", lang) || deletePassword.length < 1) ? 0.5 : 1,
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
  { key: "unlimited", icon: "✦" },
  { key: "advisor",   icon: "💬" },
  { key: "review",    icon: "📋" },
  { key: "priority",  icon: "🔔" },
  { key: "export",    icon: "📤" },
  { key: "early",     icon: "🚀" },
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
          >{isPro ? tr("pro.upsell.cta_activated", lang) : tr("pro.upsell.cta_activate", lang)}</button>
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

// ============================================================
// AIConsentGate (samas-0.0.98)
// ============================================================
// Global listener for the samas:ai-consent-request event fired by
// lib/aiConsent.js whenever an AI call is about to leave the app
// without prior consent. Mounts a portal modal explaining what gets
// sent (portfolio data → Anthropic Claude, no training, etc.) and
// captures the user's accept / reject. Resolves the in-flight
// Promise via grantAIConsent() or denyAIConsent().
// ============================================================
function AIConsentGate({ T, lang = "es" }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onRequest() {
      // If consent landed via another path between the request and
      // here (race), don't bother showing — just signal grant.
      if (hasAIConsent()) { grantAIConsent(); return; }
      setOpen(true);
    }
    window.addEventListener("samas:ai-consent-request", onRequest);
    return () => window.removeEventListener("samas:ai-consent-request", onRequest);
  }, []);

  if (!open) return null;

  function accept() { setOpen(false); grantAIConsent(); }
  function decline() { setOpen(false); denyAIConsent(); }

  return ReactDOM.createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) decline(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        animation: "samas-fade-in 160ms ease-out",
      }}
    >
      <div style={{
        width: "100%", maxWidth: 540,
        background: T.surface, color: T.text,
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        borderTop: `1px solid ${T.border}`,
        padding: "20px 22px calc(env(safe-area-inset-bottom) + 24px)",
        boxShadow: "0 -18px 50px rgba(0,0,0,0.5)",
        animation: "samas-sheet-up 220ms ease-out",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 12,
            background: T.accent, color: "#06180c", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
            </svg>
          </div>
          <div style={{
            flex: 1, fontFamily: FONT.display, fontSize: 18, fontWeight: 700,
            color: T.text, letterSpacing: -0.3,
          }}>
            {tr("ai_consent.title", lang)}
          </div>
        </div>

        <div style={{
          fontFamily: FONT.sans, fontSize: 13, color: T.text, lineHeight: 1.6,
          marginBottom: 12,
        }}>
          {tr("ai_consent.body", lang)}
        </div>

        {/* Bullet rows with check icons — concrete commitments. */}
        <div style={{ marginBottom: 18 }}>
          {["bullet_provider", "bullet_no_training", "bullet_revoke"].map((k) => (
            <div key={k} style={{
              display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0",
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: 9, marginTop: 2, flexShrink: 0,
                background: T.accentSoft, color: T.accent,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.text, lineHeight: 1.5 }}>
                {tr(`ai_consent.${k}`, lang)}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={decline} style={{
            flex: 1, padding: "13px 16px", borderRadius: 14,
            background: T.bg, border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
            cursor: "pointer",
          }}>{tr("ai_consent.decline", lang)}</button>
          <button onClick={accept} style={{
            flex: 1.4, padding: "13px 16px", borderRadius: 14,
            background: T.accent, color: T.accentInk,
            fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, border: "none",
            cursor: "pointer",
          }}>{tr("ai_consent.accept", lang)}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// CHANGELOG — newest first. Keep entries terse (3 bullets max,
// 12 words per bullet). The point of this screen is iteration
// velocity at a glance, not exhaustive release notes.
const CHANGELOG = [
  {
    version: "0.4.14",
    title: "Deposit polish + MP integration spec",
    bullets: [
      "Manuel decidió Opción A: modelo unificado (wallet = billetera de inversión, no hay paso 'fondear comitente'). Esto pone en perspectiva la única vía de entrada de plata: el depósito al wallet.",
      "Polish del DepositModal: agregado picker de moneda (Pesos / Dólares), quick-amount chips por moneda (ARS: 50k/100k/250k/500k; USD: 50/100/500/1000), copy más claro explicando que la misma plata es la que se usa para invertir, mejor explicación del CBU/Alias para transferencia, disclaimer 'Demo: instantáneo. Producción: vía webhook del partner'.",
      "Nuevo doc docs/mercado-pago-integration.md: spec completo de cómo reemplazar el deposit mock por integración real con MP. Cubre setup MP merchant, mp-create-preference Edge Function, mp-webhook con idempotencia, mp_processed_payments table, deep-link handler. Estimado 1 día de trabajo concentrado.",
      "Recomendación explícita en el doc: NO implementar antes de la pitch a Cohen. Razones: mock funciona predeciblemente, MP en producción introduce variables (rate limits, webhook failures, payment statuses) que no querés debuggear durante la pitch, Cohen probablemente prefiera que SU rail sea el que acredite ya que son el ALyC. Mock + doc demuestra que entendemos la integración sin quemar tiempo en código tirable.",
    ],
  },
  {
    version: "0.4.13",
    title: "Wallet backend audit + critical placeOrder → balance bug fix",
    bullets: [
      "Manuel asked: 'is all the backend there?' before integrating real money rails. Audit landed 1 critical bug + a comprehensive readiness doc.",
      "BUG (existed since launch): broker.placeOrder inserted into public.transactions on every fill but never updated public.accounts.balance. Manuel's actual data showed it: accounts.ARS = 6244 (the demo seed value), SUM(transactions.amount) = -841,500. Trades were going into the ledger but the balance never moved. Buys didn't deduct cash, sells didn't credit cash.",
      "FIX: new transactions_to_balance trigger — AFTER INSERT on public.transactions, upsert accounts.balance += amount. Single source of truth: ANY caller that inserts a transactions row gets the balance update for free. placeOrder, deposit, withdraw, swap, wallet_credits, future bank-rail webhooks. The wallet_credits_propagate trigger from 0.4.7 was refactored to only insert the transactions row and let the new trigger handle balance (no more double-update risk).",
      "Refactored applyLedgerEntry in src/v2/api/wallet.js to skip the manual accounts upsert (the trigger handles it now). Re-fetches the post-trigger balance for the return value.",
      "Manuel's stale balance is NOT auto-reconciled — the ledger sum is -841k pesos which would put him in negative territory. The cleanest reset is Settings → 'Resetear cuenta demo' (zeros everything + re-seeds). New trades from now on move balance correctly.",
      "New doc: docs/wallet-backend.md. Comprehensive audit of what's there (tables, triggers, edge functions, client API, realtime sub) vs. what's missing for real-money integration (MP / CBU rails, FX feed, KYC, reconciliation, fraud limits). Most of the missing work is partner-dependent (Cohen integration brings most of it for free since they're already plumbed for ARG retail ALyC operations).",
      "Migration: supabase/transactions_to_balance.sql, applied via Management API.",
    ],
  },
  {
    version: "0.4.12",
    title: "Objetivos rebuilt with IA — Wallet card + 3-step wizard",
    bullets: [
      "Per Manuel: 'rearmar el tema de objetivos con IA'. Replaced the legacy ObjectivesWizard (670 lines, BYOK Anthropic key, localStorage-only persistence) with a fresh v2 implementation: Wallet card + 3-step wizard + Edge Function + Supabase persistence.",
      "New ObjetivosCard on Wallet (between Quarterly Review and AI Chat). Empty state shows a tappable accent-tinted CTA. Active state shows: goal text + horizon + target amount + strategy chip (conservadora/moderada/agresiva color-coded) + sector allocation strip with category tags + monthly aporte hint + Claude-written narrative + Edit/Eliminar buttons.",
      "New ObjetivosWizard sheet, 3 steps: (1) goal description with 6 preset chips for quick fill (Departamento / Jubilación / Viaje / Auto / Educación / Reserva); (2) horizon picker (1/3/5/10/20 años) + optional target amount + currency; (3) generated plan preview with strategy classification, allocation breakdown bars, monthly aporte, milestones at 25/50/75/100% of horizon, narrative.",
      "New objectives-plan Edge Function. Strategy classified deterministically by horizon (< 24mo conservadora, 24-72mo moderada, > 72mo agresiva) with a USD-short-term bump-down rule. Allocation presets per strategy (BONO-heavy on conservadora, CEDEAR-heavy on agresiva). PMT formula computes monthly aporte needed to hit the target at the strategy's expected annual return (6/10/14%). Milestones via FV-of-annuity. Claude only refines the narrative; numbers stay deterministic.",
      "New `objectives` table in Supabase with RLS + auto-archive trigger (one active per user). Plan stored as jsonb so the schema can evolve. Migration: supabase/objectives.sql, applied via Management API.",
      "USER-INITIATED → consumes one quota credit per Generar Plan tap. Hidden when AI is disabled (via 0.4.11 master switch).",
      "Legacy ObjectivesWizard in BrokerShell stays in place for backward compat — users with a localStorage-saved plan still see it on Portafolio. Cleanup of the duplicate entry point is a future patch.",
      "21 AI surfaces total now (objectives-plan added to the count).",
    ],
  },
  {
    version: "0.4.11",
    title: "AI master switch — turn off ALL AI features at once",
    bullets: [
      "Per Manuel: 'el usuario debería tener la opción de apagar todo lo de AI'. New 'Funciones de IA' toggle at the top of Settings → Inteligencia. ON = AI everywhere (default). OFF = every AI surface across the app self-hides immediately.",
      "Implementation: a global isAIDisabled() flag in localStorage. Distinct from the existing 'Olvidar mi consentimiento' button (which only revokes the data-sharing consent and re-prompts on next AI call). The new master switch is a clean 'turn it all off, no popups, no nags'.",
      "When OFF: ensureAIConsent() short-circuits to false → every gateOnConsent() throws AIConsentDeniedError → all 20 AI surfaces self-hide via their existing catch handlers. Plus the ? Explain button in Wallet header hides, the AIQuotaPill goes away (getAIQuotaStatus returns null), the SAMAS Plus row in Settings hides (Plus exists solely for unlimited AI), and the 5 auto-loading AI cards on Wallet (DailyBrief, Analysis, Benchmark, Earnings, Quarterly Review, Chat) skip mounting entirely instead of briefly showing a skeleton.",
      "Live update: flipping the toggle dispatches samas:ai-disabled-changed → mounted components react without a re-render of the whole shell.",
      "Renamed the existing 'Desactivar funciones IA' button to 'Olvidar mi consentimiento' since that's what it actually did (revoke + re-prompt). The new master switch is the real off-switch.",
    ],
  },
  {
    version: "0.4.10",
    title: "Movimientos fix — auto-refresh on tab focus + realtime + 'Ver todos'",
    bullets: [
      "Bug Manuel caught: 'Lo de movimientos no funciona'. Three things were broken at once. Fixed all three:",
      "1. Wallet stayed mounted when the user went to Invertir/Social/News tabs (its state was preserved by design). But refresh() only fired on initial mount + pull-to-refresh, so when the user placed a trade in BrokerShell and came back, Movimientos still showed pre-trade state until they pulled-to-refresh. Now Shell tracks tab transitions; coming back to Wallet from any other tab triggers callRefreshFor('wallet') automatically.",
      "2. New Postgres realtime subscription on `transactions` filtered by user_id. Any new row (trade fill, aporte cron credit, swap) → wallet refresh fires. Movimientos updates within ~200ms of the trade landing in the DB, no user action required.",
      "3. Replaced the dead 'Filtrar' link in the Movimientos section header (it had no onAction wired) with 'Ver todo'. Tap → opens TxnsAllSheet, a new bottom sheet showing the last 200 transactions grouped by day (Hoy / Ayer / DD MMM). Skeleton stack while loading, empty state with copy.",
      "Net result: Manuel makes a trade in Invest → tab swipe back to Wallet → balance + portfolio peek + Movimientos all updated. Or stays on Wallet → trade fills via aporte cron at 09:00 AR → row appears live without reloading the app.",
    ],
  },
  {
    version: "0.4.9",
    title: "Legacy MobileApp + WebDashboard gated behind ?debug=1",
    bullets: [
      "Capacitor iOS already always rendered v2 SamasShell — production users never see legacy. But web preview defaulted to legacy 'mobile' mode for any user with no stored viewMode. Plus existing localStorage values like 'mobile' would persist across patches. Made v2 the unconditional default for end users on both platforms.",
      "Render decision tree change: v2 fires unless (web AND ?debug=1 in URL AND viewMode in storage is 'mobile' or 'web'). Anyone hitting the page fresh — including QA, demo viewers, accidental web access — sees v2. Devs flipping between shells for regression testing add ?debug=1 and the toggle bar reappears.",
      "Default localStorage value flipped from {native: 'v2', web: 'mobile'} to 'v2' for both. Existing legacy-mode users with stale storage still see v2 because the runtime guard ignores their stored choice unless ?debug=1 is present.",
      "Legacy MobileApp (~258 lines) + WebDashboard (~121 lines) + the legacy page components (PageMercado, PagePortfolio, PageWatchlist, PageOrdenes, PageNoticias, PageIdeas, AssetDetail, etc.) STAY in the codebase as a debug/QA escape hatch. Future patch will fully delete them once we've spent more time confirming v2 covers every flow they did.",
      "Cohen pitch unchanged — they see v2 regardless. The pitch is the cleanest version of the app it has ever been.",
    ],
  },
  {
    version: "0.4.8",
    title: "App.jsx dead-code sweep — 6 unused components removed",
    pushed: "34b4de4..pending",
    bullets: [
      "Comprehensive dead-code audit on the legacy 7139-line App.jsx. Cross-referenced all 72 top-level function declarations against actual usage (JSX instantiations + callable refs) inside App.jsx and across the rest of src/. Found 6 truly dead components / utilities + 2 dead handler stubs + 1 stale comment block.",
      "Removed: BrandSVG (33 lines, hardcoded brand SVG icons never instantiated), PageProductos (27 lines, retired Productos page), PageTrending (31 lines, retired Trending page), loadNewsEndpoint (13 lines, news endpoint loader nothing called), LoginScreen (78 lines, demo-PIN login replaced by Supabase auth), SAMASLogoLarge (10 lines, only used by LoginScreen).",
      "Cleaned up the orphaned handleLogin / handleSignup no-op stubs and their entries in the handlers destructure / object — they existed solely as defensive shims for the deleted LoginScreen.",
      "Net: 196 lines removed from App.jsx (7139 → 6943). Production bundle size unchanged (Rollup tree-shakes unused exports anyway), but the file is materially easier to navigate and read.",
      "Re-ran the audit after each removal pass; converged after 3 passes (no more orphans). Build still clean.",
    ],
  },
  {
    version: "0.4.7",
    title: "Aporte mensual fix — credits now reach balance + Movimientos",
    bullets: [
      "Bug Manuel caught: monthly aporte cron was firing fine BUT the user's balance never moved and no Movimiento appeared. Cron inserted into public.wallet_credits (audit trail) and stopped there — never updated accounts.balance, never inserted into transactions. The feature was effectively a silent log-and-forget.",
      "Fix: new AFTER INSERT trigger on wallet_credits (supabase/wallet_credits_propagation.sql, applied via Management API). For every credit row, the trigger upserts accounts.balance += amount AND inserts a transactions row (kind='deposit', reference='Aporte mensual'). One source of truth — works for any future inserter (manual top-ups, bank-rail integrations, etc.).",
      "Verified end-to-end on Manuel's account: synthetic +1 ARS insert correctly bumped accounts.balance from 6244 to 6245 + created a matching transactions row. Then rolled back so no real change persisted.",
      "Why a trigger vs. modifying the cron's TS code: atomic per Postgres semantics (no partial-success window), single source of truth for any caller. The cron stays small.",
      "Knock-on: when the next aporte fires (12:00 UTC daily / 09:00 AR), the credit will now correctly land in the user's balance + show up in Movimientos as 'Aporte mensual'.",
    ],
  },
  {
    version: "0.4.6",
    title: "Dead UI sweep — removed inert Search button + 4 unused imports",
    bullets: [
      "Manuel called out: 'Search button on the main menu does nothing'. Confirmed — the ChromeBtn with Ico.Search in the Wallet header had no onClick across 70+ patches. Removed. The ? Explain button (0.4.2) is the actual go-to-find-something surface now.",
      "Removed 3 unused named imports: testAnthropic in App.jsx, initialsOf in Shell.jsx, genId in v2/api/broker.js. Caught by a grep-driven scan across src/.",
      "Removed dead Placeholder component in Shell.jsx — defined as 'Próximamente' fallback for unwired tabs but never instantiated since all 4 tabs (Wallet, Invertir, Social, News) went live with real components.",
      "Wallet header now: theme toggle + ? Explain + Bell. Three buttons, all functional. iPhone SE math now comfortable: 3×40 + 2×6 = 132px right column, leaves room.",
    ],
  },
  {
    version: "0.4.5",
    title: "Closed all 3 open audit items from 0.4.4",
    bullets: [
      "FIX (0.4.4 audit #1): Wallet.refresh and Broker.refresh now coalesce concurrent calls via useRef. Multiple concurrent triggers (pull-to-refresh + tab-resume + post-trade refresh) used to fire 6-7 redundant API calls each; now they share the same in-flight Promise. State flicker eliminated as a side benefit.",
      "FIX (0.4.4 audit #2): New useInFlight hook in shared.jsx for ref-based double-tap protection — fixes the theoretical micro-race where rapid taps could read busy=false in both handlers before setBusy(true) lands. Applied to SectorRotationCard.analyze + ThesisCard.validate (highest tap-frequency surfaces). Other AI cards keep their existing busy-state guard since the race has never actually fired in practice.",
      "FIX (0.4.4 audit #3): Quota counter now resets at AR midnight (UTC-3) instead of UTC midnight. consume_ai_quota and get_ai_quota_status RPCs now use (current_timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')::date. AR users in Buenos Aires now see their quota roll over at 00:00 local time as expected.",
      "Trade-off on the timezone fix: hardcoded America/Argentina/Buenos_Aires for all users. If we expand to other markets later, swap to a per-user timezone column on profiles_social. For the AR launch this is the cleaner call.",
      "Migration: supabase/samas_plus_tz.sql (already run via Management API).",
    ],
  },
  {
    version: "0.4.4",
    title: "Deep audit pass — layout / prompts / realtime / foreground",
    bullets: [
      "Four deep audits done. Two real fixes shipped, two clean reports, two known issues documented as future hardening (not blocking Cohen pitch). Full writeup in docs/audit-0.4.4.md.",
      "FIX #1 (a11y): ChromeBtn (the round buttons in Wallet header) didn't forward aria-label/title props. The new ? Explain button had its aria-label silently ignored. Now spreads ...rest into the underlying <button>.",
      "FIX #2 (layout): Wallet header gap tightened from 8px to 6px. With 4 buttons (theme + Search + ? + Bell) the row was 184px, tight on iPhone SE (320px wide). New 178px reads cleaner on every screen.",
      "Audit 2 (AI prompts): all 18 LLM-calling Edge Functions have try/catch around JSON.parse, fence stripping, templated fallbacks, sane token budgets (300-1200), timeouts (10-18s) inside 60s wall. Clean.",
      "Audit 3 (realtime): all 7 channel creations (notifications-bell, notifications-inbox, social-feed, dm-threads, dm-thread, replies, ticker-feed) have matching removeChannel in cleanup + correct effect deps. No leaks.",
      "Audit 4 (foreground races): App.jsx price-poll properly pauses/resumes. usePullToRefresh has refreshing guard. AI surfaces have busy guards. Open: Wallet.refresh + Broker.refresh have no in-flight guard — concurrent refreshes cause redundant API calls but no state corruption. Documented for future hardening.",
    ],
  },
  {
    version: "0.4.3",
    title: "Tap-to-explain on bolded terms + bug audit pass",
    bullets: [
      "Bolded terms (**term**) inside Tutorials body are now tappable. Dotted-underline hint signals tappability; tap dispatches samas:explain-term { term } and the global Explain modal opens pre-filled. Original plan was long-press text selection but iOS WebView's system Look Up menu hijacks long-press unreliably; tap-on-bolded-term is the cleaner shipping pattern.",
      "Bug fix #1: send-push Edge Function was in the codebase but never deployed. check-price-alerts (price-alert cron) and proactive-insights both call it via internal HTTP — push notifications were silently failing. Now deployed.",
      "Bug fix #2: explain-term's diacritic-stripping regex used a literal U+0300..U+036F range that's brittle in some serializers. Replaced with /\\p{M}/gu (Unicode Mark category) — more robust + does the same job. So 'idóneo CNV' typed by the user correctly normalizes to the templated 'idoneo cnv' lookup key.",
      "Bug fix #3: src/v2/Tutorials.jsx imported useEffect without using it. Removed.",
      "Audit pass clean: no unguarded localStorage access, no missing React imports, no orphan tr() calls without lang, no client-invoked Edge Functions missing on the server (19 surfaces all wired). All event dispatches have matching listeners.",
    ],
  },
  {
    version: "0.4.2",
    title: "AI Explain — 20th AI surface, ask SAMAS what any term means",
    bullets: [
      "Companion to the Tutorials hub. New ? button in the Wallet header (between Search and Bell) opens a global modal with a text input — type any financial term, tap Explicar, IA returns a 2-3 sentence definition in plain AR-Spanish + a concrete example + 0-3 related terms you can tap to chain into.",
      "Why a typed input vs. long-press text selection: on iOS WebView the system Look Up menu always wins on long-press, can't reliably hijack selection. Typed input is more discoverable, works inside any tab, and lets users ask about terms they heard on TV / Twitter / WhatsApp — not just terms that appear inside the app.",
      "New explain-term Edge Function. Templated glossary covers ~25 of the most common AR-retail terms (CEDEAR, MEP, CCL, ALyC, CNV, idóneo, stop-loss, orden mercado/límite, BYMA, MERVAL, drawdown, P/E, Sharpe, beta, volatilidad, AFIP, impuesto cedular, tax-loss, spread, GGAL, etc.) so the demo works without an API key. Claude refines / handles unknowns when the key is set.",
      "Recent terms persist (samas_explain_recent in localStorage, last 8 unique). Tap a chip to re-look-up. Suggestion chips (CEDEAR, MEP, Stop-loss, Idóneo CNV, Drawdown, Sharpe, Tax-loss) shown when input is empty + no recent history — discoverability hint for first-time users.",
      "Wired via global window event samas:explain-term so any other component can dispatch it later (e.g. a long-press gesture on a tooltip in a future patch could open the modal pre-filled).",
      "USER-INITIATED → consumes one quota credit per explain. 20 AI surfaces total now.",
    ],
  },
  {
    version: "0.4.1",
    title: "Tutorials hub — 6 starter guides in Settings",
    bullets: [
      "New 'Tutoriales y guías' row at the top of Settings (above the AI tour replay) opens a fullscreen list of 6 in-app guides. Each opens as a bottom sheet with a markdown body rendered by the same in-house parser as Quarterly Review (## h2 + **bold** + paragraphs, no react-markdown dep).",
      "Starter set covers product walkthroughs + AR retail financial literacy: 'Cómo hacer tu primera operación' (buy flow), 'Qué es SAMAS Plus' (paywall), 'Cómo leer el Riesgo por activo' (1-10 score), 'Qué es un CEDEAR' (financial literacy), 'Cómo escribir una tesis' (thesis tracker from 0.3.3), 'Privacidad cuando compartís tu cartera' (the 0.3.5–0.3.9 work explained).",
      "Read state persists in localStorage (samas_tutorials_read = JSON id list). The hub list shows a 'Visto' chip on guides the user has opened. No gating — read state is informational only.",
      "New file src/v2/tutorialsData.js — the 6 tutorial bodies live there as Spanish markdown templates. Adding a tutorial is a single object append. English translation is queued (Spanish-only for the AR / Cohen launch).",
      "New file src/v2/Tutorials.jsx — TutorialsHub list view + TutorialDetail bottom sheet, both rendered via React portal so they sit above the tab bar.",
    ],
  },
  {
    version: "0.4.0",
    title: "AI Sector Rotation — 19th AI surface (sector-level macro tilts)",
    bullets: [
      "Lands on Portafolio between Risk Score and the Pro distribución bar. User picks a macro stance (Crecimiento / Equilibrado / Defensivo) → tap 'Analizar mi mix' → IA returns a summary + 2-3 actionable tilt suggestions comparing current sector mix to the target mix for that stance.",
      "Distinct from RebalanceCard (0.1.4): rebalance is order-level ('buy 12 NVDA, sell 200 GGAL'), rotation is direction-only ('you're light tech, consider tech'). They complement: rotation tells you WHERE to look, rebalance tells you HOW to execute when you've decided.",
      "Visual: per-sector dual-bar showing current % vs. target %. Sector palette matches the portfolio share allocation bar (0.3.8) so the visual language stays consistent. Stance presets: growth (45/10/15/5/20/5 CEDEAR/ACCION/ETF/BONO/CRYPTO/COMMOD), balanced (30/20/20/15/10/5), defensive (15/25/10/35/5/10).",
      "Server-side targets are deterministic; Claude only refines the rationale + suggestion language. Numbers don't drift from the LLM call. Templated fallback when no API key.",
      "USER-INITIATED → consumes one quota credit per analyze. Hides silently on consent denied / quota hit (modal already showed UI).",
      "19 AI surfaces total. Closes the macro-direction gap that Rebalance left open.",
    ],
  },
  {
    version: "0.3.9",
    title: "DM privacy — delete conversation + at-rest stamp",
    bullets: [
      "Direct messages were flagged as a privacy gap in docs/seguridad.md (storage in plaintext on Supabase, no E2E encryption, no user-side delete). Full E2E is a multi-week project — this patch ships the achievable wins now.",
      "ConversationView header now shows a small 🔒 + 'Cifrado en reposo' line under the peer name — honest framing (Supabase cifra at rest, but admins could read with service role; not E2E). Docs/seguridad.md is the source of truth, this is just the user-facing surface.",
      "Trash icon on the right of the header → confirm dialog → deletes the dm_thread row. Cascade removes all dm_messages. Symmetric semantics: the peer still has their copy unless they also delete on their side. The dialog explains this honestly.",
      "New SQL migration: supabase/social_messages_delete.sql adds two RLS DELETE policies that didn't exist before — dm_threads (any participant deletes) and dm_messages (author-only). Without these the client-side delete call would silently no-op against RLS.",
      "Future scope (NOT in this patch): proper E2E with libsignal-style key exchange, per-user 'hide thread' table for asymmetric deletion, server-side message expiry. Tracked separately.",
    ],
  },
  {
    version: "0.3.8",
    title: "Allocation bar on portfolio share — visual privacy framing",
    bullets: [
      "Small horizontal stacked bar at the top of the portfolio share card visualizing share-of-book per ticker. Each segment width = pctOfBook. 6-color palette (accent green / soft green / amber / blue / violet / muted) — picked deliberately so red doesn't read as 'loss' here; the bar shows ALLOCATION, not performance.",
      "Reinforces the 'composition only, no amounts' message visually — a viewer's eye lands on the bar first and reads 'this person is heavy in NVDA + light in BTC' without ever needing a dollar number. Privacy as design, not just disclaimer.",
      "Hidden when no rows have pctOfBook (legacy posts — they fall back to the rows-only view from 0.3.5). Tooltip on each segment shows the ticker + percent for hover/long-press.",
    ],
  },
  {
    version: "0.3.7",
    title: "Retroactive scrub — strip qty/price/totalUsd from old posts",
    bullets: [
      "Migration that completes the 0.3.5 + 0.3.6 privacy story. Pre-fix posts still had totalUsd and per-row qty in their payloads, plus qty + price in their trade jsonb — even though the renderer ignored those fields, the data was sitting in the DB row reachable via API / admin tools.",
      "supabase/scrub_post_amounts.sql rewrites: posts where kind='portfolio' get payload.totalUsd removed and payload.rows[] mapped to { ticker, gainPct, pctOfBook = null }. Posts with trade jsonb get rewritten to { side, ticker } only. Idempotent — already-scrubbed rows are no-ops.",
      "Includes a sanity-report DO block at the bottom that prints how many rows are still leaky after the run. Should be 0 + 0. If non-zero, something raced.",
      "Run in Supabase SQL editor — same as the other migrations.",
    ],
  },
  {
    version: "0.3.6",
    title: "Privacy fix — same lockdown on shared trade cards",
    bullets: [
      "Companion to 0.3.5. Single-trade share cards (the 'Compartir este trade' flow from the Done screen) now follow the same rule: side + ticker only. No qty, no fill price.",
      "Was: '[COMPRA] 13 GGAL ........ US$4250'. Now: '[COMPRA] $GGAL ........ Ejecutado en SAMAS'. The compose preview matches the published post.",
      "Pre-fill template changed from 'Acabo de comprar 13 GGAL a US$4250' to 'Acabo de comprar $GGAL vía SAMAS'. The :compose:remove × button still nukes the attachment.",
      "Wire-side: trade payload sent to createPost is now scrubbed to { side, ticker } only — qty and price never land in the DB row. The samas:share-trade event still carries qty+price for future consumers (e.g., a private 'my trades' tab), but nothing publicly rendered persists them.",
      "Caveat: posts created BEFORE this patch still have qty+price in the DB. The renderer ignores them and shows the new shape, so they're visually clean — but they remain in the row. If we want to retroactively scrub, separate migration.",
    ],
  },
  {
    version: "0.3.5",
    title: "Privacy fix — shared portfolio cards no longer leak amounts",
    bullets: [
      "When you share your portfolio to the social feed, the card no longer shows your total dollar value (was: 'US$1.331' big in the header) and no longer shows the per-ticker quantity (was: '$GGAL 13', '$AAPL 1'). Composition only — strangers can see WHAT you hold and HOW MUCH OF THE BOOK each ticker is, but not the cash size.",
      "New shape per row: ticker chip + allocation % chip (% of book) + day-change %. Old shape was: ticker chip + qty + day-change %. The header keeps the gain pill on the right; the dollar headline is replaced with 'Composición · N posiciones'.",
      "Backwards compat: legacy posts in the DB still have totalUsd + qty in their payload, but the renderer ignores those fields now. Old posts render with allocation pct = '—' (since the legacy payload didn't compute it) — visually correct + leak-free.",
      "Caveat: trade-share cards (sharing a single trade you just made) still show qty + price — that's a different intent, you're explicitly bragging about an order you placed. If we want to lock that down too, separate patch.",
    ],
  },
  {
    version: "0.3.4",
    title: "Loading skeletons polish — kill the last 'Cargando…' text",
    bullets: [
      "Two remaining bare 'Cargando…' text fallbacks in Social.jsx replaced with row-shaped shimmer skeletons. ThreadView's reply section now shows 3 ReplyRowSkeleton placeholders while the replies fetch lands; FollowList overlay shows 5 UserRowSkeleton placeholders. The transition from loading → loaded reads as 'shape filling in' instead of 'text → cards'.",
      "New composite skeletons in shared.jsx: UserRowSkeleton (avatar + name + handle + follow button) and ReplyRowSkeleton (avatar + name row + 2 body lines). Both mirror the EXACT layout of the row they replace so there's no reflow when data arrives.",
      "Audited the rest of the app for 'Cargando…' — only places left are inside button labels (deposit.busy, common.loading) which are correct (text on a busy button, not a placeholder for a list).",
    ],
  },
  {
    version: "0.3.3",
    title: "AI Thesis Tracker — write WHY at buy, AI checks if it still holds",
    bullets: [
      "Eighteenth AI surface. At the BUY confirmation step, an optional 'Tu tesis (opcional)' textarea lets the user write 1-2 sentences explaining why they're buying. Saved to public.theses on confirm. Doesn't block anything — confirm without writing and you get the same flow as before.",
      "On the AssetSheet for tickers where the user has an active thesis, a new ThesisCard renders below AI Insight. Shows the original text in italics + 'hace Nd' age + 'Validar con IA' button. Tap → calls validate-thesis Edge Function (consumes quota), returns verdict ('holds' / 'weakened' / 'broken') with a 1-2 sentence reason and an actionable suggestion. Verdict cached on the row so re-opening the AssetSheet shows the last verdict instantly without re-running the LLM.",
      "Edge Function reads the thesis text + current asset price + cost basis + recent cached news + days since written, and asks Claude to render the verdict. Templated fallback when no API key uses pure price-move thresholds (>+5% holds / -5..-15% weakened / <-15% broken).",
      "DB migration: supabase/theses.sql. New table with status enum (active / closed / invalidated) + RLS + an after-insert trigger that auto-archives any prior active thesis on the same (user, ticker) so the 'current thesis' lookup stays clean.",
      "Sells don't (yet) get a 'why I'm selling' log — keeps the BUY flow as the main journaling moment. Could expand later with a sell-side post-mortem flow.",
      "18 AI surfaces total. Novel concept — no AR broker has anything like 'write your thesis, AI validates it later'. Demo angle: 'watch me commit to a buy with one sentence; in 30 days I'll know if I was right'.",
    ],
  },
  {
    version: "0.3.2",
    title: "AI Onboarding tour — 5-card walkthrough on first launch",
    bullets: [
      "First-launch fullscreen overlay walking new users through SAMAS's AI story. Fires AFTER the main Onboarding completes (so the user has an account + maybe a portfolio first), persists 'samas_v2_ai_toured = true' in localStorage to never re-show. 5 cards: '17 AI features' / 'AI summarizes your portfolio' / 'Trade with confidence' / 'Hear about what matters' / 'Plus tier'.",
      "Skip button top-right exits any time. Progress dots top-left. Atrás / Siguiente CTAs bottom — last card's CTA reads 'Empezar' (start using the app). Renders via React portal into document.body so it sits above the tab bar / status bar / everything.",
      "Replayable from Settings → 'Volver a ver el tour IA'. Useful for the Cohen demo: open Settings, tap, hand the phone over. resetAIToured() flips the localStorage flag back so the next mount re-shows.",
      "Cohen pitch context: this is the demo's first impression for anyone we hand the phone to. They land on '17 funciones de IA en SAMAS', see the value-prop framed up front, and the rest of the app pre-positions itself.",
      "New file: src/v2/AITour.jsx (~170 lines, self-contained). i18n: settings.ai_tour.* + ai_tour.* in es+en.",
    ],
  },
  {
    version: "0.3.1",
    title: "AI News Digest — 17th AI surface fills out the News tab",
    bullets: [
      "Lands at the top of the News tab between the marquee ticker bar and the search input. Auto-loads on tab open with a 2-3 sentence Claude-written digest of headlines from the user's top 5 weighted holdings, plus the underlying article rows that the digest references. Tap any headline → opens the article in the browser.",
      "New news-digest Edge Function. Reads holdings → sorts by USD value → picks top 5 tickers → reads cached articles from public.articles for those tickers → asks Claude to synthesize 2-3 sentences naming concrete headlines + impact. Numbers / tickers / URLs pass through unchanged; LLM only writes the synthesis.",
      "FREE for both tiers — auto-loaded surface, no quota consumed. Same model as Daily Brief, Earnings Watch, Compare Benchmark, Risk Score, Quarterly Review.",
      "Hides silently when: user has no holdings, no cached articles for those tickers, AI fails, or consent denied. The card only appears when there's something useful to say.",
      "17 AI surfaces total now. Closes the gap on 'the News tab isn't doing much' from the punch list.",
    ],
  },
  {
    version: "0.3.0",
    title: "Privacy Manifest — App Store submission unblocker",
    bullets: [
      "Added ios/App/App/PrivacyInfo.xcprivacy. Required by Apple since iOS 17 / 2024-Q1 for any app submitted to the App Store. Declares: 6 data types collected (name, email, phone, user-generated content, photos/videos, diagnostic data), all linked to user identity, none used for tracking. Plus 4 Required-Reason API declarations (UserDefaults CA92.1 via Capacitor Preferences, file timestamp C617.1, system boot 35F9.1, disk space E174.1).",
      "Added the file to the App Xcode target (PBXBuildFile + PBXFileReference + Resources build phase) by editing project.pbxproj directly. Verified the file lands in App.app/PrivacyInfo.xcprivacy after xcodebuild — Apple's validator picks it up on submission.",
      "Tracking explicitly set to false. No IDFA usage. NSPrivacyTrackingDomains empty array.",
      "Keep this file in sync as we add: payment data (would need DataCategoryFinancialInfo + a new purpose), third-party SDKs that collect/track, new Apple Required-Reason APIs.",
    ],
  },
  {
    version: "0.2.9",
    title: "Settings Plus management — activate / status / cancel",
    bullets: [
      "New PlusSettingsRow at the top of Settings showing subscription status. Inactive: gray icon + 'Activar' button → opens the upsell modal. Active: green chip 'Activo' + 'Cancelar' button → confirm dialog → cancel_plus RPC flips is_plus = false.",
      "Distinct from the Pro-view density toggle just below it. Both rows live together so the user can see both controls in one place: top row = paid AI subscription, bottom row = free UI density. No more semantic overlap.",
      "New cancel_plus RPC (SECURITY DEFINER, mirrors activate_plus). Production swap: Apple StoreKit handles cancellation in iOS Settings → Subscriptions; we receive DID-CHANGE-RENEWAL-STATUS webhook and flip the flag server-side.",
      "Cancel triggers a fresh getAIQuotaStatus + broadcasts the new state, so the AIQuotaPill (0.2.8) re-appears immediately with today's free-tier count without a full page refresh. The legal blurb in the pricing screen ('Cancelá cuando quieras desde Settings') is now actually backed by code.",
      "Migration: supabase/samas_plus_cancel.sql.",
    ],
  },
  {
    version: "0.2.8",
    title: "AI quota indicator — '3/5 IA hoy' pill on quota'd surfaces",
    bullets: [
      "Companion to the 0.2.6 paywall mechanism. Free users now see a small '3/5 IA hoy' pill on the AI Chat sheet, the bell-inbox header, and the AI Analysis sheet — whenever they're somewhere they're spending quota. Plus users see no pill (no cap to advertise). Tap the pill = jump straight to the Plus upsell modal.",
      "Color logic: count < 80% of limit = muted gray, count >= 80% = amber warning, count >= limit = red 'next call will block'. Pre-quota awareness without nagging — at 4/5 the amber tint signals 'last one' before the upsell fires automatically on the 6th attempt.",
      "Refresh strategy: pill mounts polling getAIQuotaStatus once, then subscribes to a new global event 'samas:ai-quota-changed' that gateOnQuota fires after each consume. No re-polling on every render. activatePlus also fires this event so the pill hides instantly when the user subscribes.",
      "New file: src/v2/AIQuotaPill.jsx (~85 lines, self-contained). Easy to drop on any future quota'd surface — RebalanceCard sheet, suggestWatchlist input, draftPost composer — when those want the indicator too.",
    ],
  },
  {
    version: "0.2.7",
    title: "Plus copy reframe — 'tu asesor personal por US$5/mes'",
    bullets: [
      "Reframed the entire upsell pitch from generic 'Pro upgrade' to specific 'Tu asesor personal de inversiones'. Cohen pitch hook is now positioning Plus against Sala de Inversores at AR$15.000/mes (vs. just 'features'), so the AR retail user reads it as private banking democratized.",
      "Replaced the 9-feature list (sector donut, heatmap, beta/vol/sharpe — all of which are now FREE Pro-view features) with 6 advisor-positioned Plus features: Unlimited AI · 24/7 advisor · Monthly reviews · Proactive insights · Data exports · Early access. The icon set goes from data-viz emojis (📊 📈 🔥) to advisor-themed ones (✦ 💬 📋 🔔 📤 🚀).",
      "Wallet hint card now appears on !isPlus instead of !proMode. Was showing 'Unlock Pro' to subscribed users with the free Lite UI on; now it shows only to non-subscribers, regardless of UI density preference.",
      "Renamed all subscription copy from 'Pro' → 'Plus' across es + en. Added pro.upsell.cta_activated key ('Plus activado ✓') so the modal's already-subscribed state renders cleanly. The 'Pro' identifier in the codebase (PRO_KEY localStorage, proMode state, ProUpsellModal component name) stayed put — they describe the FREE UI density toggle and renaming them would be a much bigger refactor.",
      "Pricing screen: title 'Activá SAMAS Plus' / subtitle 'Tu asesor personal por US$5/mes. Cancelá cuando quieras.'. Includes-list now reads from the new Plus-feature keys.",
    ],
  },
  {
    version: "0.2.6",
    title: "SAMAS Plus — AI quota gate + the actual paywall mechanism",
    bullets: [
      "First real monetization mechanism. Free tier gets 5 user-initiated AI calls per UTC day; SAMAS Plus (US$5/mo) removes the cap. Auto-loads (Daily Brief, Earnings Watch, Compare Benchmark, Risk Score, Quarterly Review) stay free in both tiers — they're the funnel hook. So are safety features (Trade Coach, Position Sizing).",
      "Quota'd surfaces (8): chat with SAMAS, deep portfolio analysis, deep asset analysis, rebalance assistant, suggest watchlist, explain news, draft post, generate proactive insights. Each call hits a server-side SECURITY DEFINER RPC `consume_ai_quota` that atomically increments today's counter and returns { allowed, count, limit }. When the user hits the limit the increment rolls back automatically so blocked attempts don't burn future quota.",
      "When the quota fires, gateOnQuota dispatches `samas:open-pro-upsell` with reason='quota' globally and throws AIQuotaExceededError. Components silently catch it (the upsell modal already showed). Activation calls `activate_plus` RPC which flips profiles_social.is_plus = true. Production swap: replace activate_plus with Apple StoreKit IAP receipt verification.",
      "isPlus state lives in SamasShell, hydrated via getAIQuotaStatus on mount. ProUpsellModal's 'Pro activado ✓' state now keys off isPlus (the subscription) instead of proMode (the free UI density toggle). Two concepts, two flags, no more confusion.",
      "Migration: supabase/samas_plus.sql. Adds is_plus + plus_activated_at columns on profiles_social, ai_usage_daily table, and the three RPCs (consume_ai_quota, get_ai_quota_status, activate_plus).",
      "Copy still says 'Pro' in the upsell modal — 0.2.7 reframes it as 'Plus' / 'tu asesor personal'.",
    ],
  },
  {
    version: "0.2.5",
    title: "Fix: Daily Brief stuck on loading skeleton forever",
    bullets: [
      "Bug since 0.1.6: DailyBriefCard initialized busy=true when no cache was present (correct — show loading), but then the load() function had a guard `if (busy && !force) return` that fired against that initial busy=true and silently returned without ever calling the Edge Function. The card sat on the loading skeleton indefinitely. Manuel saw nothing useful at the top of his Wallet for ~10 patches.",
      "Fix: replace the busy-state guard with a useRef in-flight flag. Refs initialize false and only become true once the call actually starts, so the auto-load on mount no longer hits the early return. Refresh button still uses force=true to bypass.",
      "Audited the other AI cards on Wallet + Broker for the same pattern — none of them had it. DailyBrief was the only victim.",
    ],
  },
  {
    version: "0.2.4",
    title: "AI Quarterly Review — Claude narrates your last 90 days",
    bullets: [
      "Sixteenth AI surface lands on Wallet between Earnings Watch and Preguntale a SAMAS. Pure narrative — no tap targets, no decisions to make. Card shows a 1-line headline + the quarter's return %; tap → bottom sheet with a 3-4 paragraph Claude-written review in plain Spanish, with sections: 'Tu trimestre en una mirada', 'Lo que se movió', 'Actividad', 'Hacia adelante'.",
      "New quarterly-review Edge Function. Reads holdings (current snapshot) + orders (last 90 days, executed only) and computes deterministic stats: value-weighted return %, top 3 winners, top 3 losers, trade count, most-operated ticker, new positions opened, positions closed, sector mix. Stats sent to Claude as authority; the LLM only writes the prose — numbers can't drift.",
      "Sheet renders the markdown narrative with a tiny in-house h2/p parser (no react-markdown dep — 4 paragraphs of structure don't justify the bundle weight). Stats strip on top: trade count + most-operated ticker. Winners/losers row with green/red chips per ticker.",
      "Templated fallback writes the same skeleton prose with the same numbers when ANTHROPIC_API_KEY isn't set, so the Cohen demo doesn't break before the budget approval. Hides silently when the user has no positions.",
      "16 AI surfaces total. Killer demo line: 'open Wallet, scroll down, IA writes you a private-banker-quality review of your last 3 months in plain Spanish.'",
    ],
  },
  {
    version: "0.2.3",
    title: "AI Position Sizing — Conservador / Estándar / Agresivo at the qty input",
    bullets: [
      "Fifteenth AI surface fills the empty slot in the trade flow. Trade Coach already runs at the confirmation step (0.0.95); now there's an AI sizer at the qty INPUT step — fires before the user types a number, gives them three deterministic suggestions to pick from with one tap.",
      "New position-size Edge Function. For BUY: three buckets (conservador / estándar / agresivo) computed from caps on % of book + % of cash + a concentration ceiling per bucket (10/20/35%). Conservative bucket also gets a category-risk dampener so a CRYPTO conservative is smaller than a BONO conservative for the same %. For SELL: three take-fractions (un tercio / la mitad / cerrar posición). Numbers stay deterministic; Claude refines the per-bucket rationale.",
      "Tap a chip → setQtyStr autofills the qty input, then user can edit or proceed to Review as usual. Hides silently when AI errors, consent denied, or balance is below the minimum to buy 1 unit at any bucket.",
      "15 AI surfaces total. Filling out the AI story along the entire trade flow: Position size at qty entry → Trade Coach at confirmation → Done screen.",
    ],
  },
  {
    version: "0.2.2",
    title: "Reverted: AI tax-loss harvester (0.2.0)",
    bullets: [
      "Pulled the Tax-loss harvester card off Wallet at Manuel's call. Edge Function (tax-loss-harvest) and the entire TaxLossHarvestCard component definition are gone. Down to 13 AI surfaces.",
      "Renamed the cross-shell deep-link channel introduced with 0.2.0 from samas:harvest-sell to a neutral samas:open-asset (briefcase samas_pending_harvest_sell → samas_pending_open_asset). The channel is still used by proactive-insights inbox-row taps to land on the AssetSheet — same mechanism, neutral name now that its first consumer is gone.",
      "Removed wallet.harvest.* i18n keys (es + en) and the taxLossHarvest client wrapper.",
    ],
  },
  {
    version: "0.2.1",
    title: "AI Proactive Notifications — SAMAS pings you when something matters",
    bullets: [
      "Fourteenth AI surface — different shape than the others. Instead of a card you tap, this one writes proactive notifications to your inbox + sends a push when actionable signals fire on your portfolio. Open the bell icon → tap \"Generar\" → IA scans your holdings, generates up to 5 fresh insights, drops them into the inbox via realtime so you see them slide in.",
      "Five signal types, all deterministic: concentration (>30% in one ticker), big drawdown (-15% from cost), big gain (+30% from cost), earnings within 0-2 days, and cash-drag for under-built portfolios. Each insight gets a Claude-refined title + body; numbers stay deterministic. 24h dedupe per signal+ticker so re-running doesn't spam you.",
      "Tapping a ticker insight in the inbox deep-links into Invest tab → AssetSheet for that ticker (re-uses the samas:harvest-sell channel from 0.2.0). New \"insight\" notification kind has a sparkle icon + accent tint to read distinctly from social/price/aporte rows.",
      "Push notification sent best-effort: 1 insight = full title+body push; multiple = compact \"N nuevos insights\" combined ping (lock screen stays clean). Cron-scheduling for daily auto-runs is wired but off by default — flip it on with a pg_cron migration once we have ANTHROPIC_API_KEY in production.",
      "14 AI surfaces total. Cohen pitch: open the app → bell shows a red dot → there's already a Claude-written insight waiting about your biggest position.",
    ],
  },
  {
    version: "0.2.0",
    title: "AI Tax-loss harvester — crystalize losses, save on impuesto cedular",
    bullets: [
      "Thirteenth AI surface lands on Wallet between Earnings Watch and Preguntale a SAMAS. Reads holdings → finds positions in unrealized loss → estimates how much impuesto cedular (15% on USD-sourced gains) you can offset by harvesting them this fiscal year. Headline shows the total estimated tax savings in green; per-position rows expand to a Claude-written reason and a \"Vender X ahora\" deep-link that switches to Invest tab + opens the AssetSheet pre-loaded for that ticker.",
      "New tax-loss-harvest Edge Function. Mirrors the deterministic realized-YTD seed used by Pro Wallet's TaxYearCard so the offset target lines up with what the user already sees there. Numbers stay deterministic; Claude refines summary + per-row reasons. Templated fallback when no API key.",
      "New cross-shell handoff: samas:harvest-sell event + samas_pending_harvest_sell briefcase. BrokerShell drains it once `assets` is loaded and pops the AssetSheet, same pattern as share-trade / share-watchlist / open-profile.",
      "Hides silently if no losers, AI errors, or consent denied. 13 AI surfaces total now.",
    ],
  },
  {
    version: "0.1.9",
    title: "AI Risk Score per holding — 1-10 chips on Portafolio",
    bullets: [
      "Twelfth AI surface lands on Portafolio between Rebalanceo IA and the Pro dashboard. Each held ticker gets a 1-10 risk score with a color-coded chip (green ≤3, amber ≤6, red ≥7), level label (bajo / medio / alto), and an AI-refined reason explaining what's driving the score. Tap any row to expand the reason inline.",
      "New score-risk Edge Function. Score is fully deterministic, computed server-side from: category baseline (BONO=2, ETF=4, CEDEAR=6, COMMOD=6, ACCION=7, CRYPTO=9), per-ticker volatility multiplier, concentration penalty (>40% adds 2, >25% adds 1), and drawdown bump (-15%+ adds 1). Claude Haiku only refines the human-language reasons; the numbers themselves can't hallucinate.",
      "Sorted highest-risk first so the most concentrated / volatile positions surface immediately. Hides silently if AI consent is denied or the call errors — Portafolio never breaks behind a flaky AI panel.",
      "12 AI surfaces total now.",
    ],
  },
  {
    version: "0.1.8",
    title: "AI Earnings Watch — upcoming reports for held tickers",
    bullets: [
      "Eleventh AI surface lands on Wallet between Benchmark Compare and Preguntale a SAMAS. Shows up to 3 closest upcoming earnings for tickers you hold (rest behind a \"Ver N más\" toggle). Each row: countdown chip (color-coded by proximity — red ≤1 day, amber ≤7 days, gray otherwise), ticker + name, AI commentary on position-impact, and \"X% del book · US$Y\" footer.",
      "New earnings-watch Edge Function. Per-ticker deterministic offsets (AAPL 4d, NVDA 12d, TSLA 7d, MSFT 28d, GGAL 18d, YPF 22d, etc.) — synthetic for the prototype but stable across the demo. Per-ticker historical post-earnings move % (NVDA ±7.8%, TSLA ±9.5%, etc.) feeds the AI note.",
      "Templated note rotates 5 angles (today / tomorrow / high-pct concentration / small position / generic) so consecutive items read distinctly. Claude refines each note + the summary; tickers/dates/numbers stay deterministic so the LLM can't hallucinate dates.",
      "Hides silently when no held ticker has earnings in 30 days OR the AI errors. 11 AI surfaces total now.",
    ],
  },
  {
    version: "0.1.7",
    title: "AI Benchmark Compare — \"¿Le ganás al mercado?\"",
    bullets: [
      "Tenth AI surface lands on Wallet between AI Analysis and Preguntale a SAMAS. Compares your value-weighted portfolio gain% to three benchmarks: Merval (acciones AR), S&P 500, and Bitcoin. Each row shows the benchmark's return + a green \"Le ganás\" / red \"Queda atrás\" tag. AI verdict at the bottom: 1-2 sentences interpreting the comparison (\"supera 2 de 3, mantenete enfocado\" / \"queda atrás de los tres, revisá tesis sin pánico\").",
      "New compare-benchmark Edge Function. Server-side templated fallback rotates verdict sentences based on how many benchmarks the portfolio beats. Benchmark return values are deterministic synthetic numbers (Merval +18.5%, S&P +11.2%, BTC +24.7%) — stable across the demo so the verdict stays consistent. Update annually.",
      "Answers the most-asked retail question (\"am I beating the market?\") at a glance, without making the user drill into a chart.",
      "10 AI surfaces total now.",
    ],
  },
  {
    version: "0.1.6",
    title: "AI Daily Brief on Wallet — every open shows a fresh take",
    bullets: [
      "Ninth AI surface lands at the very TOP of the Wallet (above the balance card). Auto-loads on every Wallet mount, with a localStorage cache keyed by user + UTC date so we re-fetch at most once per calendar day. Refresh button next to the gain pill forces a manual re-call.",
      "New daily-brief Edge Function. Reads holdings → computes book total + value-weighted gain% + top mover (held ticker with biggest abs day move). Asks Claude Haiku for a 2-3 sentence \"buen día\" brief that covers state of the cartera, top mover impact, and one \"qué mirar hoy\" line. Templated server-side fallback uses real numbers + sentence skeletons.",
      "Subtle accent-tinted gradient card. Sparkles icon + \"BRIEF DIARIO IA\" kicker + gain% chip on the right. Skeleton shimmer while loading. Hides silently if AI errors so the wallet never loads behind a flaky AI banner.",
      "9 AI surfaces total now. Cohen pitch: open the app → AI talks to you about your portfolio before you tap anything.",
    ],
  },
  {
    version: "0.1.5",
    title: "Native OAuth deep-link wiring — samas:// scheme",
    bullets: [
      "Continuar con Apple / Google now works natively on iOS instead of getting trapped in the WebView. Wired three pieces: (1) @capacitor/browser plugin installed; (2) samas:// URL scheme registered in Info.plist; (3) appUrlOpen handler in App.jsx that catches the redirect and calls supabase.auth.exchangeCodeForSession to finish sign-in.",
      "OAuthButtons detects Capacitor (window.Capacitor.isNativePlatform()) and switches to redirectTo: samas://auth/callback + skipBrowserRedirect: true. We then manually open the OAuth URL in system Safari via Browser.open(). Google's been blocking WebView OAuth since 2021, so this also makes Google sign-in actually work.",
      "Web build untouched — same redirectTo: window.location.origin path it had. The native code path only kicks in when window.Capacitor.isNativePlatform() returns true.",
      "OAUTH_SETUP.md updated. One thing left for Manuel: add samas://auth/callback to the Supabase project's Authentication → URL Configuration → Redirect URLs allow-list.",
    ],
  },
  {
    version: "0.1.4",
    title: "AI Rebalancing Assistant — concrete trades, one tap to execute",
    bullets: [
      "Eighth AI surface lands on the Portafolio view. New green-bordered \"Rebalancear cartera con IA\" card under the AI Plan card. Tap → sheet opens with a 3-way profile selector (Conservador / Equilibrado / Agresivo). Pick one → AI computes the gap between your current category mix and the target weights for that profile, returns concrete buy/sell actions with quantities + per-action rationale.",
      "New rebalance-portfolio Edge Function. Always runs a deterministic algorithmic rebalance first (works without Anthropic key) — Claude refines the rationale on each action without changing tickers or quantities, so the demo can't hallucinate a trade we wouldn't safely place.",
      "Each proposed action is a checkbox row — uncheck anything you don't want. \"Ejecutar operaciones seleccionadas\" loops through brokerApi.placeOrder. Per-action ✓ / × shows live as orders fire. On full success the sheet auto-closes and the portfolio refreshes.",
      "8 AI surfaces total: portfolio analysis, chat, asset insight, trade coach, post helper, news explainer, watchlist creator, rebalance — plus consent gate, EXIF strip, re-auth, AI revoke toggle.",
    ],
  },
  {
    version: "0.1.3",
    title: "Continuar con Google + Continuar con Apple",
    bullets: [
      "Two new OAuth buttons at the top of both Login and Signup screens. Apple-styled black button (per HIG: black bg + glyph + \"Continuar con Apple\"), Google-styled white button (per Google guidelines: white bg + multi-color G logo). Divider \"o con email\" below them, then the existing email/password fields.",
      "Wired through supabase.auth.signInWithOAuth({ provider }). Until you flip the providers on in Supabase Dashboard, tapping the buttons surfaces an inline \"Próximamente — habilitando Sign in with Apple/Google\" message instead of a raw error. Once enabled, redirects to provider login + back into the app via the existing onAuthStateChange listener.",
      "App Store guideline 4.8 mandates Apple Sign-In wherever you offer third-party login, so Google + Apple ship together — couldn't add Google alone.",
      "New supabase/OAUTH_SETUP.md walks Manuel through the complete provider setup: Google Cloud OAuth client, Apple Developer Services ID + Sign-in-with-Apple Key (.p8), pasting credentials into Supabase, and the optional native iOS deep-link wiring for post-Cohen.",
    ],
  },
  {
    version: "0.1.2",
    title: "Onboarding refresh — sharper copy + demo data CTA",
    bullets: [
      "Tightened all 4 slide bodies to one short sentence each (was 1-2 long sentences). iOS-onboarding feel.",
      "Slide 2 headline went from \"Invertí desde la app\" to \"Invertí con coach IA\" — leads with the differentiator. Body now mentions the trade coach reviewing each order against your portfolio before confirm.",
      "Slide 4 retitled \"Tu asistente IA\" (was \"Plan personalizado con IA\" — outdated since 0.1.0 added 6 more AI surfaces). Body now lists the actual capabilities: análisis, post drafts, watchlists temáticas, chat con tu cartera. \"Powered by Claude\" attribution. Icon swapped from concentric rings to the sparkles glyph used everywhere else.",
      "New \"Cargar datos demo\" secondary CTA on the last slide. Tap → seedDemoAccount() runs (3 watchlists + 7 holdings + cash + ledger), page reloads onto a populated app instead of empty states. Built for Cohen demo opens.",
    ],
  },
  {
    version: "0.1.1",
    title: "Audit pass — sentinel cleanup + AI revoke toggle in Settings",
    bullets: [
      "Audited the codebase for regressions before they bite during the Cohen demo. Verified DB CHECK constraints (orders, transactions, posts, price_alerts, recurring_aportes, etc.) match what client-side code inserts. Verified all 16 Edge Functions deploy cleanly. npm audit is clean. No dependency vulnerabilities. The earlier orders_status_check / posts_kind / posts_body_check / transactions_kind fixes hold up.",
      "Cleanup: TradeCoachCard's hide-on-error path used a setErr(\"__consent_denied__\") string sentinel. Replaced with a proper hidden boolean state — same UX, no magic string.",
      "New Settings → Inteligencia section with a \"Desactivar funciones IA\" toggle. The 0.0.98 consent modal promised \"podés desactivar desde Ajustes\" — now that toggle actually exists. Tapping it clears the local consent flag; the next AI tap re-prompts. Closes a small App-Store-reviewer trust gap.",
    ],
  },
  {
    version: "0.1.0",
    title: "Milestone: AI Watchlist Creator + 7 AI surfaces total",
    bullets: [
      "Marking 0.1.0 as the AI-features milestone. Seventh AI surface lands on the Watchlist tab. New ✦ IA pill next to + Nueva opens a sheet where you type a theme — \"dividendos altos\", \"IA\", \"petróleo argentino\", \"cripto\" — and Claude Haiku assembles a watchlist with name + color tag + 5-8 tickers from the SAMAS universe + a 1-2 sentence rationale. Edit any field before saving.",
      "New suggest-watchlist Edge Function. Server VALIDATES that returned tickers belong to the SAMAS universe (drops hallucinated symbols) and the color belongs to WL_COLORS. Templated keyword-routed fallback for tech/dividend/crypto/energy/ARG/ETF/commod themes.",
      "Total AI surfaces: portfolio analysis (Wallet) · multi-turn portfolio chat (Wallet) · per-asset insight (AssetSheet) · trade coach (order confirm) · post draft helper (Social compose) · news \"why does this matter\" (News) · watchlist creator (Watchlist) — plus the consent gate, EXIF stripping, and re-auth from 0.0.98. Demo-ready for Cohen.",
    ],
  },
  {
    version: "0.0.99",
    title: "AI on news — \"¿Por qué me importa?\" on every article",
    bullets: [
      "Sixth AI surface lands on the News tab. Every article now has a \"¿Por qué me importa?\" expand row at the bottom. Tap → calls a new explain-news Edge Function that takes the article + reads your holdings via JWT-scoped RLS, asks Claude Haiku for a 2-3 sentence explanation of how this story relates to YOUR specific portfolio.",
      "When the article references a ticker you actually own, an accent-tinted hits chip ($NVDA · $AAPL etc.) appears and the AI explanation is direct: \"Tu posición en $NVDA podría verse afectada por X.\" When you don't own anything mentioned, the AI explains correlation/sector context honestly instead of forcing relevance.",
      "Templated server-side fallback when ANTHROPIC_API_KEY isn't set — picks a sensible explanation based on whether any article tickers intersect held tickers. Rotates: direct match / related sector / no exposure.",
      "NewsCard refactored from a button to a div+role=button so the AI tap-row can stop event propagation cleanly without nested-button HTML. Tapping anywhere else on the card still opens the article URL in Safari.",
    ],
  },
  {
    version: "0.0.98",
    title: "Privacy + safety trio — AI consent, EXIF strip, withdraw re-auth",
    bullets: [
      "AI consent gate: first time you tap any AI feature (Análisis IA, Coach IA, Preguntale a SAMAS, Sugerime un post, asset insight, trade coach), a one-time disclosure modal explains your portfolio data goes to Anthropic Claude, no training, can be turned off in Settings. Acepto persists per-device. Rechazar lets you keep using the app non-AI.",
      "EXIF stripping on uploaded post images: every photo gets re-encoded through a canvas (createImageBitmap with imageOrientation=from-image so iPhone portrait shots stay upright) before reaching Supabase Storage. Drops GPS coordinates, camera model, all metadata. Also clamps long side to 2048px so we don't store 12MP originals.",
      "Re-auth gate before two destructive flows: outbound withdrawals (Wallet → Enviar) and account deletion (Settings → Borrar mi cuenta) now require your password again, even inside an authenticated session. Even if the device is unlocked or a session leaks, the attacker still needs the password to push these through. Wrong password shows inline error without ever calling the destructive endpoint.",
    ],
  },
  {
    version: "0.0.97",
    title: "Compose toolbar fix: 2 rows so Post never clips",
    bullets: [
      "After 0.0.88's Sugerime button landed next to 0.0.77's labeled Share portfolio pill, the action row got too wide for narrow phones — Post button was clipping off the right edge. Split the toolbar into two rows: chips (photo / paste / sugerime / Compartir cartera) up top with flex-wrap so they breathe, then char counter + Post on a dedicated bottom row.",
      "Bonus: Post button is now bigger (9×22 padding vs 8×16) since it has its own row's width to use. Also enabled-state now triggers when there's a pending portfolio attachment, even with empty body — matches the 0.0.79 behavior where portfolio posts can publish without commentary text.",
    ],
  },
  {
    version: "0.0.96",
    title: "Fix: orders_status_check rejection on every trade",
    bullets: [
      "Manuel screenshotted \"Error al colocar orden: new row for relation 'orders' violates check constraint 'orders_status_check'\" trying to sell GGAL. Bug since 0.0.76 — broker.js placeOrder was inserting status='filled' or 'open' (legacy mock vocabulary), but the DB CHECK constraint allows only 'pending' / 'executed' / 'cancelled' / 'rejected' (standard broker terms).",
      "Fix: status translation at the API boundary. broker.js now uses dbToUiStatus + uiToDbStatus helpers — INSERT uses DB vocab ('executed' for fills, 'pending' for open limits), READ paths (getOrders + placeOrder return) map DB → UI vocab so the rest of Broker.jsx keeps its existing 'filled'/'open' filters, status chips, and labels unchanged.",
      "Trades + sells should land cleanly now. Trade Coach card from 0.0.95 still fires beforehand with its sanity verdict.",
    ],
  },
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

// PlusSettingsRow (samas-0.2.9) — Plus subscription status + CTA.
// Inactive: shows "Activar Plus" button → opens upsell modal.
// Active: shows green chip + "Cancelar" → confirms then calls
// cancel_plus RPC. Distinct from the Pro-view toggle below.
function PlusSettingsRow({ T, isPlus, setIsPlus, onOpenPlusUpsell, lang = "es" }) {
  const [busy, setBusy] = React.useState(false);
  async function handleCancel() {
    if (busy) return;
    if (!confirm(tr("settings.plus.cancel_confirm", lang))) return;
    setBusy(true);
    try {
      await cancelPlus();
      if (setIsPlus) setIsPlus(false);
      toast.success(tr("settings.plus.cancel_success", lang));
    } catch (e) {
      toast.error(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{
      width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 8,
      background: T.surface, border: `1px solid ${T.border}`,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: isPlus ? T.accentSoft : T.bg,
        color: isPlus ? T.accent : T.textMute,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text,
        }}>
          <span>{tr("settings.plus.title", lang)}</span>
          {isPlus && (
            <span style={{
              padding: "2px 8px", borderRadius: 999,
              background: T.accent, color: T.accentInk,
              fontFamily: FONT.mono, fontSize: 9, fontWeight: 800,
              letterSpacing: 0.5, textTransform: "uppercase",
            }}>{tr("settings.plus.active", lang)}</span>
          )}
        </div>
        <div style={{
          fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2,
          lineHeight: 1.4,
        }}>
          {isPlus
            ? tr("settings.plus.active_sub", lang)
            : tr("settings.plus.inactive_sub", lang)}
        </div>
      </div>
      {isPlus ? (
        <button
          onClick={handleCancel}
          disabled={busy}
          style={{
            padding: "7px 12px", borderRadius: 999,
            background: "transparent", border: `1px solid ${T.danger}55`,
            color: T.danger, fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
            cursor: busy ? "default" : "pointer", flexShrink: 0,
            opacity: busy ? 0.6 : 1,
          }}>
          {busy ? tr("settings.plus.cancelling", lang) : tr("settings.plus.cancel_cta", lang)}
        </button>
      ) : (
        <button
          onClick={onOpenPlusUpsell}
          style={{
            padding: "7px 12px", borderRadius: 999,
            background: T.accent, border: "none",
            color: T.accentInk, fontFamily: FONT.sans, fontSize: 11, fontWeight: 800,
            cursor: "pointer", flexShrink: 0,
          }}>
          {tr("settings.plus.activate_cta", lang)}
        </button>
      )}
    </div>
  );
}

// AI master switch toggle (samas-0.4.11). Reads localStorage on
// mount, listens for samas:ai-disabled-changed broadcasts so other
// surfaces stay in sync. Flipping the toggle persists + broadcasts.
function AIDisabledToggle({ T, lang = "es" }) {
  const [disabled, setDisabled] = React.useState(() => isAIDisabled());

  React.useEffect(() => {
    function onChange(e) {
      setDisabled(!!e?.detail?.disabled);
    }
    window.addEventListener("samas:ai-disabled-changed", onChange);
    return () => window.removeEventListener("samas:ai-disabled-changed", onChange);
  }, []);

  function flip() {
    const next = !disabled;
    setAIDisabled(next);
    setDisabled(next);
  }

  // The toggle reads "Funciones de IA" with active = ON (= AI
  // enabled) so the natural reading is "I want AI on / off".
  // Internal state stores the OPPOSITE (disabled flag) — invert
  // when displaying.
  return (
    <button onClick={flip} style={{
      width: "100%", padding: "12px 14px", borderRadius: 14, marginBottom: 8,
      background: T.surface, border: `1px solid ${T.border}`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      cursor: "pointer", textAlign: "left",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
          {tr("settings.ai.master.title", lang)}
        </div>
        <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
          {disabled
            ? tr("settings.ai.master.sub_off", lang)
            : tr("settings.ai.master.sub_on", lang)}
        </div>
      </div>
      <div style={{
        width: 44, height: 24, borderRadius: 12, flexShrink: 0,
        background: disabled ? T.border : T.accent,
        position: "relative", transition: "background 0.15s ease",
      }}>
        <div style={{
          position: "absolute", top: 2, left: disabled ? 2 : 22,
          width: 20, height: 20, borderRadius: "50%",
          background: "#fff", transition: "left 0.15s ease",
        }}/>
      </div>
    </button>
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

// Placeholder "Próximamente" component lived here through 0.4.5.
// All four bottom tabs (Wallet, Invertir, Social, News) are wired
// to real components now — the placeholder hadn't been instantiated
// in the JSX since the tabs went live. Removed in 0.4.6.

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
