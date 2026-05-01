// ============================================================
// SAMAS v2 — Social sub-shell (drill-in pattern, like Broker)
// ============================================================
// Tapping the Social tab in the main shell short-circuits to this
// shell, which has its own bottom nav (Feed / Buscar / Mensajes /
// Perfil) plus a back arrow and a mini SAMAS mark in the header so
// the user knows they're still in the SAMAS app.
//
// Sub-views:
//   Feed     — Twitter-like feed (Para vos / Siguiendo / Trades),
//              compose box, like/repost/save per post
//   Buscar   — find users by handle or name, follow/unfollow inline
//   Mensajes — DM inbox (UI only — real DMs need backend, see TODO)
//   Perfil   — your profile: name + handle + verified badge + your
//              own posts + saved posts shortcut
// ============================================================

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { FONT } from "./theme.js";
import { Ico } from "./icons.jsx";
import { social as socialApi, messages as messagesApi, broker as brokerApi } from "./api/index.js";
import { useEdgeSwipeBack } from "./useEdgeSwipeBack.js";
import { usePullToRefresh } from "./usePullToRefresh.jsx";
import { setRefreshHandler, callRefreshFor } from "./refreshRegistry.js";
import { avatarPropsFor, PostCardSkeleton, DmThreadSkeleton, UserRowSkeleton, ReplyRowSkeleton, useShellEntryDone } from "./shared.jsx";
import { draftPost } from "../lib/ai.js";
import { supabase } from "../lib/supabase.js";
import { t as tr } from "../lib/i18n.js";
import { hapticNative } from "../lib/native.js";

// SUB_TABS labels are looked up dynamically below so they re-translate
// when the user changes language. We keep id + icon static here.
const SUB_TABS = [
  { id: "feed",     key: "social.subnav.feed",     icon: Ico.Comment },
  { id: "search",   key: "social.subnav.search",   icon: Ico.Search  },
  { id: "messages", key: "social.subnav.messages", icon: Ico.Send    },
  { id: "profile",  key: "social.subnav.profile",  icon: Ico.Users   },
];

// ----------------------------------------------------------
// SocialPage — the wrapper with header + bottom nav + sub-view.
// Exposed under the same name SocialPage so Shell.jsx doesn't need to
// change its lazy import.
// ----------------------------------------------------------
export function SocialPage({ T, isNativeApp = false, onBack, lang = "es", user = null }) {
  const [tab, setTab] = useState("feed");
  // Drilled-in peer profile. When set, a ProfileView sits above the
  // current sub-tab as an overlay; tapping back returns to wherever
  // the user came from. Tapping a different bottom-nav tab also
  // dismisses the profile because tab change re-renders the active
  // sub-view from scratch.
  const [profileUserId, setProfileUserId] = useState(null);
  // Drilled-in thread view (post + replies). Same overlay pattern
  // as profileUserId above, but stacks on top of profile so a user
  // can: open profile → tap a post in their feed → see replies →
  // back out → still on profile → back out → still on feed.
  const [threadPost, setThreadPost] = useState(null);
  // Drilled-in ticker feed (posts mentioning a specific ticker).
  // Stacks alongside profile/thread overlays.
  const [tickerFilter, setTickerFilter] = useState(null);
  // Drilled-in followers/following list. Object form so we can
  // describe both axes (whose list + which side) in one state slot.
  const [followList, setFollowList] = useState(null);
  const navBottom = isNativeApp
    ? "calc(env(safe-area-inset-bottom) + 12px)"
    : 12;

  // Notification-tap briefcase reader (samas-0.0.73). When the user
  // taps a notification in the Wallet bell inbox, Wallet dispatches
  // samas:open-profile or samas:open-thread, SamasShell stashes the
  // target id in localStorage and switches to the Social tab. We
  // drain the briefcase on mount and drill in. Thread navigation
  // needs to fetch the full post first (setThreadPost expects the
  // denormalized payload, not just an id).
  useEffect(() => {
    let alive = true;
    try {
      const pendingProfileId = localStorage.getItem("samas_pending_profile_id");
      if (pendingProfileId) {
        localStorage.removeItem("samas_pending_profile_id");
        setProfileUserId(pendingProfileId);
      }
      const pendingThreadPostId = localStorage.getItem("samas_pending_thread_post_id");
      if (pendingThreadPostId) {
        localStorage.removeItem("samas_pending_thread_post_id");
        socialApi.getPost(pendingThreadPostId)
          .then((post) => { if (alive && post) setThreadPost(post); })
          .catch((e) => console.warn("[social] open-thread fetch failed:", e?.message));
      }
    } catch (e) {
      console.warn("[social] briefcase drain failed:", e?.message);
    }
    return () => { alive = false; };
  }, []);

  // openDmWith(peerUserId) — called from SearchView's UserRow when
  // the user taps the DM button next to a search result. We stash
  // the peer id in a localStorage briefcase (same pattern as the
  // Broker → Social trade-share handoff) and switch the active tab
  // to messages. MessagesView drains the briefcase on mount, opens
  // the thread, and lands directly in the conversation view.
  function openDmWith(peerUserId) {
    if (!peerUserId) return;
    try {
      localStorage.setItem("samas_pending_dm_peer", String(peerUserId));
    } catch {}
    setProfileUserId(null); // dismiss any drilled-in profile first
    setTab("messages");
  }

  // openProfile(userId) — drill into someone's profile. Skips the
  // overlay if the userId is null/empty, or if it matches the
  // currently logged-in user (in which case we route to the Profile
  // tab instead of an overlay-of-self).
  function openProfile(peerUserId) {
    if (!peerUserId) return;
    setProfileUserId(peerUserId);
  }
  function closeProfile() { setProfileUserId(null); }

  // openThread(post) — drill into the replies thread for a post.
  // The post object is the full denormalized PostCard payload, so
  // ThreadView can render it as the parent without an extra fetch.
  function openThread(post) {
    if (!post) return;
    setThreadPost(post);
  }
  function closeThread() { setThreadPost(null); }

  // openTicker(symbol) — drill into a feed of posts mentioning a
  // given ticker. The symbol is uppercased for normalization
  // (matches the posts.ticker storage convention).
  function openTicker(symbol) {
    if (!symbol) return;
    setTickerFilter(String(symbol).toUpperCase());
  }
  function closeTicker() { setTickerFilter(null); }

  // openMention(handle) — resolve an @handle to a user_id and drill
  // into that profile. Handles are stored with the leading @ in the
  // DB, but users type them without it, so we canonicalize via
  // resolveHandleToUserId (cached). If the handle doesn't resolve
  // we silently no-op rather than show a "user not found" toast —
  // mentions of non-existent users (free-form text) shouldn't feel
  // like an error to the reader.
  async function openMention(handle) {
    if (!handle) return;
    try {
      const userId = await resolveHandleToUserId(handle);
      if (userId) openProfile(userId);
    } catch (e) {
      console.warn("[social] openMention failed:", e?.message);
    }
  }

  // openFollowList(userId, mode) — drill into the followers /
  // following list for a profile. mode is "followers" | "following".
  // Stacks above the profile overlay so the user can: feed → tap
  // profile → tap "30 seguidores" → see the list → back back back.
  function openFollowList(userId, mode) {
    if (!userId || !mode) return;
    setFollowList({ userId, mode });
  }
  function closeFollowList() { setFollowList(null); }

  // openHashtag(tag) — drop the user into the Search tab with the
  // query pre-filled to "#tag". SearchView detects the # prefix and
  // runs a body-substring query (searchPostsByBody) instead of the
  // user/ticker mode. Briefcase pattern keeps SearchView's local
  // query state authoritative — we don't pass a controlled prop.
  function openHashtag(tag) {
    if (!tag) return;
    try {
      localStorage.setItem("samas_pending_search", `#${tag}`);
    } catch {}
    // Dismiss any drilled-in overlays so the search view is on top.
    setProfileUserId(null);
    setThreadPost(null);
    setTickerFilter(null);
    setTab("search");
  }

  // iOS-style swipe-from-left-edge back to the wallet shell.
  const { bind: swipeBind, style: swipeStyle } = useEdgeSwipeBack(onBack);
  // Pull-to-refresh — calls the active sub-tab's registered handler.
  const { bind: ptrBind, indicator: ptrIndicator } = usePullToRefresh(
    () => callRefreshFor(`social-${tab}`)
  );
  // Drop entry animation's GPU compositing layer after 260ms so
  // position:fixed descendants (compose modal, sheets, etc.) escape
  // the trapped stacking context. samas-0.0.87.
  const entryDone = useShellEntryDone(260);

  return (
    <div {...swipeBind} style={{
      position: "absolute", inset: 0,
      background: T.bg, color: T.text,
      overflow: "hidden",
      display: "flex", flexDirection: "column",
      fontFamily: FONT.sans,
      animation: entryDone ? "none" : "samas-shell-in 240ms cubic-bezier(.2,.8,.2,1)",
      ...swipeStyle,
    }}>
      <style>{`
        @keyframes samas-shell-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
      {/* Header — back arrow + mini SAMAS logo + section title */}
      <div style={{
        flexShrink: 0,
        padding: "calc(env(safe-area-inset-top) + 14px) 16px 12px",
        display: "flex", alignItems: "center", gap: 12,
        background: T.bg,
        borderBottom: `1px solid ${T.border}`,
        zIndex: 5,
      }}>
        {onBack && (
          <button onClick={onBack} style={{
            width: 40, height: 40, borderRadius: 12,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Ico.Back size={18}/>
          </button>
        )}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flexShrink: 0, color: T.text }}>
            <Ico.Logo size={26}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: FONT.display, fontSize: 22, fontWeight: 700,
              color: T.text, letterSpacing: -0.4,
            }}>{tr("social.title", lang)}</div>
            <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>
              {tr(SUB_TABS.find((t) => t.id === tab)?.key || "social.subnav.feed", lang)}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div {...ptrBind} style={{
        flex: 1, overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
      }}>
        {ptrIndicator}
        {/* Keyed wrapper → cross-fade between Feed / Search / Messages
            / Profile when the user taps the bottom nav (samas-0.0.81). */}
        <div key={tab} className="samas-tab-content">
          {tab === "feed"     && <FeedView T={T} lang={lang} user={user} onOpenProfile={openProfile} onOpenThread={openThread} onOpenTicker={openTicker} onOpenMention={openMention} onOpenHashtag={openHashtag} />}
          {tab === "search"   && <SearchView T={T} lang={lang} user={user} onMessageUser={openDmWith} onOpenProfile={openProfile} onOpenThread={openThread} onOpenTicker={openTicker} onOpenMention={openMention} onOpenHashtag={openHashtag} />}
          {tab === "messages" && <MessagesView T={T} lang={lang} user={user} onOpenProfile={openProfile} onOpenTicker={openTicker} onOpenMention={openMention} onOpenHashtag={openHashtag} />}
          {tab === "profile"  && <ProfileView T={T} lang={lang} user={user} onOpenProfile={openProfile} onOpenThread={openThread} onOpenTicker={openTicker} onOpenMention={openMention} onOpenHashtag={openHashtag} onOpenFollowList={openFollowList} />}
        </div>
      </div>

      {/* Drill-in peer profile overlay. Sits above the current
          sub-tab so back-arrow returns the user exactly where they
          came from. Bottom nav stays interactive — tapping a tab
          dismisses the overlay and routes there. */}
      {profileUserId && (
        <DrillInOverlay T={T}>
          <div {...ptrBind} style={{
            flex: 1, overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
            paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)", // leave room for the bottom nav
          }}>
            <ProfileView
              T={T}
              lang={lang}
              user={user}
              profileUserId={profileUserId}
              onBack={closeProfile}
              onOpenProfile={openProfile}
              onMessage={openDmWith}
              onOpenThread={openThread}
              onOpenTicker={openTicker}
              onOpenMention={openMention} onOpenHashtag={openHashtag}
              onOpenFollowList={openFollowList}
            />
          </div>
        </DrillInOverlay>
      )}

      {/* Drill-in thread view. Rendered on top of the profile
          overlay (via z-order via render order) so a user can drill
          profile → tap one of their posts → see replies → back out
          to profile → back out to feed. */}
      {threadPost && (
        <DrillInOverlay T={T} zIndex={30}>
          <ThreadView
            T={T}
            lang={lang}
            post={threadPost}
            onBack={closeThread}
            onOpenProfile={openProfile}
            onOpenTicker={openTicker}
            onOpenMention={openMention} onOpenHashtag={openHashtag}
          />
        </DrillInOverlay>
      )}

      {/* Drill-in ticker feed. Same overlay pattern; stacks at
          z-index 35 so it sits above the thread overlay (a user
          can be in a thread, tap a $TICKER chip on the parent
          post, and drill further into the ticker feed). */}
      {tickerFilter && (
        <DrillInOverlay T={T} zIndex={35}>
          <TickerFeedView
            T={T}
            lang={lang}
            ticker={tickerFilter}
            onBack={closeTicker}
            onOpenProfile={openProfile}
            onOpenThread={openThread}
            onOpenTicker={openTicker}
            onOpenMention={openMention} onOpenHashtag={openHashtag}
          />
        </DrillInOverlay>
      )}

      {/* Followers / Following list overlay — z-index 32 so it sits
          above the profile overlay (z-index implicit ~10 from
          render order) but below ThreadView / TickerFeedView (30 /
          35). User flow: feed → profile → tap "30 seguidores" →
          this list → back to profile. */}
      {followList && (
        <DrillInOverlay T={T} zIndex={32}>
          <FollowListView
            T={T}
            lang={lang}
            profileUserId={followList.userId}
            mode={followList.mode}
            onBack={closeFollowList}
            onOpenProfile={(uid) => {
              // Tapping a row inside the list drills further into
              // that user's profile. We close this overlay first so
              // the profile overlay underneath becomes visible at
              // the right user, instead of stacking another profile
              // on top of the list.
              closeFollowList();
              openProfile(uid);
            }}
            onMessageUser={openDmWith}
          />
        </DrillInOverlay>
      )}

      {/* Bottom nav — hidden when ANY drill-in overlay is active.
          Each overlay has its own back arrow header for navigation,
          and the compose bars in ThreadView / ConversationView would
          otherwise fight for the same vertical real estate as the
          tab bar. iOS native pattern: tab bar hides on detail push. */}
      {!profileUserId && !threadPost && !tickerFilter && !followList && (
        <SocialNav T={T} tab={tab} setTab={setTab} bottomInset={navBottom} lang={lang} />
      )}
    </div>
  );
}

// ----------------------------------------------------------
// DrillInOverlay — wraps a drill-in (profile / thread / ticker /
// follow-list) with the slide-in entry animation, then drops the
// animation after it completes (samas-0.0.87) so iOS WebKit's
// compositing-layer-as-stacking-context doesn't trap any
// position:fixed descendant inside this overlay.
// ----------------------------------------------------------
function DrillInOverlay({ T, zIndex, children }) {
  const entryDone = useShellEntryDone(240);
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: T.bg, color: T.text,
      overflow: "hidden",
      display: "flex", flexDirection: "column",
      animation: entryDone ? "none" : "samas-shell-in 220ms cubic-bezier(.2,.8,.2,1)",
      ...(zIndex != null ? { zIndex } : null),
    }}>
      {children}
    </div>
  );
}

// ----------------------------------------------------------
// SocialNav — same shape as the broker SubNav.
// ----------------------------------------------------------
function SocialNav({ T, tab, setTab, bottomInset, lang = "es" }) {
  return (
    <div style={{
      position: "absolute", left: 12, right: 12, bottom: bottomInset,
      zIndex: 40,
      borderRadius: 28, padding: "10px 8px",
      background: T.surface,
      border: `1px solid ${T.border}`,
      boxShadow: "0 12px 30px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.04) inset",
      display: "flex", justifyContent: "space-around", alignItems: "center",
    }}>
      {SUB_TABS.map((t) => {
        const active = t.id === tab;
        const TabIco = t.icon;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: "none", border: "none", cursor: "pointer", padding: "6px 8px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            color: active ? T.accent : T.textMute, position: "relative",
            fontFamily: FONT.sans, fontSize: 10, fontWeight: 600, letterSpacing: 0.2,
          }}>
            {active && (
              <div style={{
                position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)",
                width: 24, height: 3, borderRadius: 2, background: T.accent,
              }} />
            )}
            <TabIco size={20} sw={active ? 2 : 1.7} />
            <span>{tr(t.key, lang)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// FEED — top tabs (Siguiendo / Para vos / Trades) + compose + cards
// ============================================================
// Keys looked up via tr(...) below so they re-translate live.
// Order matters — first tab is the default selection on initial
// mount (FeedView seeds tab state to "for_you" below). Trending
// goes first now (samas-0.0.36): the ranked feed is the default
// landing experience because it's where the most-engaged content
// lives. Following is second (curated stream), Trades is the
// always-trade-card filter.
const FEED_TABS = [
  { id: "for_you",    key: "social.tab.for_you"   },
  // "newest" — chronological alternative to Trending (samas-0.0.82).
  // Same posts, but ordered by created_at desc instead of by engagement.
  { id: "newest",     key: "social.tab.newest"    },
  { id: "following",  key: "social.tab.following" },
  { id: "trades",     key: "social.tab.trades"    },
  { id: "portfolios", key: "social.tab.portfolios" },
];

function FeedView({ T, lang = "es", user = null, onOpenProfile, onOpenThread, onOpenTicker, onOpenMention, onOpenHashtag }) {
  const [tab, setTab] = useState("for_you");
  const [posts, setPosts] = useState([]);
  const [me, setMe] = useState(null);
  const [savedIds, setSavedIds] = useState([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Compose expand state (samas-0.0.82). When the textarea is focused,
  // the compose card grows ~3x taller, a backdrop dim fades in behind
  // the rest of the page, and the compose floats above the bottom nav
  // (z-index escalation). Tap-outside / publish / cancel collapses it.
  const [composeExpanded, setComposeExpanded] = useState(false);
  // Trade attachment: when the Broker hands off a filled trade, we
  // prefill `body` with a default sentence and `pendingTrade` with
  // the jsonb-shaped payload. publish() forwards both to createPost
  // so the post lands with a trade card. The user can clear the
  // attachment with the X button (body stays).
  const [pendingTrade, setPendingTrade] = useState(null);
  // Portfolio attachment (samas-0.0.79): when the user taps "Compartir
  // cartera" we snapshot their broker portfolio and stash the structured
  // payload here. publish() forwards it to createPost as `portfolio`,
  // which lands on posts.payload with kind='portfolio'. The compose
  // shows a read-only card preview above the textarea so the user CAN'T
  // edit the numbers (anti-fake-screenshot mitigation). Body becomes
  // optional commentary for portfolio posts.
  const [pendingPortfolio, setPendingPortfolio] = useState(null);
  // Image attachment — File from the picker + a local object URL for
  // the preview thumbnail. Uploaded to Supabase Storage on publish().
  // We keep the File around (not the URL) because the preview URL
  // is local-only; the upload happens at publish time so the user
  // can change their mind without burning a storage write.
  const [pendingImage, setPendingImage] = useState(null);
  const [pendingImagePreview, setPendingImagePreview] = useState(null);
  const fileInputRef = React.useRef(null);
  // Free the object URL when the preview changes / unmounts so we
  // don't leak memory on iOS WebView (which doesn't aggressively GC
  // these on its own).
  useEffect(() => {
    return () => {
      if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview);
    };
  }, [pendingImagePreview]);
  // $-mention autocomplete state. We load the asset universe once
  // (small list, ~20 entries) and surface matching tickers in a
  // dropdown when the user types $ followed by 0+ alphanumerics.
  // tickerMatch holds { start, end, query } when an active query
  // is being typed, null otherwise. Computed on every body/cursor
  // change via findActiveTickerQuery below.
  const [assetUniverse, setAssetUniverse] = useState([]);
  const [tickerMatch, setTickerMatch] = useState(null);
  const composeRef = React.useRef(null);
  useEffect(() => {
    let alive = true;
    brokerApi.getAssets().then((list) => {
      if (alive) setAssetUniverse(list || []);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Compute the active $-mention query from body + cursor position.
  // Walks backward from the cursor; if it hits a $ before any
  // whitespace and the chars between $ and cursor are all
  // alphanumeric, that's an active query. Returns { start, end,
  // query } where start = index of $, end = cursor, query = the
  // uppercased typed-so-far string (may be empty if the user just
  // typed $). Updates tickerMatch state.
  function recomputeTickerMatch(text, cursorPos) {
    if (cursorPos == null || cursorPos > text.length) {
      setTickerMatch(null);
      return;
    }
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === "$") {
        const q = text.slice(i + 1, cursorPos);
        if (/^[A-Za-z0-9]*$/.test(q)) {
          setTickerMatch({ start: i, end: cursorPos, query: q.toUpperCase() });
          return;
        }
        setTickerMatch(null);
        return;
      }
      if (/\s/.test(ch)) { setTickerMatch(null); return; }
    }
    setTickerMatch(null);
  }

  // Suggestions filtered by the current query — top 6 matches.
  // Prefix match on ticker first (e.g. "NV" → NVDA), then a
  // looser substring match on the asset name as a fallback
  // (so "appl" surfaces AAPL via name match).
  const tickerSuggestions = useMemo(() => {
    if (!tickerMatch) return [];
    const q = tickerMatch.query;
    const universe = assetUniverse || [];
    const seen = new Set();
    const out = [];
    for (const a of universe) {
      if (out.length >= 6) break;
      if (!a.ticker) continue;
      if (q === "" || a.ticker.startsWith(q)) {
        if (!seen.has(a.ticker)) { seen.add(a.ticker); out.push(a); }
      }
    }
    if (out.length < 6 && q.length >= 1) {
      for (const a of universe) {
        if (out.length >= 6) break;
        if (seen.has(a.ticker)) continue;
        const nameUp = String(a.name || "").toUpperCase();
        if (nameUp.includes(q)) { seen.add(a.ticker); out.push(a); }
      }
    }
    return out;
  }, [tickerMatch, assetUniverse]);

  // Replace the active query (between $ and cursor) with the
  // selected ticker symbol + a trailing space. Restore focus and
  // place the cursor right after the inserted space so the user
  // can keep typing without manually re-tapping the textarea.
  function pickTicker(symbol) {
    if (!tickerMatch || !symbol) return;
    const before = body.slice(0, tickerMatch.start);
    const after = body.slice(tickerMatch.end);
    const inserted = `$${symbol} `;
    const next = (before + inserted + after).slice(0, 280);
    setBody(next);
    setTickerMatch(null);
    const newCursor = (before + inserted).length;
    setTimeout(() => {
      const el = composeRef.current;
      if (!el) return;
      try {
        el.focus();
        el.setSelectionRange(newCursor, newCursor);
      } catch {}
    }, 0);
  }

  // On first mount, drain the share briefcase (set by SamasShell when
  // Broker dispatches "samas:share-trade"). This is one-shot — once
  // consumed, the briefcase is cleared so a future visit to Social
  // doesn't keep re-prefilling the compose box.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("samas_pending_trade_share");
      if (!raw) return;
      const trade = JSON.parse(raw);
      localStorage.removeItem("samas_pending_trade_share");
      if (!trade || !trade.ticker) return;
      setPendingTrade(trade);
      const tplKey = trade.side === "buy"
        ? "social.compose.trade_buy_template"
        : "social.compose.trade_sell_template";
      // Privacy: don't interpolate qty or price into the body string
      // (samas-0.3.6). The pendingTrade payload still carries them
      // for any callers that want them, but the public template only
      // mentions $TICKER.
      setBody(tr(tplKey, lang, {
        ticker: String(trade.ticker),
      }));
    } catch (e) {
      console.warn("[social] trade prefill failed:", e);
    }
  }, [lang]);

  // Same one-shot drain for the watchlist-share briefcase (set by
  // the Watchlist tab's Share button via "samas:share-watchlist").
  // We just dump the prepared body string straight into the compose
  // box — the dispatcher already formatted it with the $TICKER chips.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("samas_pending_text_share");
      if (!raw) return;
      localStorage.removeItem("samas_pending_text_share");
      setBody(raw.slice(0, 280));
      setTimeout(() => {
        const el = composeRef.current;
        if (!el) return;
        try { el.focus(); el.setSelectionRange(raw.length, raw.length); } catch {}
      }, 0);
    } catch (e) {
      console.warn("[social] text-share prefill failed:", e);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [feed, m, saved] = await Promise.all([
        socialApi.getFeed({ tab, limit: 30 }),
        socialApi.getMe(),
        socialApi.getSavedPosts(),
      ]);
      setPosts(feed); setMe(m); setSavedIds(saved.map((p) => p.id));
    } catch (e) { console.error("[social] load:", e); }
  }, [tab]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => setRefreshHandler("social-feed", refresh), [refresh]);

  // Realtime: a new post anywhere in the system → fetch its
  // denormalized form (author profile + my flags) and prepend to
  // the local list if it belongs in the active tab. Trade-share
  // posts originated by the current user are skipped because
  // createPost already updated state via refresh() — re-prepending
  // would cause a duplicate flash.
  //
  // We re-subscribe whenever `tab` changes so the filter logic
  // (following / for_you / trades) re-evaluates. Cheap; Supabase
  // handles channel teardown + re-establishment cleanly.
  useEffect(() => {
    let alive = true;
    let channel = null;
    let myUserId = null;
    let followingSet = null; // populated lazily for "following" tab
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        myUserId = u?.user?.id || null;
        if (tab === "following" && myUserId) {
          const { data: rows } = await supabase
            .from("follows")
            .select("following_id")
            .eq("follower_id", myUserId);
          followingSet = new Set((rows || []).map((r) => r.following_id));
        }
      } catch {}
      if (!alive) return;

      channel = supabase
        .channel(`social-feed-${tab}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "posts",
        }, async (payload) => {
          if (!alive) return;
          const row = payload.new;
          if (!row || row.deleted_at) return;
          // Tab-specific filtering on the wire:
          if (tab === "following" && (!followingSet || !followingSet.has(row.author_id))) return;
          if (tab === "trades" && !row.trade) return;
          if (tab === "portfolios" && row.kind !== "portfolio") return;
          // Skip duplicates — createPost prepended the same row already.
          if (row.author_id === myUserId) {
            // Still re-fetch for OTHER tabs where my own posts should
            // appear (for_you, trades). For "following", own posts
            // wouldn't pass the filter anyway.
            try {
              const fetched = await socialApi.getPost(row.id);
              if (alive) setPosts((prev) =>
                prev.some((p) => p.id === fetched.id) ? prev : [fetched, ...prev]
              );
            } catch {}
            return;
          }
          // Other people's posts — full denormalized fetch.
          try {
            const fetched = await socialApi.getPost(row.id);
            if (alive) setPosts((prev) =>
              prev.some((p) => p.id === fetched.id) ? prev : [fetched, ...prev]
            );
          } catch (e) {
            console.warn("[social] realtime getPost failed:", e);
          }
        })
        // Live engagement counters (samas-0.0.61). When someone OTHER
        // than the current user likes / reposts / replies to a post
        // visible in the feed, tick the matching counter without
        // re-fetching the post. We skip events authored by the
        // current user because the local optimistic update in
        // toggleLike / toggleRepost / createReply already handled
        // them — counting twice would visibly double-tick.
        //
        // For DELETE events, we depend on Postgres returning the
        // primary-key columns in payload.old (likes / reposts have
        // composite PK on (post_id, user_id), which is enough). If
        // the table ever moves to REPLICA IDENTITY FULL we get the
        // whole row, also fine.
        .on("postgres_changes", {
          event: "INSERT", schema: "public", table: "likes",
        }, (payload) => {
          const row = payload.new;
          if (!alive || !row || row.user_id === myUserId) return;
          setPosts((prev) => prev.map((p) =>
            p.id === row.post_id ? { ...p, likes: (p.likes || 0) + 1 } : p
          ));
        })
        .on("postgres_changes", {
          event: "DELETE", schema: "public", table: "likes",
        }, (payload) => {
          const row = payload.old;
          if (!alive || !row || row.user_id === myUserId) return;
          setPosts((prev) => prev.map((p) =>
            p.id === row.post_id ? { ...p, likes: Math.max(0, (p.likes || 0) - 1) } : p
          ));
        })
        .on("postgres_changes", {
          event: "INSERT", schema: "public", table: "reposts",
        }, (payload) => {
          const row = payload.new;
          if (!alive || !row || row.user_id === myUserId) return;
          setPosts((prev) => prev.map((p) =>
            p.id === row.post_id ? { ...p, reposts: (p.reposts || 0) + 1 } : p
          ));
        })
        .on("postgres_changes", {
          event: "DELETE", schema: "public", table: "reposts",
        }, (payload) => {
          const row = payload.old;
          if (!alive || !row || row.user_id === myUserId) return;
          setPosts((prev) => prev.map((p) =>
            p.id === row.post_id ? { ...p, reposts: Math.max(0, (p.reposts || 0) - 1) } : p
          ));
        })
        .on("postgres_changes", {
          event: "INSERT", schema: "public", table: "replies",
        }, (payload) => {
          const row = payload.new;
          if (!alive || !row || row.author_id === myUserId) return;
          setPosts((prev) => prev.map((p) =>
            p.id === row.post_id ? { ...p, comments: (p.comments || 0) + 1 } : p
          ));
        })
        .subscribe();
    })();
    return () => {
      alive = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [tab]);

  async function publish() {
    setErr(null);
    // Portfolio posts can ship with empty body — the card IS the post.
    // Text posts still need a non-empty body.
    if (!pendingPortfolio && !body.trim()) { setErr("El post está vacío."); return; }
    setBusy(true);
    try {
      // Privacy: strip qty + price from the trade payload before
      // it lands in the DB (samas-0.3.6). Side + ticker are the only
      // fields the renderer uses now; persisting the rest is a future
      // leak surface (admin tooling, API consumers, accidental UI
      // re-render). Same data discipline as the portfolio card.
      const safeTrade = pendingTrade
        ? { side: pendingTrade.side, ticker: pendingTrade.ticker }
        : undefined;
      await socialApi.createPost({
        body,
        trade: safeTrade,
        image: pendingImage || undefined,
        portfolio: pendingPortfolio || undefined,
      });
      setBody("");
      setPendingTrade(null);
      setPendingImage(null);
      setPendingImagePreview(null);
      setPendingPortfolio(null);
      // Collapse the expanded compose on successful publish — the
      // user is done writing, get out of their way (samas-0.0.82).
      setComposeExpanded(false);
      try { composeRef.current?.blur(); } catch {}
      await refresh();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  // Handle the file picker selection. The native iOS picker only
  // returns one file at a time even though our input lacks `multiple`,
  // but we defensively only take files[0] to be future-proof.
  function onPickImage(e) {
    const f = e?.target?.files?.[0];
    e.target.value = ""; // reset so the same file can be re-picked
    if (!f) return;
    if (!String(f.type || "").startsWith("image/")) {
      setErr("Solo se aceptan imágenes.");
      return;
    }
    if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview);
    setPendingImage(f);
    setPendingImagePreview(URL.createObjectURL(f));
    setErr(null);
  }
  function clearImage() {
    if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview);
    setPendingImage(null);
    setPendingImagePreview(null);
  }

  // AI-drafted post (samas-0.0.88). Reads the caller's holdings +
  // last few trade transactions on the server, asks Claude Haiku to
  // produce a short social-style post draft, fills the textarea
  // with the result. If textarea has user content already, we ask
  // for confirmation before overwriting (cheap window.confirm — UI
  // can pretty this up later if Manuel reports it feels too rough).
  const [suggesting, setSuggesting] = useState(false);
  async function suggestPost() {
    if (suggesting) return;
    setErr(null);
    if (body.trim() && !window.confirm(tr("social.compose.suggest_overwrite", lang))) {
      return;
    }
    setSuggesting(true);
    try {
      const { draft } = await draftPost();
      if (draft) {
        setBody(draft.slice(0, 280));
        // Focus textarea + expand state so the user lands inside the
        // draft and can edit before posting.
        setComposeExpanded(true);
        setTimeout(() => {
          const el = composeRef.current;
          if (!el) return;
          try {
            el.focus();
            el.setSelectionRange(draft.length, draft.length);
          } catch {}
        }, 0);
      }
    } catch (e) {
      // Consent declined → silent no-op (the modal already explained).
      if (e?.name === "AIConsentDeniedError" || e?.name === "AIQuotaExceededError") {
        // Consent declined OR quota hit → silent. Modal already opened.
      } else {
        console.warn("[social] suggest post failed:", e);
        setErr(tr("social.compose.suggest_err", lang));
      }
    } finally {
      setSuggesting(false);
    }
  }

  // Share-portfolio (samas-0.0.79 — restructured): snapshot the
  // user's holdings as a structured payload and attach it to the
  // compose. The card preview above the textarea is read-only —
  // the user can't edit the numbers, which kills the "fake your
  // gains" attack from the previous text-paste implementation.
  // Body remains editable as optional commentary.
  async function sharePortfolio() {
    setErr(null);
    try {
      const p = await brokerApi.getPortfolio();
      const holdings = (p?.holdings || []).filter((h) => h && h.qty > 0);
      if (holdings.length === 0) {
        setErr(tr("social.compose.portfolio_empty", lang));
        return;
      }
      // Rank by absolute value descending so the top contributors
      // surface first when we cap to 6 rows. A 0.01-NVDA position
      // shouldn't outrank a 100-share GGAL just by alphabetical
      // order. Cap at 6 to keep the card visually digestible.
      const ranked = [...holdings].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 6);
      // Privacy: shared portfolios show ALLOCATION (% of book) per
       // ticker, NOT cash amounts or unit counts. Total dollar value
       // is also dropped from the payload — only the % gain headline
       // is included. samas-0.3.5.
       const totalValue = ranked.reduce((acc, h) => acc + (h.value || 0), 0);
       const rows = ranked.map((h) => ({
         ticker: h.ticker,
         pctOfBook: totalValue > 0
           ? Number((((h.value || 0) / totalValue) * 100).toFixed(1))
           : 0,
         gainPct: Number(h.gainPct) || 0,
         currency: h.currency || "USD",
       }));
       // Aggregate gain percent across the snapshot — value-weighted
       // mean of the per-row pct, so the headline number doesn't get
       // skewed by a tiny position with an outsized %.
       const weightedGain = totalValue > 0
         ? ranked.reduce((acc, h) => acc + ((h.value || 0) * (h.gainPct || 0)), 0) / totalValue
         : 0;
       setPendingPortfolio({
         // totalUsd intentionally omitted — privacy. Don't add it back
         // without re-thinking the share-card display.
         gainPct: Number(weightedGain.toFixed(2)),
         capturedAt: new Date().toISOString(),
         rows,
       });
      // Focus the textarea so the user can add commentary if they
      // want — the card itself is read-only.
      setTimeout(() => {
        const el = composeRef.current;
        if (el) try { el.focus(); } catch {}
      }, 0);
    } catch (e) {
      console.warn("[social] share portfolio failed:", e);
      setErr(tr("social.compose.portfolio_err", lang));
    }
  }

  // Paste from the system clipboard. We use the Clipboard API (works
  // on iOS Safari + WKWebView since iOS 13.4 with a user-gesture
  // requirement, which a button tap satisfies). Capacitor's Clipboard
  // plugin would also work but adds a native dependency we'd otherwise
  // not need — the Web API is enough.
  //
  // Behavior: append (not replace) so paste composes with whatever
  // the user already typed. Trim leading whitespace if the pasted
  // text starts at the beginning of the body to avoid a stray space.
  async function pasteFromClipboard() {
    setErr(null);
    try {
      let text = "";
      if (navigator?.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      }
      text = (text || "").trim();
      if (!text) {
        setErr(tr("social.compose.paste_empty", lang));
        return;
      }
      // Insert at cursor if we can, else append.
      const el = composeRef.current;
      let next;
      let nextCursor;
      if (el && typeof el.selectionStart === "number") {
        const start = el.selectionStart;
        const end = el.selectionEnd ?? start;
        const before = body.slice(0, start);
        const after = body.slice(end);
        // Put a space between if we're appending right after a
        // non-space char and the pasted text doesn't start with one.
        const sep = (before.length > 0 && !/\s$/.test(before) && !/^\s/.test(text)) ? " " : "";
        next = (before + sep + text + after).slice(0, 280);
        nextCursor = (before + sep + text).length;
      } else {
        const sep = (body.length > 0 && !/\s$/.test(body) && !/^\s/.test(text)) ? " " : "";
        next = (body + sep + text).slice(0, 280);
        nextCursor = next.length;
      }
      setBody(next);
      // Restore focus + cursor on the next tick so the tap that
      // triggered paste doesn't immediately steal focus back.
      setTimeout(() => {
        const node = composeRef.current;
        if (!node) return;
        try {
          node.focus();
          node.setSelectionRange(nextCursor, nextCursor);
        } catch {}
        recomputeTickerMatch(next, nextCursor);
      }, 0);
    } catch (e) {
      console.warn("[social] clipboard read failed:", e);
      setErr(tr("social.compose.paste_err", lang));
    }
  }

  async function toggleLike(p) {
    try {
      if (p.likedByMe) await socialApi.unlikePost(p.id);
      else await socialApi.likePost(p.id);
      await refresh();
    } catch {}
  }
  async function repost(p) {
    try { await socialApi.repostPost(p.id); await refresh(); } catch {}
  }
  async function toggleSave(p) {
    try {
      if (savedIds.includes(p.id)) await socialApi.unsavePost(p.id);
      else await socialApi.savePost(p.id);
      const saved = await socialApi.getSavedPosts();
      setSavedIds(saved.map((x) => x.id));
    } catch {}
  }
  // Hard delete via swipe-left on a post the user owns. Optimistic:
  // we drop the post from the local list immediately so the swipe
  // feels snappy, then call the server. If the server fails (rare
  // — it's an UPDATE on deleted_at gated by author_id) we re-fetch
  // to put the post back.
  async function deletePost(p) {
    setPosts((prev) => prev.filter((x) => x.id !== p.id));
    try {
      await socialApi.deletePost(p.id);
    } catch (e) {
      console.error("[social] delete failed:", e);
      await refresh();
    }
  }

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
      {/* Top tabs — horizontally scrollable so the 5 tabs fit on
          narrow phones without crushing labels. The strip itself is
          a contained pill; tabs are min-width auto so each tab sizes
          to its label. samas-0.0.82 added scroll + Newest tab. */}
      <div style={{
        display: "flex", gap: 4, padding: 4, margin: "16px 16px 0",
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 12,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",         // Firefox
      }}>
        <style>{`
          /* Hide the WebKit scrollbar on the FEED_TABS strip without
             affecting other scrollable areas (would be too aggressive
             as a global rule). */
          .samas-feed-tabs::-webkit-scrollbar { display: none; }
        `}</style>
        {FEED_TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flexShrink: 0,
              padding: "10px 14px", borderRadius: 8,
              background: active ? T.bg : "transparent",
              border: active ? `1px solid ${T.border}` : "1px solid transparent",
              color: active ? T.text : T.textMute,
              fontFamily: FONT.sans, fontSize: 13, fontWeight: 600, cursor: "pointer",
              whiteSpace: "nowrap",
            }}>{tr(t.key, lang)}</button>
          );
        })}
      </div>

      {/* Backdrop — fades in when the compose is expanded so the
          rest of the page dims behind it. Tap to collapse + blur the
          textarea. samas-0.0.82. */}
      {composeExpanded && (
        <div
          onClick={() => {
            setComposeExpanded(false);
            try { composeRef.current?.blur(); } catch {}
          }}
          style={{
            position: "fixed", inset: 0, zIndex: 30,
            background: "rgba(0,0,0,0.55)",
            animation: "samas-fade-in 160ms ease-out",
          }}
        />
      )}

      {/* Compose — when expanded, escalates above the backdrop +
          bottom nav so it reads as a floating sheet (samas-0.0.82). */}
      <div style={{
        margin: "16px", padding: 14, borderRadius: 18,
        background: T.surface, border: `1px solid ${T.border}`,
        position: "relative",
        zIndex: composeExpanded ? 35 : "auto",
        boxShadow: composeExpanded ? "0 18px 50px rgba(0,0,0,0.5)" : "none",
        transition: "box-shadow 160ms ease-out",
      }}>
        <div style={{ display: "flex", gap: 10 }}>
          {/* Compose avatar — prefer the social profile if loaded
              (custom display_name / avatar_color); otherwise fall
              back to the auth-session-derived user from App.jsx so
              the avatar is correct from first paint, not after the
              ~500ms getMe() round-trip. */}
          {(() => {
            const props = avatarPropsFor(
              me ? { ...me, id: me.id, email: user?.email }
                 : { name: user?.name, initials: user?.initials, email: user?.email },
              T.accent,
            );
            return <Avatar T={T} initials={props.initials} color={props.color} />;
          })()}
          <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
            <textarea
              ref={composeRef}
              value={body}
              onChange={(e) => {
                const next = e.target.value.slice(0, 280);
                setBody(next);
                // Recompute right after React updates the input —
                // selectionStart on the event reflects the new value.
                recomputeTickerMatch(next, e.target.selectionStart);
              }}
              onKeyUp={(e) => recomputeTickerMatch(body, e.target.selectionStart)}
              onClick={(e) => recomputeTickerMatch(body, e.target.selectionStart)}
              onFocus={() => setComposeExpanded(true)}
              onBlur={() => {
                // Hide the dropdown a tick after blur so a tap on a
                // suggestion (which fires after blur) still registers.
                setTimeout(() => setTickerMatch(null), 150);
              }}
              placeholder={tr("social.compose_ph", lang)}
              /* When an attachment (portfolio / trade / image) is on
                 deck, the card IS the centerpiece — keep the textarea
                 compact so the layout stays balanced instead of leaving
                 a 600px void above the card (samas-0.0.83 fix). */
              rows={(composeExpanded && !pendingPortfolio && !pendingTrade && !pendingImage) ? 6 : 3}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "transparent", border: "none", outline: "none",
                color: T.text, fontFamily: FONT.sans, fontSize: 14,
                resize: "none",
                transition: "min-height 180ms ease-out",
              }}
            />
            {/* $-mention autocomplete dropdown */}
            {tickerMatch && tickerSuggestions.length > 0 && (
              <div style={{
                marginTop: 4, marginBottom: 6,
                background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12,
                overflow: "hidden",
                maxHeight: 240, overflowY: "auto",
              }}>
                {tickerSuggestions.map((a) => (
                  <button
                    key={a.ticker}
                    onMouseDown={(e) => {
                      // onMouseDown fires before blur, so the textarea
                      // doesn't lose focus before we can pick. preventDefault
                      // belt-and-braces.
                      e.preventDefault();
                    }}
                    onClick={() => pickTicker(a.ticker)}
                    style={{
                      width: "100%", padding: "8px 12px",
                      display: "flex", alignItems: "center", gap: 10,
                      background: "transparent", border: "none",
                      borderBottom: `1px solid ${T.border}`,
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <div style={{
                      fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
                      color: T.accent, minWidth: 56,
                    }}>${a.ticker}</div>
                    <div style={{
                      fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
                      flex: 1, minWidth: 0,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{a.name}</div>
                    {a.category && (
                      <div style={{
                        fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                        color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
                        background: T.surface, border: `1px solid ${T.border}`,
                        padding: "2px 6px", borderRadius: 6,
                      }}>{a.category}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
            {/* Image preview — shown when the user picked a photo.
                Square-ish thumbnail with an X to remove. Stacks
                above the trade-card preview when both are present. */}
            {pendingImagePreview && (
              <div style={{
                marginTop: 10, position: "relative",
                borderRadius: 14, overflow: "hidden",
                border: `1px solid ${T.border}`,
                background: T.bg,
                maxHeight: 220,
              }}>
                <img
                  src={pendingImagePreview}
                  alt={tr("social.post.photo", lang)}
                  style={{
                    display: "block", width: "100%", maxHeight: 220,
                    objectFit: "cover",
                  }}
                />
                <button
                  onClick={clearImage}
                  aria-label={tr("social.compose.remove_photo", lang)}
                  style={{
                    position: "absolute", top: 8, right: 8,
                    width: 28, height: 28, borderRadius: 14,
                    background: "rgba(0,0,0,0.55)", color: "#fff",
                    border: "none", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, lineHeight: 1, padding: 0,
                  }}
                >×</button>
              </div>
            )}
            {/* Trade-card preview — shown when the Broker handed off
                a filled trade. Same visual as the published trade
                card on a feed item; an X button removes the
                attachment without clearing the body text. */}
            {pendingTrade && (
              // Privacy-safe compose preview matching the post render
              // (samas-0.3.6). Shows side + ticker + "Ejecutado en
              // SAMAS" stamp; no qty, no price.
              <div style={{
                marginTop: 10, padding: "10px 12px", borderRadius: 12,
                background: T.bg, border: `1px solid ${T.border}`,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  padding: "3px 8px", borderRadius: 6,
                  background: pendingTrade.side === "buy" ? T.accentSoft : T.dangerSoft,
                  color: pendingTrade.side === "buy" ? T.accent : T.danger,
                  fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
                }}>{pendingTrade.side === "buy" ? "COMPRA" : "VENTA"}</div>
                <div style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text }}>
                  ${pendingTrade.ticker}
                </div>
                <div style={{
                  marginLeft: "auto",
                  fontFamily: FONT.sans, fontSize: 10, color: T.textMute,
                  letterSpacing: 0.4, textTransform: "uppercase",
                }}>
                  {tr("social.trade_card.via_samas", lang)}
                </div>
                <button
                  onClick={() => setPendingTrade(null)}
                  aria-label={tr("social.compose.remove_trade", lang)}
                  style={{
                    width: 22, height: 22, borderRadius: 11, marginLeft: 4,
                    background: T.surface, border: `1px solid ${T.border}`,
                    color: T.textMute, fontFamily: FONT.sans, fontSize: 12,
                    lineHeight: 1, cursor: "pointer", padding: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >×</button>
              </div>
            )}
            {/* Portfolio attachment preview (samas-0.0.79). Read-only —
                no editable fields inside, so the published numbers
                always match what the broker API returned at the
                snapshot moment. The × removes the attachment without
                touching the body. */}
            {pendingPortfolio && (
              <div style={{ marginTop: 10 }}>
                <PortfolioPostCard
                  T={T}
                  payload={pendingPortfolio}
                  lang={lang}
                  onRemove={() => setPendingPortfolio(null)}
                />
              </div>
            )}
            {/* Toolbar (samas-0.0.97) — split into two rows so the
                action chips have room and Post never clips off-screen.
                Row 1: action chips (photo / paste / suggest / share-
                portfolio). Row 2: char counter + Post. */}
            <div style={{ marginTop: 6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onPickImage}
                  style={{ display: "none" }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  aria-label={tr("social.compose.add_photo", lang)}
                  title={tr("social.compose.add_photo", lang)}
                  style={{
                    width: 36, height: 32, borderRadius: 999,
                    background: T.surface, border: `1px solid ${T.border}`,
                    color: T.text, cursor: busy ? "default" : "pointer",
                    padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {/* Inline photo icon — landscape with a sun/moon */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                </button>
                <button
                  onClick={pasteFromClipboard}
                  disabled={busy}
                  aria-label={tr("social.compose.paste", lang)}
                  title={tr("social.compose.paste", lang)}
                  style={{
                    width: 36, height: 32, borderRadius: 999,
                    background: T.surface, border: `1px solid ${T.border}`,
                    color: T.text, cursor: busy ? "default" : "pointer",
                    padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {/* Inline clipboard icon — kept here instead of
                      adding a new entry to icons.jsx since it's a
                      one-off in this file. */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                  </svg>
                </button>
                {/* AI suggest button (samas-0.0.88) — drafts a post
                    from the caller's recent activity. Compact icon-
                    only (sparkles glyph) to keep the toolbar from
                    getting crowded; tap fills the textarea with a
                    Claude-generated draft. */}
                <button
                  onClick={suggestPost}
                  disabled={busy || suggesting}
                  aria-label={tr("social.compose.suggest_post", lang)}
                  title={tr("social.compose.suggest_post", lang)}
                  style={{
                    width: 36, height: 32, borderRadius: 999,
                    background: T.surface, border: `1px solid ${T.border}`,
                    color: T.accent, cursor: (busy || suggesting) ? "default" : "pointer",
                    padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: (busy || suggesting) ? 0.6 : 1,
                  }}
                >
                  {suggesting ? (
                    <div style={{
                      width: 14, height: 14, borderRadius: 999,
                      border: `2px solid ${T.border}`, borderTopColor: T.accent,
                      animation: "samas-spin 700ms linear infinite",
                    }} />
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
                      <path d="M19 13l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>
                    </svg>
                  )}
                </button>
                {/* Portfolio-paste button — promoted in 0.0.77 from
                    an icon-only 36×32 circle to a labeled accent-
                    bordered pill so it stands out as the SAMAS-
                    distinctive social action (no other broker app
                    lets you snapshot your portfolio into a post).
                    Sits alongside the other utility buttons but
                    visually paired with Publicar via the accent
                    treatment. */}
                <button
                  onClick={sharePortfolio}
                  disabled={busy}
                  aria-label={tr("social.compose.share_portfolio", lang)}
                  title={tr("social.compose.share_portfolio", lang)}
                  style={{
                    height: 32, padding: "0 12px", borderRadius: 999,
                    background: "transparent", border: `1.5px solid ${T.accent}`,
                    color: T.accent, cursor: busy ? "default" : "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                    opacity: busy ? 0.6 : 1,
                    fontFamily: FONT.sans, fontSize: 12, fontWeight: 700,
                  }}
                >
                  {/* Pie chart icon — represents portfolio composition */}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>
                    <path d="M22 12A10 10 0 0 0 12 2v10z"/>
                  </svg>
                  <span style={{ whiteSpace: "nowrap" }}>{tr("social.compose.portfolio_chip", lang)}</span>
                </button>
              </div>
              {/* Row 2 — counter on left, Publish on right. Always
                  fits because there are only 2 elements. */}
              <div style={{
                marginTop: 8,
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
              }}>
                <span style={{
                  fontFamily: FONT.mono, fontSize: 11, color: T.textMute, flexShrink: 0,
                }}>
                  {body.length}/280
                </span>
                <button
                  onClick={publish}
                  disabled={busy || (!body.trim() && !pendingPortfolio)}
                  style={{
                    padding: "9px 22px", borderRadius: 999,
                    background: (!body.trim() && !pendingPortfolio) ? T.surface : T.accent,
                    color:      (!body.trim() && !pendingPortfolio) ? T.textMute : T.accentInk,
                    fontFamily: FONT.sans, fontSize: 14, fontWeight: 700,
                    border: (!body.trim() && !pendingPortfolio) ? `1px solid ${T.border}` : "none",
                    cursor: busy || (!body.trim() && !pendingPortfolio) ? "default" : "pointer",
                    opacity: busy ? 0.6 : 1,
                  }}
                >{busy ? "…" : tr("social.publish", lang)}</button>
              </div>
            </div>
            {err && <div style={{ marginTop: 8, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}
            {/* Discoverability hint — only when the compose box is
                empty AND no attachments. Disappears as soon as the
                user starts typing so it doesn't compete with the
                character counter. */}
            {!body && !pendingTrade && !pendingImage && (
              <div style={{
                marginTop: 6, fontFamily: FONT.sans, fontSize: 11,
                color: T.textMute, lineHeight: 1.4,
              }}>{tr("social.compose.hint", lang)}</div>
            )}
          </div>
        </div>
      </div>

      {/* Feed — keyed on the active sub-tab (Trending/Following/Trades/
          Carteras) so the feed cross-fades when the user switches
          (samas-0.0.81). */}
      <div key={tab} className="samas-tab-content" style={{ margin: "0 16px" }}>
        {posts.length === 0 ? (
          tab === "for_you" ? (
            // Trending empty state — invite the user to publish.
            // The CTA focuses the compose textarea so they can start
            // typing immediately without scrolling. Bigger card +
            // gradient backdrop than other empty states because
            // Trending is the default tab and this is what a fresh
            // user sees on first open.
            <div style={{
              marginTop: 8, padding: "24px 20px", borderRadius: 18,
              background: `linear-gradient(180deg, ${T.accentSoft} 0%, ${T.surface} 100%)`,
              border: `1px solid ${T.border}`,
              textAlign: "center",
            }}>
              <div style={{
                fontFamily: FONT.display, fontSize: 18, fontWeight: 700,
                color: T.text, marginBottom: 6, letterSpacing: -0.3,
              }}>{tr("social.feed.empty.title", lang)}</div>
              <div style={{
                fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
                lineHeight: 1.5, marginBottom: 16,
              }}>{tr("social.feed.empty.subtitle", lang)}</div>
              <div style={{
                display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap",
              }}>
                <button
                  onClick={() => composeRef.current?.focus()}
                  style={{
                    padding: "10px 20px", borderRadius: 999,
                    background: T.accent, color: T.accentInk,
                    border: "none", cursor: "pointer",
                    fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
                  }}
                >{tr("social.feed.empty.cta", lang)}</button>
                {/* Secondary CTA — surfaces the portfolio-sharing
                    feature in the most visible empty state. Same
                    sharePortfolio handler that the toolbar pill
                    calls; pre-populates compose with the user's
                    holdings snapshot. Outline-style so it doesn't
                    compete with the primary "Publicar mi primer
                    post" CTA. */}
                <button
                  onClick={sharePortfolio}
                  style={{
                    padding: "10px 18px", borderRadius: 999,
                    background: "transparent", color: T.accent,
                    border: `1.5px solid ${T.accent}`, cursor: "pointer",
                    fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
                    display: "inline-flex", alignItems: "center", gap: 7,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>
                    <path d="M22 12A10 10 0 0 0 12 2v10z"/>
                  </svg>
                  {tr("social.feed.empty.cta_portfolio", lang)}
                </button>
              </div>
            </div>
          ) : tab === "portfolios" ? (
            // Portfolios empty state — invite the user to be the
            // first to share their book. Mirrors the Trending empty
            // state visually but with the portfolio-share CTA as
            // the primary action.
            <div style={{
              marginTop: 8, padding: "24px 20px", borderRadius: 18,
              background: `linear-gradient(180deg, ${T.accentSoft} 0%, ${T.surface} 100%)`,
              border: `1px solid ${T.border}`,
              textAlign: "center",
            }}>
              <div style={{
                fontFamily: FONT.display, fontSize: 18, fontWeight: 700,
                color: T.text, marginBottom: 6, letterSpacing: -0.3,
              }}>{tr("social.portfolios_tab.empty_title", lang)}</div>
              <div style={{
                fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
                lineHeight: 1.5, marginBottom: 16,
              }}>{tr("social.portfolios_tab.empty_subtitle", lang)}</div>
              <button
                onClick={sharePortfolio}
                style={{
                  padding: "10px 20px", borderRadius: 999,
                  background: T.accent, color: T.accentInk,
                  border: "none", cursor: "pointer",
                  fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
                  display: "inline-flex", alignItems: "center", gap: 7,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>
                  <path d="M22 12A10 10 0 0 0 12 2v10z"/>
                </svg>
                {tr("social.feed.empty.cta_portfolio", lang)}
              </button>
            </div>
          ) : (
            <div style={{
              padding: 30, textAlign: "center",
              color: T.textMute, fontFamily: FONT.sans, fontSize: 13,
            }}>
              {tab === "following"
                ? "Seguí gente para ver sus posts acá."
                : "Nada por acá todavía. Compartí un trade desde el Broker para empezar."}
            </div>
          )
        ) : (
          posts.map((p) => (
            <PostCard
              key={p.id}
              T={T} p={p} lang={lang}
              saved={savedIds.includes(p.id)}
              meId={me?.id}
              onLike={() => toggleLike(p)}
              onRepost={() => repost(p)}
              onSave={() => toggleSave(p)}
              onDelete={() => deletePost(p)}
              onOpenAuthor={onOpenProfile}
              onOpenThread={onOpenThread}
              onOpenTicker={onOpenTicker}
              onOpenMention={onOpenMention} onOpenHashtag={onOpenHashtag}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================
// SEARCH — find users by handle / name, follow inline
// ============================================================
// Detect a ticker-shaped query. We accept either an explicit
// "$NVDA" prefix or a bare uppercase 1–6-char string (NVDA, BTC,
// AL30…). If the user types lowercase ("nvda") we still treat it
// as a ticker — many people will. The returned symbol is always
// uppercased and stripped of the leading $.
function tickerFromQuery(q) {
  const trimmed = (q || "").trim();
  if (!trimmed) return null;
  // Explicit $ prefix: definitely a ticker.
  if (trimmed.startsWith("$")) {
    const sym = trimmed.slice(1).toUpperCase();
    return /^[A-Z][A-Z0-9]{0,5}$/.test(sym) ? sym : null;
  }
  // No spaces, 1–6 alphanumerics, starts with a letter — looks
  // like a ticker. Mixed-case allowed; we uppercase before lookup.
  const sym = trimmed.toUpperCase();
  if (/^[A-Z][A-Z0-9]{0,5}$/.test(sym) && !sym.includes(" ")) return sym;
  return null;
}

function SearchView({ T, lang = "es", user = null, onMessageUser, onOpenProfile, onOpenThread, onOpenTicker, onOpenMention, onOpenHashtag }) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState([]);
  const [tickerPosts, setTickerPosts] = useState(null); // null = no ticker query yet, [] = empty
  // hashtagPosts: result of body-substring search when query starts
  // with #. null = inactive, [] = active but empty.
  const [hashtagPosts, setHashtagPosts] = useState(null);
  const [savedIds, setSavedIds] = useState([]);
  const [loading, setLoading] = useState(true);

  // Drain the hashtag-search briefcase that openHashtag() in SocialPage
  // sets when the user taps a #foo span on a post body. Runs once on
  // mount so subsequent visits to the search tab don't keep
  // re-prefilling.
  useEffect(() => {
    let pending;
    try { pending = localStorage.getItem("samas_pending_search"); } catch {}
    if (!pending) return;
    try { localStorage.removeItem("samas_pending_search"); } catch {}
    setQuery(pending);
  }, []);

  // The active ticker query, derived from the input. Memoized so
  // we don't fetch on every keystroke if the shape doesn't change.
  const activeTicker = useMemo(() => tickerFromQuery(query), [query]);
  // Active hashtag query (literal "#tag"). Triggers searchPostsByBody
  // instead of the ticker / users fetch.
  const activeHashtag = useMemo(() => {
    const t = (query || "").trim();
    if (!t.startsWith("#")) return null;
    const tag = t.slice(1);
    return tag.length >= 1 ? `#${tag}` : null;
  }, [query]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Always fetch matching users (handle / display name search).
      // The ticker / hashtag fetches only fire when shapes match.
      const userPromise = !activeHashtag
        ? socialApi.getUsers({ query })
        : Promise.resolve([]);
      const tickerPromise = activeTicker
        ? socialApi.getFeed({ ticker: activeTicker, limit: 30 })
        : Promise.resolve(null);
      const hashtagPromise = activeHashtag
        ? socialApi.searchPostsByBody(activeHashtag, { limit: 30 })
        : Promise.resolve(null);
      const savedPromise = socialApi.getSavedPosts().catch(() => []);
      const [u, t, h, s] = await Promise.all([userPromise, tickerPromise, hashtagPromise, savedPromise]);
      setUsers(u || []);
      setTickerPosts(t);
      setHashtagPosts(h);
      setSavedIds((s || []).map((x) => x.id));
    } catch (e) {
      console.warn("[social-search] refresh:", e);
    } finally {
      setLoading(false);
    }
  }, [query, activeTicker, activeHashtag]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => setRefreshHandler("social-search", refresh), [refresh]);

  async function toggleFollow(u) {
    try {
      if (u.followedByMe) await socialApi.unfollow(u.id);
      else await socialApi.follow(u.id);
      await refresh();
    } catch {}
  }
  async function toggleLike(p) {
    try {
      if (p.likedByMe) await socialApi.unlikePost(p.id);
      else await socialApi.likePost(p.id);
      await refresh();
    } catch {}
  }
  async function repost(p) {
    try { await socialApi.repostPost(p.id); await refresh(); } catch {}
  }
  async function toggleSave(p) {
    try {
      if (savedIds.includes(p.id)) await socialApi.unsavePost(p.id);
      else await socialApi.savePost(p.id);
      const sav = await socialApi.getSavedPosts();
      setSavedIds(sav.map((x) => x.id));
    } catch {}
  }

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
      <div style={{ padding: "16px" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", borderRadius: 14,
          background: T.surface, border: `1px solid ${T.border}`,
        }}>
          <Ico.Search size={16} stroke={T.textMute} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("social.search.ph", lang)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: T.text, fontFamily: FONT.sans, fontSize: 14,
            }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{
              background: "none", border: "none", cursor: "pointer",
              color: T.textMute, fontSize: 14, padding: 0, lineHeight: 1,
            }}>×</button>
          )}
        </div>
      </div>

      {/* Ticker results — only when the query shape matches a ticker.
          Rendered ABOVE the user list so the user gets the symbol
          context before they scroll past names. */}
      {activeTicker && (
        <div style={{ margin: "0 16px 16px" }}>
          <div style={{
            fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
            color: T.textMute, letterSpacing: 0.5, textTransform: "uppercase",
            padding: "0 4px 8px",
          }}>
            {tr("social.search.posts_about", lang, { ticker: activeTicker })}
          </div>
          {loading ? null : !tickerPosts || tickerPosts.length === 0 ? (
            <div style={{
              padding: "20px 16px", borderRadius: 14, textAlign: "center",
              background: T.surface, border: `1px solid ${T.border}`,
              color: T.textMute, fontFamily: FONT.sans, fontSize: 12,
            }}>{tr("social.search.no_posts", lang, { ticker: activeTicker })}</div>
          ) : (
            tickerPosts.map((p) => (
              <PostCard
                key={p.id}
                T={T} p={p} lang={lang}
                saved={savedIds.includes(p.id)}
                onLike={() => toggleLike(p)}
                onRepost={() => repost(p)}
                onSave={() => toggleSave(p)}
                onOpenAuthor={onOpenProfile}
                onOpenThread={onOpenThread}
                onOpenTicker={onOpenTicker}
                onOpenMention={onOpenMention} onOpenHashtag={onOpenHashtag}
              />
            ))
          )}
        </div>
      )}

      {/* Hashtag results — only when the query starts with #. Same
          card shape as ticker results above; renders below the (empty)
          ticker section because hashtag and ticker are mutually
          exclusive in practice (a query can't be both shapes). */}
      {activeHashtag && (
        <div style={{ margin: "0 16px 16px" }}>
          <div style={{
            fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
            color: T.textMute, letterSpacing: 0.5, textTransform: "uppercase",
            padding: "0 4px 8px",
          }}>
            {`Posts con ${activeHashtag}`}
          </div>
          {loading ? null : !hashtagPosts || hashtagPosts.length === 0 ? (
            <div style={{
              padding: "20px 16px", borderRadius: 14, textAlign: "center",
              background: T.surface, border: `1px solid ${T.border}`,
              color: T.textMute, fontFamily: FONT.sans, fontSize: 12,
            }}>{`No hay posts con ${activeHashtag} todavía.`}</div>
          ) : (
            hashtagPosts.map((p) => (
              <PostCard
                key={p.id}
                T={T} p={p} lang={lang}
                saved={savedIds.includes(p.id)}
                onLike={() => toggleLike(p)}
                onRepost={() => repost(p)}
                onSave={() => toggleSave(p)}
                onOpenAuthor={onOpenProfile}
                onOpenThread={onOpenThread}
                onOpenTicker={onOpenTicker}
                onOpenMention={onOpenMention} onOpenHashtag={onOpenHashtag}
              />
            ))
          )}
        </div>
      )}

      <div style={{ margin: "0 16px" }}>
        {loading ? null : users.length === 0 && !activeTicker && !activeHashtag ? (
          <div style={{
            padding: 30, textAlign: "center",
            color: T.textMute, fontFamily: FONT.sans, fontSize: 13,
          }}>Sin resultados.</div>
        ) : (
          users.map((u) => (
            <UserRow
              key={u.id}
              T={T}
              user={u}
              onToggleFollow={() => toggleFollow(u)}
              onMessage={onMessageUser ? () => onMessageUser(u.id) : undefined}
              onOpen={onOpenProfile ? () => onOpenProfile(u.id) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

function UserRow({ T, user, onToggleFollow, onMessage, onOpen }) {
  const handle = user.handle.replace(/^@/, "");
  const { initials, color } = avatarPropsFor(user, T.accent);
  // Tap on the row body (avatar + name area) → drill into profile.
  // The action buttons (Follow/DM) are siblings, not descendants of
  // the clickable area, so taps on those don't bubble here.
  const bodyProps = onOpen
    ? { onClick: onOpen, style: { cursor: "pointer" } }
    : {};
  return (
    <div style={{
      padding: "12px 4px", display: "flex", alignItems: "center", gap: 12,
      borderBottom: `1px solid ${T.border}`,
    }}>
      <div {...bodyProps} style={{
        display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0,
        ...bodyProps.style,
      }}>
      <Avatar T={T} initials={initials} color={color} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text }}>
            {user.displayName}
          </span>
          {user.verified && <span style={{ color: T.accent, fontFamily: FONT.mono, fontSize: 11, fontWeight: 800 }}>✓</span>}
        </div>
        <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>
          @{handle}
        </div>
      </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {onMessage && (
          <button
            onClick={onMessage}
            aria-label="Mensaje"
            style={{
              width: 32, height: 32, borderRadius: 999,
              background: "transparent", border: `1px solid ${T.border}`,
              color: T.text, cursor: "pointer", padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Ico.Send size={14}/>
          </button>
        )}
        <button
          onClick={onToggleFollow}
          style={{
            padding: "6px 14px", borderRadius: 999,
            background: user.followedByMe ? "transparent" : T.accent,
            border: `1px solid ${user.followedByMe ? T.border : T.accent}`,
            color: user.followedByMe ? T.text : T.accentInk,
            fontFamily: FONT.sans, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}
        >{user.followedByMe ? "Siguiendo" : "Seguir"}</button>
      </div>
    </div>
  );
}

// ============================================================
// MESSAGES — 1:1 direct messages
// ============================================================
// Two views internally: a list of threads (sorted by last_message_at)
// and a conversation view when a thread is selected. The conversation
// view subscribes to dm_messages INSERTs over realtime so the peer's
// replies arrive without a refresh. Marks messages read on open via
// messagesApi.markRead.
//
// Schema + RLS: supabase/social_messages.sql.
// API:           src/v2/api/messages.js.
// ============================================================
function MessagesView({ T, lang = "es", user = null, onOpenProfile, onOpenTicker, onOpenMention, onOpenHashtag }) {
  const [threads, setThreads] = useState(null); // null = loading
  const [active, setActive] = useState(null);   // active thread or null

  const refresh = useCallback(async () => {
    try {
      const list = await messagesApi.getThreads({ limit: 50 });
      setThreads(list);
    } catch (e) {
      console.error("[messages] getThreads:", e);
      setThreads([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => setRefreshHandler("social-messages", refresh), [refresh]);

  // Drain the "open DM with peer X" briefcase set by SocialPage's
  // openDmWith() when the user tapped the DM button on a search
  // result. Open the thread, set it as the active conversation,
  // and clear the briefcase so a future tab visit doesn't keep
  // re-opening the same chat.
  useEffect(() => {
    let alive = true;
    (async () => {
      let peerUserId;
      try {
        peerUserId = localStorage.getItem("samas_pending_dm_peer");
      } catch {}
      if (!peerUserId) return;
      try { localStorage.removeItem("samas_pending_dm_peer"); } catch {}
      try {
        const tRow = await messagesApi.openThreadWith(peerUserId);
        const t = await messagesApi.getThread(tRow.id);
        if (alive) setActive(t);
      } catch (e) {
        console.error("[messages] openDM:", e);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Realtime: any new dm_messages insert (visible to me via RLS)
  // bumps the parent thread's last_message_at and may also be a
  // new thread entirely. Cheapest path: just refresh the thread
  // list. Threads view is small (dozens of rows), the query is
  // fast, and we get correct sort + unread-count for free.
  useEffect(() => {
    let alive = true;
    let channel = null;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid || !alive) return;
      channel = supabase
        .channel(`dm-threads-${uid}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "dm_messages",
        }, () => {
          if (alive) refresh();
        })
        .subscribe();
    })();
    return () => {
      alive = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [refresh]);

  if (active) {
    return (
      <ConversationView
        T={T}
        lang={lang}
        thread={active}
        onBack={() => { setActive(null); refresh(); }}
        onOpenProfile={onOpenProfile}
        onOpenTicker={onOpenTicker}
        onOpenMention={onOpenMention} onOpenHashtag={onOpenHashtag}
      />
    );
  }

  if (threads === null) {
    // Shimmer placeholders shaped like real DM thread rows so the
    // page layout doesn't jump when threads arrive (replaces the
    // bare "Cargando…" text that was here before 0.0.65).
    return (
      <div style={{ padding: "8px 16px" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <DmThreadSkeleton key={i} T={T} />
        ))}
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div style={{
        padding: 32, paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)",
        minHeight: "calc(100vh - 200px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          textAlign: "center", padding: "32px 24px", borderRadius: 22,
          background: T.surface, border: `1px solid ${T.border}`, maxWidth: 320,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: T.accentSoft, color: T.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 14px",
          }}>
            <Ico.Send size={22} />
          </div>
          <div style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 8 }}>
            Sin mensajes todavía
          </div>
          <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5 }}>
            Tocá el ícono de mensaje en el perfil de alguien para empezar una conversación.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
      <div style={{ padding: "16px 16px 8px" }}>
        {threads.map((t) => (
          <ThreadRow key={t.id} T={T} thread={t} onOpen={() => setActive(t)} />
        ))}
      </div>
    </div>
  );
}

function ThreadRow({ T, thread, onOpen }) {
  const { initials, color } = avatarPropsFor(thread.peer, T.accent);
  const preview = thread.lastMessage
    ? (thread.lastMessage.fromMe ? "Vos: " : "") + thread.lastMessage.body
    : "Sin mensajes aún";
  return (
    <button onClick={onOpen} style={{
      width: "100%", padding: "12px 4px", display: "flex", alignItems: "center", gap: 12,
      background: "transparent", border: "none", borderBottom: `1px solid ${T.border}`,
      textAlign: "left", cursor: "pointer",
    }}>
      <Avatar T={T} initials={initials} color={color} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, justifyContent: "space-between" }}>
          <span style={{
            fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {thread.peer.displayName}
          </span>
          {thread.unreadCount > 0 && (
            <span style={{
              background: T.accent, color: T.accentInk,
              fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
              borderRadius: 10, padding: "2px 7px", flexShrink: 0,
            }}>{thread.unreadCount}</span>
          )}
        </div>
        <div style={{
          fontFamily: FONT.sans, fontSize: 12, color: T.textMute, marginTop: 2,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{preview}</div>
      </div>
    </button>
  );
}

// Conversation view — message list scrolled to bottom + compose bar.
// HH:MM in 24h locale-formatted. Used for the small timestamp
// printed under each bubble.
function fmtMsgTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("es-AR", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// Date divider label between consecutive messages from different
// days. "Hoy" for today, "Ayer" for yesterday, day-of-week for the
// last 6 days, full date otherwise. All in es-AR — peer DM threads
// in SAMAS are AR-flavored by design.
function fmtDateDivider(ts) {
  if (!ts) return "";
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Hoy";
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) {
    return d.toLocaleDateString("es-AR", { weekday: "long" })
      .replace(/^./, (c) => c.toUpperCase());
  }
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

// Bubble-shaped shimmer placeholder for the conversation loading
// state. Shape mirrors a real bubble (rounded 14, padded, colored
// surface for incoming / accentSoft for outgoing) so the skeleton
// reads as "messages loading" rather than "generic placeholder."
function BubbleSkeleton({ T, fromMe = false, width = "60%" }) {
  return (
    <div style={{
      alignSelf: fromMe ? "flex-end" : "flex-start",
      width, height: 30, borderRadius: 14,
      background: `linear-gradient(90deg, ${fromMe ? T.accentSoft : T.surface} 0%, ${T.bgElev} 50%, ${fromMe ? T.accentSoft : T.surface} 100%)`,
      backgroundSize: "200% 100%",
      animation: "samas-skel 1.4s ease-in-out infinite",
      border: fromMe ? "none" : `1px solid ${T.border}`,
    }}/>
  );
}

// Subscribes to INSERTs on dm_messages for THIS thread so peer
// replies stream in live. Marks unread-as-read on open.
function ConversationView({ T, lang = "es", thread, onBack, onOpenProfile, onOpenTicker, onOpenMention, onOpenHashtag }) {
  const [messages, setMessages] = useState(null); // null=loading
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState(null);
  const scrollRef = React.useRef(null);

  // Initial load + mark read.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (alive) setMe(u?.user?.id || null);
        const list = await messagesApi.getMessages(thread.id, { limit: 100 });
        // API returns newest-first; reverse for chronological render.
        if (alive) setMessages(list.slice().reverse());
        // Mark all unread (from peer) as read in the background.
        messagesApi.markRead(thread.id).catch(() => {});
      } catch (e) {
        console.error("[messages] load:", e);
        if (alive) setMessages([]);
      }
    })();
    return () => { alive = false; };
  }, [thread.id]);

  // Realtime: stream new messages for this thread.
  useEffect(() => {
    let alive = true;
    let channel = null;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid || !alive) return;
      channel = supabase
        .channel(`dm-thread-${thread.id}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "dm_messages",
          filter: `thread_id=eq.${thread.id}`,
        }, (payload) => {
          if (!alive) return;
          const newMsg = messagesApi.payloadToMessage(payload.new, uid);
          setMessages((prev) => {
            const list = prev || [];
            // Skip duplicates from optimistic updates
            if (list.some((m) => m.id === newMsg.id)) return list;
            return [...list, newMsg];
          });
          // If the new message is from the peer, mark it read on
          // the server so the unread count goes away.
          if (newMsg.authorId !== uid) {
            messagesApi.markRead(thread.id).catch(() => {});
          }
        })
        .subscribe();
    })();
    return () => {
      alive = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [thread.id]);

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages?.length]);

  async function send() {
    if (!body.trim()) return;
    if (busy) return;
    setBusy(true);
    const text = body;
    setBody("");
    try {
      const sent = await messagesApi.sendMessage(thread.id, text);
      setMessages((prev) => {
        const list = prev || [];
        if (list.some((m) => m.id === sent.id)) return list;
        return [...list, sent];
      });
    } catch (e) {
      console.error("[messages] send:", e);
      setBody(text); // restore on failure
    } finally {
      setBusy(false);
    }
  }

  const peerProps = avatarPropsFor(thread.peer, T.accent);

  return (
    <div style={{
      paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)",
      display: "flex", flexDirection: "column",
      // Fill the available scroll viewport so the compose bar can
      // dock at the bottom and the message list scrolls between.
      minHeight: "calc(100dvh - 180px)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 16px",
        borderBottom: `1px solid ${T.border}`,
        background: T.surface,
      }}>
        <button onClick={onBack} aria-label="Volver" style={{
          width: 32, height: 32, borderRadius: 10,
          background: T.bg, border: `1px solid ${T.border}`,
          color: T.text, cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <button
          onClick={() => onOpenProfile && thread.peer?.id && onOpenProfile(thread.peer.id)}
          disabled={!onOpenProfile}
          style={{
            display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0,
            background: "transparent", border: "none", padding: 0,
            cursor: onOpenProfile ? "pointer" : "default", textAlign: "left",
          }}
        >
        <Avatar T={T} initials={peerProps.initials} color={peerProps.color} size={32}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{thread.peer.displayName}</div>
          <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute }}>
            @{(thread.peer.handle || "").replace(/^@/, "")}
          </div>
        </div>
        </button>
      </div>

      {/* Message list */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: "auto",
        padding: "14px 16px",
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        {messages === null ? (
          // Bubble-shaped skeletons while messages load. Mix of left
          // and right alignment + varying widths so the silhouette
          // matches a real conversation. Wrap in flex column with
          // gap so the skeleton list visually matches the resolved
          // layout.
          <>
            <BubbleSkeleton T={T} fromMe={false} width="62%"/>
            <BubbleSkeleton T={T} fromMe={true}  width="48%"/>
            <BubbleSkeleton T={T} fromMe={false} width="74%"/>
            <BubbleSkeleton T={T} fromMe={false} width="40%"/>
            <BubbleSkeleton T={T} fromMe={true}  width="55%"/>
          </>
        ) : messages.length === 0 ? (
          <div style={{ color: T.textMute, fontFamily: FONT.sans, fontSize: 13, textAlign: "center", padding: 30 }}>
            Empezá la conversación.
          </div>
        ) : (
          (() => {
            // Find the last sent (own) message that the peer has
            // read — used to render the "Leído" receipt only under
            // that one bubble, the way every modern DM app does.
            let lastOwnReadId = null;
            for (let i = messages.length - 1; i >= 0; i--) {
              const m = messages[i];
              if (m.fromMe && m.readAt) { lastOwnReadId = m.id; break; }
            }
            // Walk messages once, emitting a date divider when the
            // calendar day changes from the previous bubble. This
            // keeps long threads visually parseable.
            const out = [];
            let prevDay = null;
            for (let i = 0; i < messages.length; i++) {
              const m = messages[i];
              const day = m.at ? new Date(m.at).toDateString() : "";
              if (day !== prevDay) {
                out.push(
                  <div key={`div-${day}-${i}`} style={{
                    alignSelf: "center",
                    margin: "10px 0 2px",
                    padding: "2px 10px", borderRadius: 999,
                    background: T.surface, border: `1px solid ${T.border}`,
                    fontFamily: FONT.sans, fontSize: 10, fontWeight: 700,
                    color: T.textMute, letterSpacing: 0.5, textTransform: "uppercase",
                  }}>{fmtDateDivider(m.at)}</div>
                );
                prevDay = day;
              }
              // Own bubbles are green (T.accent) — render $TICKER
              // links in T.accentInk so they're readable on the
              // accent fill. Peer bubbles use the surface color, so
              // keep the regular accent for links.
              const linkT = m.fromMe ? { ...T, accent: T.accentInk } : T;
              const showReceipt = m.id === lastOwnReadId;
              out.push(
                <div key={m.id} style={{
                  alignSelf: m.fromMe ? "flex-end" : "flex-start",
                  maxWidth: "78%",
                  display: "flex", flexDirection: "column",
                  alignItems: m.fromMe ? "flex-end" : "flex-start",
                  gap: 2,
                }}>
                  <div style={{
                    padding: "8px 12px", borderRadius: 14,
                    background: m.fromMe ? T.accent : T.surface,
                    color: m.fromMe ? T.accentInk : T.text,
                    border: m.fromMe ? "none" : `1px solid ${T.border}`,
                    fontFamily: FONT.sans, fontSize: 14, lineHeight: 1.4,
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {linkifyTickers(m.body, linkT, onOpenTicker, onOpenMention, onOpenHashtag)}
                  </div>
                  {/* Per-bubble timestamp — small, muted, padded
                      slightly so it doesn't crowd the bubble edge. */}
                  <div style={{
                    fontFamily: FONT.sans, fontSize: 10, color: T.textMute,
                    padding: "0 4px",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {fmtMsgTime(m.at)}
                    {showReceipt && (
                      <span style={{ marginLeft: 5, color: T.accent, fontWeight: 700 }}>
                        · Leído
                      </span>
                    )}
                  </div>
                </div>
              );
            }
            return out;
          })()
        )}
      </div>

      {/* Compose bar */}
      <div style={{
        padding: "10px 12px",
        borderTop: `1px solid ${T.border}`,
        background: T.bg,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 2000))}
          placeholder="Escribí un mensaje…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          style={{
            flex: 1, resize: "none",
            padding: "9px 12px", borderRadius: 14,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.sans, fontSize: 14,
            outline: "none", minHeight: 0, maxHeight: 110,
          }}
        />
        <button
          onClick={send}
          disabled={busy || !body.trim()}
          style={{
            width: 38, height: 38, borderRadius: 12,
            background: !body.trim() ? T.surface : T.accent,
            color: !body.trim() ? T.textMute : T.accentInk,
            border: !body.trim() ? `1px solid ${T.border}` : "none",
            cursor: busy || !body.trim() ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: busy ? 0.6 : 1,
          }}
          aria-label="Enviar"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ============================================================
// PROFILE — viewable in two modes:
//   1) Self (no profileUserId or matches my id): the Profile tab
//      route. Shows my posts AND my saved-posts, no Follow button.
//   2) Peer (profileUserId set, drill-in): renders a back arrow,
//      Follow/Unfollow + DM buttons, only their post list (no
//      saved tab). Followers + Following + Posts counts.
// ============================================================
function ProfileView({ T, lang = "es", user = null, profileUserId = null, onBack, onOpenProfile, onMessage, onOpenThread, onOpenTicker, onOpenMention, onOpenHashtag, onOpenFollowList }) {
  const [me, setMe] = useState(null);          // logged-in user (for fallback color, isSelf check)
  const [profile, setProfile] = useState(null); // person being viewed (me or peer)
  const [posts, setPosts] = useState([]);
  const [saved, setSaved] = useState([]);
  const [view, setView] = useState("posts");   // "posts" | "saved" — only relevant when self
  const [followBusy, setFollowBusy] = useState(false);

  const isSelf = !profileUserId || (me && me.id === profileUserId);

  const loadProfile = useCallback(async () => {
    try {
      const m = await socialApi.getMe();
      setMe(m);
      if (!profileUserId || m.id === profileUserId) {
        // Self path. We pull counts via getUserById so the follower
        // count is real (used to be hardcoded 0 — looked weird once
        // the FollowListView made the count tappable for self too).
        const [feed, follows, sav, selfMeta] = await Promise.all([
          socialApi.getPostsByAuthor(m.id, { limit: 60 }),
          socialApi.getFollowing(),
          socialApi.getSavedPosts(),
          socialApi.getUserById(m.id).catch(() => null),
        ]);
        setProfile({
          ...m,
          postCount: feed.length,
          followingCount: follows.length,
          followersCount: selfMeta?.followersCount || 0,
          createdAt: selfMeta?.createdAt || m.createdAt,
          followedByMe: false,
          isMe: true,
        });
        setPosts(feed);
        setSaved(sav);
      } else {
        // Peer path
        const [peer, peerPosts] = await Promise.all([
          socialApi.getUserById(profileUserId),
          socialApi.getPostsByAuthor(profileUserId, { limit: 30 }),
        ]);
        setProfile(peer);
        setPosts(peerPosts);
      }
    } catch (e) {
      console.error("[profile] load:", e);
    }
  }, [profileUserId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  async function toggleFollow() {
    if (!profile || isSelf || followBusy) return;
    setFollowBusy(true);
    try {
      if (profile.followedByMe) await socialApi.unfollow(profile.id);
      else await socialApi.follow(profile.id);
      // Refresh just the profile (cheap) — not the full posts query.
      const refreshed = await socialApi.getUserById(profile.id);
      setProfile(refreshed);
    } catch (e) {
      console.error("[profile] follow toggle:", e);
    } finally {
      setFollowBusy(false);
    }
  }
  // Hard delete (swipe-left). Same optimistic pattern as FeedView.
  // Only ever fires from the user's own profile because the swipe
  // action only shows on posts where p.author.id === me.id.
  async function deletePost(p) {
    setPosts((prev) => prev.filter((x) => x.id !== p.id));
    setSaved((prev) => prev.filter((x) => x.id !== p.id));
    try {
      await socialApi.deletePost(p.id);
    } catch (e) {
      console.error("[profile] delete failed:", e);
      await loadProfile();
    }
  }

  if (!profile) return null;

  // Self avatar uses the email-fallback chain (so 'MG' works on
  // first paint before me has loaded). Peer avatar uses peer fields.
  const avatarSeed = isSelf
    ? { ...profile, email: user?.email }
    : profile;
  const { initials, color } = avatarPropsFor(avatarSeed, T.accent);
  const handle = (profile.handle || "@user").replace(/^@/, "");
  const list = isSelf && view === "saved" ? saved : posts;

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
      {/* Header — back arrow when drilled in (peer view).
          Safe-area aware since this overlay covers SocialPage's
          own header chrome. */}
      {onBack && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "calc(env(safe-area-inset-top) + 8px) 12px 10px",
          borderBottom: `1px solid ${T.border}`,
          background: T.bg,
        }}>
          <button onClick={onBack} aria-label="Volver" style={{
            width: 32, height: 32, borderRadius: 10,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, cursor: "pointer", padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div style={{
            fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text,
          }}>{profile.displayName}</div>
        </div>
      )}

      {/* Profile header */}
      <div style={{ padding: "20px 16px 16px", display: "flex", alignItems: "flex-start", gap: 14 }}>
        <Avatar T={T} initials={initials} color={color} size={64}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text }}>
              {profile.displayName}
            </span>
            {/* CNV idóneo inline check — blue circle, distinct from the
                green uni check. The "verified" generic flag in
                profiles_social is no longer rendered as a tick on its
                own (kept in the schema for future flexibility) — the
                two real-world credentials we surface are CNV idóneo
                (blue) and university (green). */}
            {profile.cnvIdoneo && (
              <span aria-label="Idóneo CNV" title="Idóneo en mercado de capitales · CNV" style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 16, height: 16, borderRadius: 999,
                background: "#3B82F6", color: "#fff",
                fontSize: 10, fontWeight: 900, lineHeight: 1,
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </span>
            )}
            {/* University verification — small green check next to the
                name. Only renders when both university and the
                trigger-set verified flag are true (claim alone does
                nothing). The chip below carries the long-form label. */}
            {profile.universityVerified && profile.university && (
              <span aria-label="Universidad verificada" title="Universidad verificada" style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 16, height: 16, borderRadius: 999,
                background: T.accent, color: T.accentInk || "#0a0",
                fontSize: 10, fontWeight: 900, lineHeight: 1,
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </span>
            )}
          </div>
          <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute }}>
            @{handle}
          </div>
          {/* University chip — long-form "Verificado · UBA" pill.
              Sits between handle and bio so it reads as part of the
              identity block. Tap is a no-op for now (could open the
              uni's profile page in a later patch). */}
          {profile.universityVerified && profile.university && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              marginTop: 8, padding: "4px 10px", borderRadius: 999,
              background: T.accentSoft, color: T.accent,
              border: `1px solid ${T.accent}33`,
              fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
              maxWidth: "100%",
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {tr("profile.uni_verified", lang, { name: socialApi.universityLabel(profile.university) })}
              </span>
            </div>
          )}

          {/* CNV idóneo chip — distinct visual (blue) from the
              university check (green) so a viewer can tell at a
              glance which credential a verified user holds. Both
              can render simultaneously when the same user is both
              uni-verified AND a registered idóneo. */}
          {profile.cnvIdoneo && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              marginTop: 8, marginLeft: profile.universityVerified && profile.university ? 6 : 0,
              padding: "4px 10px", borderRadius: 999,
              background: "#3B82F622", color: "#3B82F6",
              border: "1px solid #3B82F655",
              fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
              maxWidth: "100%",
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {tr("profile.cnv_idoneo", lang)}
              </span>
            </div>
          )}
          {profile.bio && (
            <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.text, marginTop: 8, lineHeight: 1.4 }}>
              {profile.bio}
            </div>
          )}
          {/* Member-since — small grey line under the bio. createdAt
              comes from getUserById; for the self path we have it on
              `me` too via getMe (profiles_social.created_at). Format
              is locale-aware: "abril 2026" in es-AR, "April 2026" in
              en-US. */}
          {profile.createdAt && (
            <div style={{
              fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
              marginTop: 6, display: "flex", alignItems: "center", gap: 6,
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              {tr("profile.joined", lang, {
                date: new Date(profile.createdAt).toLocaleString(
                  lang === "en" ? "en-US" : "es-AR",
                  { month: "long", year: "numeric" },
                ),
              })}
            </div>
          )}
          <div style={{ display: "flex", gap: 14, marginTop: 10, fontFamily: FONT.mono, fontSize: 12, flexWrap: "wrap" }}>
            <span style={{ color: T.text }}><b>{profile.postCount || 0}</b> <span style={{ color: T.textMute }}>posts</span></span>
            {/* Followers count — always shown now that self path
                fetches the real number. Tappable when there's at
                least one follower; opens the FollowListView overlay. */}
            <button
              onClick={() => onOpenFollowList && (profile.followersCount || 0) > 0 && onOpenFollowList(profile.id, "followers")}
              disabled={!onOpenFollowList || !(profile.followersCount > 0)}
              style={{
                padding: 0, background: "transparent", border: "none",
                color: T.text, fontFamily: FONT.mono, fontSize: 12,
                cursor: onOpenFollowList && profile.followersCount > 0 ? "pointer" : "default",
              }}
            ><b>{profile.followersCount || 0}</b> <span style={{ color: T.textMute }}>seguidores</span></button>
            <button
              onClick={() => onOpenFollowList && (profile.followingCount || 0) > 0 && onOpenFollowList(profile.id, "following")}
              disabled={!onOpenFollowList || !(profile.followingCount > 0)}
              style={{
                padding: 0, background: "transparent", border: "none",
                color: T.text, fontFamily: FONT.mono, fontSize: 12,
                cursor: onOpenFollowList && profile.followingCount > 0 ? "pointer" : "default",
              }}
            ><b>{profile.followingCount || 0}</b> <span style={{ color: T.textMute }}>siguiendo</span></button>
            {isSelf && (
              <span style={{ color: T.text }}><b>{saved.length}</b> <span style={{ color: T.textMute }}>guardados</span></span>
            )}
          </div>
        </div>
      </div>

      {/* Action row — Follow + DM only for peer view */}
      {!isSelf && (
        <div style={{ display: "flex", gap: 8, padding: "0 16px 16px" }}>
          <button
            onClick={toggleFollow}
            disabled={followBusy}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 999,
              background: profile.followedByMe ? "transparent" : T.accent,
              border: `1px solid ${profile.followedByMe ? T.border : T.accent}`,
              color: profile.followedByMe ? T.text : T.accentInk,
              fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
              cursor: followBusy ? "default" : "pointer",
              opacity: followBusy ? 0.6 : 1,
            }}
          >{profile.followedByMe ? "Siguiendo" : "Seguir"}</button>
          {onMessage && (
            <button
              onClick={() => onMessage(profile.id)}
              aria-label="Mensaje"
              style={{
                width: 42, height: 42, borderRadius: 999,
                background: "transparent", border: `1px solid ${T.border}`,
                color: T.text, cursor: "pointer", padding: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <Ico.Send size={16}/>
            </button>
          )}
        </div>
      )}

      {/* Posts / Saved toggle — self only */}
      {isSelf && (
        <div style={{
          display: "flex", gap: 4, padding: 4, margin: "0 16px",
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
        }}>
          {[
            { id: "posts", label: "Mis posts" },
            { id: "saved", label: "Guardados" },
          ].map((v) => {
            const active = v.id === view;
            return (
              <button key={v.id} onClick={() => setView(v.id)} style={{
                flex: 1, padding: "10px 0", borderRadius: 8,
                background: active ? T.bg : "transparent",
                border: active ? `1px solid ${T.border}` : "1px solid transparent",
                color: active ? T.text : T.textMute,
                fontFamily: FONT.sans, fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>{v.label}</button>
            );
          })}
        </div>
      )}

      <div style={{ margin: "16px" }}>
        {list.length === 0 ? (
          <div style={{
            padding: 30, textAlign: "center",
            color: T.textMute, fontFamily: FONT.sans, fontSize: 13,
          }}>
            {isSelf
              ? (view === "posts" ? "Todavía no publicaste nada." : "Aún no guardaste posts.")
              : "Sin posts todavía."}
          </div>
        ) : (
          list.map((p) => (
            <PostCard
              key={p.id}
              T={T}
              p={p}
              lang={lang}
              readonly
              meId={me?.id}
              onDelete={() => deletePost(p)}
              onOpenAuthor={onOpenProfile}
              onOpenThread={onOpenThread}
              onOpenTicker={onOpenTicker}
              onOpenMention={onOpenMention} onOpenHashtag={onOpenHashtag}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================
// ThreadView — drill-in conversation around a single post
// ============================================================
// Renders the parent post on top + chronological replies + a
// compose box. Subscribes to INSERTs on the replies table filtered
// to this post_id so peer responses arrive live (~500ms). Replies
// have author profiles denormalized via the relational select on
// the FK we added in samas-0.0.21 (replies_author_profile_fkey).
//
// Tap any reply author's avatar/handle → drills into their profile
// (recursive navigation, supported by the SocialPage overlay stack).
// ============================================================
function ThreadView({ T, lang = "es", post, onBack, onOpenProfile, onOpenTicker, onOpenMention, onOpenHashtag }) {
  const [replies, setReplies] = useState(null); // null = loading
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [me, setMe] = useState(null);
  // Scrollable container ref — used to auto-scroll to the bottom
  // (most recent reply) on open and on every new arriving reply.
  // Without this, opening a thread with 30 replies dumps the user
  // at the parent post and forces them to scroll down to the
  // current conversation.
  const scrollRef = React.useRef(null);

  // Initial load.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, m] = await Promise.all([
          socialApi.getReplies(post.id),
          socialApi.getMe().catch(() => null),
        ]);
        if (alive) {
          setReplies(list);
          setMe(m);
        }
      } catch (e) {
        console.error("[thread] load:", e);
        if (alive) setReplies([]);
      }
    })();
    return () => { alive = false; };
  }, [post.id]);

  // Realtime: stream new replies for this post. Most posts will
  // have a small reply count, so re-running getReplies on each
  // INSERT (instead of point-mapping the payload) is cheap and
  // means we always show denormalized authors without an extra
  // profile lookup. The optimistic prepend on send dedupes by id.
  useEffect(() => {
    let alive = true;
    let channel = null;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid || !alive) return;
      channel = supabase
        .channel(`replies-${post.id}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "replies",
          filter: `post_id=eq.${post.id}`,
        }, async (payload) => {
          if (!alive) return;
          // Skip replies the local user just sent — createReply
          // already prepended via the optimistic update path.
          if (payload?.new?.author_id === uid) return;
          try {
            const fresh = await socialApi.getReplies(post.id);
            if (alive) setReplies(fresh);
          } catch {}
        })
        .subscribe();
    })();
    return () => {
      alive = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [post.id]);

  // Auto-scroll to bottom when replies change. On first load this
  // jumps the user to the most recent reply (the active part of
  // the conversation). On subsequent inserts (own send + peer
  // realtime echo) it keeps the latest reply pinned in view.
  useEffect(() => {
    if (!scrollRef.current) return;
    if (!replies || replies.length === 0) return;
    // requestAnimationFrame so the DOM has the new ReplyRow laid
    // out before we measure scrollHeight.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [replies?.length]);

  async function send() {
    setErr(null);
    if (!body.trim()) return;
    if (busy) return;
    setBusy(true);
    const text = body;
    setBody("");
    try {
      const created = await socialApi.createReply({ postId: post.id, body: text });
      setReplies((prev) => {
        const list = prev || [];
        if (list.some((r) => r.id === created.id)) return list;
        // Replies render in chronological order; new ones go to the end.
        return [...list, created];
      });
    } catch (e) {
      setErr(e.message);
      setBody(text); // restore on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      flex: 1, minHeight: 0,
    }}>
      {/* Header — safe-area aware so the back arrow + 'Hilo'
          title don't sit under the iOS Dynamic Island. Background
          matches body (T.bg) so the safe-area zone visually merges
          with the canvas instead of looking like a tall colored
          band. Borders provide the visual separation. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "calc(env(safe-area-inset-top) + 6px) 16px 10px",
        borderBottom: `1px solid ${T.border}`,
        background: T.bg,
      }}>
        <button onClick={onBack} aria-label="Volver" style={{
          width: 32, height: 32, borderRadius: 10,
          background: T.bg, border: `1px solid ${T.border}`,
          color: T.text, cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text }}>
          Hilo
        </div>
      </div>

      {/* Scrollable: parent post + replies */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "14px 16px 16px" }}>
        {/* Parent post — same PostCard the feed uses, readonly so
            we don't re-render the action row twice. Tapping the
            author still opens their profile via onOpenAuthor. */}
        <PostCard T={T} p={post} lang={lang} readonly onOpenAuthor={onOpenProfile} onOpenTicker={onOpenTicker} onOpenMention={onOpenMention} onOpenHashtag={onOpenHashtag} />

        {/* Section divider */}
        <div style={{
          marginTop: 6, marginBottom: 8, padding: "0 4px",
          fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
          color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
        }}>
          {replies === null
            ? tr("social.thread.replies_loading", lang)
            : replies.length === 0
              ? "Sé el primero en responder."
              : `Respuestas · ${replies.length}`}
        </div>

        {/* Skeleton stack while replies load — replaces the bare
            "Cargando…" text fallback (samas-0.3.4). */}
        {replies === null && (
          <div>
            {[0, 1, 2].map((i) => <ReplyRowSkeleton key={i} T={T} />)}
          </div>
        )}

        {/* Replies list */}
        {replies && replies.length > 0 && replies.map((r) => (
          <ReplyRow
            key={r.id}
            T={T}
            r={r}
            onOpenAuthor={onOpenProfile}
            onOpenTicker={onOpenTicker}
            onOpenMention={onOpenMention} onOpenHashtag={onOpenHashtag}
          />
        ))}
      </div>

      {/* Compose bar */}
      <div style={{
        padding: "10px 12px",
        borderTop: `1px solid ${T.border}`,
        background: T.bg,
        display: "flex", alignItems: "flex-end", gap: 8,
      }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 280))}
          placeholder="Escribí tu respuesta…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          style={{
            flex: 1, resize: "none",
            padding: "9px 12px", borderRadius: 14,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.sans, fontSize: 14,
            outline: "none", minHeight: 0, maxHeight: 110,
          }}
        />
        <button
          onClick={send}
          disabled={busy || !body.trim()}
          aria-label="Responder"
          style={{
            width: 38, height: 38, borderRadius: 12,
            background: !body.trim() ? T.surface : T.accent,
            color: !body.trim() ? T.textMute : T.accentInk,
            border: !body.trim() ? `1px solid ${T.border}` : "none",
            cursor: busy || !body.trim() ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
      {err && (
        <div style={{
          padding: "0 16px 10px", fontFamily: FONT.sans, fontSize: 12,
          color: T.danger, background: T.bg,
        }}>{err}</div>
      )}
    </div>
  );
}

// ----------------------------------------------------------
// ReplyRow — compact card for a single reply inside ThreadView.
// Mirrors PostCard's author header but no action row (replies
// can't be liked / reposted in this MVP).
// ----------------------------------------------------------
function ReplyRow({ T, r, onOpenAuthor, onOpenTicker, onOpenMention, onOpenHashtag }) {
  const handle = (r.author?.handle || "@user").replace(/^@/, "");
  const { initials, color } = avatarPropsFor(r.author, T.accent);
  const displayName = r.author?.displayName || "Usuario";
  const openAuthor = (e) => {
    if (!onOpenAuthor || !r.author?.id) return;
    e.stopPropagation();
    onOpenAuthor(r.author.id);
  };
  const authorRowProps = onOpenAuthor && r.author?.id
    ? { onClick: openAuthor, style: { cursor: "pointer" } }
    : {};
  return (
    <div style={{
      padding: 12, marginBottom: 6, borderRadius: 14,
      background: T.surface, border: `1px solid ${T.border}`,
    }}>
      <div {...authorRowProps} style={{
        display: "flex", gap: 10, marginBottom: 6,
        ...authorRowProps.style,
      }}>
        <Avatar T={T} initials={initials} color={color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text }}>
              {displayName}
            </span>
            <span style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute }}>
              @{handle} · {r.atLabel || ""}
            </span>
          </div>
        </div>
      </div>
      <div style={{
        fontFamily: FONT.sans, fontSize: 13, color: T.text,
        lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>{linkifyTickers(r.body, T, onOpenTicker, onOpenMention, onOpenHashtag)}</div>
    </div>
  );
}

// ============================================================
// TickerFeedView — drill-in feed of posts mentioning a single ticker
// ============================================================
// Wired from the $TICKER chip on a trade-share post or from
// $XXX-style mentions in any post body (see linkifyTickers below).
// Reads via socialApi.getFeed({ ticker: '...' }) which the
// posts_by_ticker partial index makes O(matching) instead of a
// table scan.
//
// Realtime: subscribes to INSERTs on posts filtered to
// upper(ticker)=eq.<symbol> so when someone posts a new trade /
// mention while you're viewing the ticker feed, it slides in at
// the top within ~500ms.
// ============================================================
// ============================================================
// FollowListView — drill-in list of followers / following
// ============================================================
// Opened from ProfileView when the user taps the followers /
// siguiendo count. mode="followers" shows users that follow the
// target; mode="following" shows users the target follows. Each
// row is a UserRow with a Follow button — tapping that button
// flips the relationship with optimistic UI.
// ============================================================
function FollowListView({ T, lang = "es", profileUserId, mode, onBack, onOpenProfile, onMessageUser }) {
  const [users, setUsers] = useState(null); // null = loading
  const refresh = useCallback(async () => {
    try {
      const fn = mode === "followers" ? socialApi.getFollowersOf : socialApi.getFollowingOf;
      const list = await fn(profileUserId);
      setUsers(list || []);
    } catch (e) {
      console.error("[follow-list] load:", e);
      setUsers([]);
    }
  }, [profileUserId, mode]);
  useEffect(() => { refresh(); }, [refresh]);
  async function toggleFollow(u) {
    // Optimistic flip — drop in / out of the list immediately,
    // re-fetch on completion to lock in the truth.
    setUsers((prev) => (prev || []).map((x) => x.id === u.id ? { ...x, followedByMe: !x.followedByMe } : x));
    try {
      if (u.followedByMe) await socialApi.unfollow(u.id);
      else await socialApi.follow(u.id);
    } catch (e) {
      console.warn("[follow-list] toggle:", e);
      await refresh();
    }
  }
  const titleKey = mode === "followers"
    ? "social.follow_list.followers"
    : "social.follow_list.following";
  const emptyKey = mode === "followers"
    ? "social.follow_list.empty.followers"
    : "social.follow_list.empty.following";
  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)", height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header — back + title. Same shape as ProfileView's overlay
          header so the back-navigation feels consistent. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "calc(env(safe-area-inset-top) + 8px) 12px 10px",
        borderBottom: `1px solid ${T.border}`,
        background: T.bg, flexShrink: 0,
      }}>
        <button onClick={onBack} aria-label="Volver" style={{
          width: 32, height: 32, borderRadius: 10,
          background: T.surface, border: `1px solid ${T.border}`,
          color: T.text, cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text }}>
          {tr(titleKey, lang)}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
        {users === null ? (
          // Skeleton stack — replaces the bare "Cargando…" text
          // fallback (samas-0.3.4). 5 rows feels like the eventual
          // list silhouette.
          <div>
            {[0, 1, 2, 3, 4].map((i) => <UserRowSkeleton key={i} T={T} />)}
          </div>
        ) : users.length === 0 ? (
          <div style={{ color: T.textMute, fontFamily: FONT.sans, fontSize: 13, textAlign: "center", padding: 30 }}>
            {tr(emptyKey, lang)}
          </div>
        ) : (
          users.map((u) => (
            <UserRow
              key={u.id}
              T={T}
              user={u}
              onToggleFollow={() => toggleFollow(u)}
              onMessage={onMessageUser ? () => onMessageUser(u.id) : undefined}
              onOpen={onOpenProfile ? () => onOpenProfile(u.id) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TickerFeedView({ T, lang = "es", ticker, onBack, onOpenProfile, onOpenThread, onOpenTicker, onOpenMention, onOpenHashtag }) {
  const [posts, setPosts] = useState(null); // null = loading
  const [savedIds, setSavedIds] = useState([]);
  const symbol = String(ticker || "").toUpperCase();

  const refresh = useCallback(async () => {
    try {
      const [feed, saved] = await Promise.all([
        socialApi.getFeed({ ticker: symbol, limit: 50 }),
        socialApi.getSavedPosts().catch(() => []),
      ]);
      setPosts(feed);
      setSavedIds(saved.map((p) => p.id));
    } catch (e) {
      console.error("[ticker-feed] load:", e);
      setPosts([]);
    }
  }, [symbol]);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime: new posts on this ticker prepend live. We use the
  // raw posts INSERT subscription (already in supabase_realtime
  // since 0.0.24) and filter client-side because PostgREST's
  // realtime channel filter doesn't support upper() — incoming
  // payload.new.ticker is always uppercased by our trade-share
  // pipeline, so a direct compare works.
  useEffect(() => {
    let alive = true;
    let channel = null;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid || !alive) return;
      channel = supabase
        .channel(`ticker-feed-${symbol}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "posts",
        }, async (payload) => {
          if (!alive) return;
          const row = payload.new;
          if (!row || row.deleted_at) return;
          if (String(row.ticker || "").toUpperCase() !== symbol) return;
          try {
            const fetched = await socialApi.getPost(row.id);
            if (alive) setPosts((prev) =>
              !prev || prev.some((p) => p.id === fetched.id) ? prev : [fetched, ...prev]
            );
          } catch (e) {
            console.warn("[ticker-feed] realtime getPost failed:", e);
          }
        })
        .subscribe();
    })();
    return () => {
      alive = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [symbol]);

  async function toggleLike(p) {
    try {
      if (p.likedByMe) await socialApi.unlikePost(p.id);
      else await socialApi.likePost(p.id);
      await refresh();
    } catch {}
  }
  async function repost(p) {
    try { await socialApi.repostPost(p.id); await refresh(); } catch {}
  }
  async function toggleSave(p) {
    try {
      if (savedIds.includes(p.id)) await socialApi.unsavePost(p.id);
      else await socialApi.savePost(p.id);
      const saved = await socialApi.getSavedPosts();
      setSavedIds(saved.map((x) => x.id));
    } catch {}
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      flex: 1, minHeight: 0,
    }}>
      {/* Header — safe-area aware. Bg matches body so the
          safe-area zone visually merges with the canvas instead of
          looking like an oversized colored band. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "calc(env(safe-area-inset-top) + 6px) 16px 10px",
        borderBottom: `1px solid ${T.border}`,
        background: T.bg,
      }}>
        <button onClick={onBack} aria-label="Volver" style={{
          width: 32, height: 32, borderRadius: 10,
          background: T.bg, border: `1px solid ${T.border}`,
          color: T.text, cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div style={{
          fontFamily: FONT.mono, fontSize: 14, fontWeight: 700, color: T.accent,
          letterSpacing: 0.4,
        }}>${symbol}</div>
        <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>
          posts mencionando este ticker
        </div>
      </div>

      {/* Scrollable feed */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 110px" }}>
        {posts === null ? (
          // Post-shaped shimmer placeholders so the feed silhouette
          // is visible while the request is in flight. Three cards
          // is enough to fill the visible area on most phones
          // without overshooting into wasted DOM.
          <>
            <PostCardSkeleton T={T} />
            <PostCardSkeleton T={T} />
            <PostCardSkeleton T={T} />
          </>
        ) : posts.length === 0 ? (
          <div style={{ color: T.textMute, fontFamily: FONT.sans, fontSize: 13, textAlign: "center", padding: 30 }}>
            Sin posts sobre ${symbol} todavía. Sé el primero — andá al Broker, comprá o vendé, y compartí el trade.
          </div>
        ) : (
          posts.map((p) => (
            <PostCard
              key={p.id}
              T={T} p={p} lang={lang}
              saved={savedIds.includes(p.id)}
              onLike={() => toggleLike(p)}
              onRepost={() => repost(p)}
              onSave={() => toggleSave(p)}
              onOpenAuthor={onOpenProfile}
              onOpenThread={onOpenThread}
              onOpenTicker={onOpenTicker}
              onOpenMention={onOpenMention} onOpenHashtag={onOpenHashtag}
            />
          ))
        )}
      </div>
    </div>
  );
}

// linkifyTickers — turns $XXX patterns in a post body into
// clickable spans that drill into the ticker feed. We restrict
// to 1–6 uppercase letters/digits so day-to-day "$5" prices and
// random "$abc" don't trigger. Returns an array of React nodes
// suitable for inlining inside <div>{...}</div>.
//
// MENTIONS (samas-0.0.37)
//   The same helper now also linkifies @handle. We do tickers AND
//   mentions in a single regex so the order is preserved (a body
//   like "$NVDA gracias @manugold" interleaves correctly). Tap on
//   a mention → look up the user_id by handle and call
//   onOpenAuthor; this is async but we don't block render — if the
//   handle doesn't resolve we just no-op.
function linkifyTickers(body, T, onOpenTicker, onOpenMention, onOpenHashtag) {
  if (!body) return body;
  // Combined regex: ticker OR mention OR hashtag. Each match exposes
  // exactly one of three capture groups:
  //   m[1] = $TICKER          (1–6 uppercase alphanumerics)
  //   m[2] = @handle          (1–24 [a-zA-Z0-9_])
  //   m[3] = #hashtag         (1–32 [a-zA-Z0-9_]; allows non-ASCII
  //                            via the unicode flag below for things
  //                            like #criptoargentina or accented tags)
  const re = /\$([A-Z][A-Z0-9]{0,5})\b|@([a-zA-Z0-9_]{1,24})\b|#([\p{L}\p{N}_]{1,32})/gu;
  const out = [];
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(body))) {
    if (m.index > last) out.push(body.slice(last, m.index));
    const sym = m[1];
    const mention = m[2];
    const hashtag = m[3];
    if (sym) {
      // $TICKER → drill into ticker feed (no-op if onOpenTicker absent)
      if (onOpenTicker) {
        out.push(
          <button
            key={`tk-${i++}-${m.index}`}
            onClick={(e) => { e.stopPropagation(); onOpenTicker(sym); }}
            style={{
              display: "inline", padding: 0, margin: 0,
              background: "transparent", border: "none",
              color: T.accent, cursor: "pointer",
              font: "inherit", fontWeight: 700,
            }}
          >${sym}</button>
        );
      } else {
        // No-handler fallback: render the literal text so the post
        // still reads naturally even on surfaces that don't wire up
        // ticker drill-in.
        out.push(`$${sym}`);
      }
    } else if (mention) {
      // @handle → open the user's profile by handle. The lookup
      // runs at click time, not at render time, so we don't pay
      // a query for every post just to discover unresolved handles.
      if (onOpenMention) {
        out.push(
          <button
            key={`mn-${i++}-${m.index}`}
            onClick={(e) => { e.stopPropagation(); onOpenMention(mention); }}
            style={{
              display: "inline", padding: 0, margin: 0,
              background: "transparent", border: "none",
              color: T.accent, cursor: "pointer",
              font: "inherit", fontWeight: 700,
            }}
          >@{mention}</button>
        );
      } else {
        out.push(`@${mention}`);
      }
    } else if (hashtag) {
      // #hashtag → open search prefilled with #hashtag. We don't
      // (yet) have a dedicated hashtag index in Postgres, so the
      // search view runs a body-substring match. Free-text approach
      // is deliberate — the v2 prototype optimizes for low schema
      // commitment over query speed.
      if (onOpenHashtag) {
        out.push(
          <button
            key={`ht-${i++}-${m.index}`}
            onClick={(e) => { e.stopPropagation(); onOpenHashtag(hashtag); }}
            style={{
              display: "inline", padding: 0, margin: 0,
              background: "transparent", border: "none",
              color: T.accent, cursor: "pointer",
              font: "inherit", fontWeight: 700,
            }}
          >#{hashtag}</button>
        );
      } else {
        out.push(`#${hashtag}`);
      }
    }
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

// resolveHandleToUserId — look up a profiles_social row by handle
// (case-insensitive), return its user_id or null. Cached in-memory
// so repeated mentions of the same handle inside a single session
// only hit the network once. This is a module-level cache because
// every PostCard / DM-bubble that opens a mention should benefit.
const HANDLE_CACHE = new Map();
async function resolveHandleToUserId(handle) {
  const key = String(handle || "").toLowerCase().replace(/^@/, "");
  if (!key) return null;
  if (HANDLE_CACHE.has(key)) return HANDLE_CACHE.get(key);
  try {
    // Try with and without leading @ — historical rows have either.
    const { data } = await supabase
      .from("profiles_social")
      .select("user_id, handle")
      .or(`handle.ilike.@${key},handle.ilike.${key}`)
      .limit(1)
      .maybeSingle();
    const userId = data?.user_id || null;
    HANDLE_CACHE.set(key, userId);
    return userId;
  } catch (e) {
    console.warn("[social] handle lookup failed:", handle, e?.message);
    return null;
  }
}

// ============================================================
// PortfolioPostCard (samas-0.0.79) — render a snapshot post.
// ============================================================
// payload shape ({ totalUsd, gainPct, capturedAt, rows: [...] })
// is generated client-side by sharePortfolio() at compose time
// and stored verbatim on posts.payload (jsonb). This component
// renders both:
//   1. The compose-attachment preview (above the textarea)
//   2. The feed post body when post.kind === 'portfolio'
//
// It's deliberately read-only — there's no editable text inside
// the card. That kills the "I'll just edit my numbers before I
// post" path that the previous text-paste implementation allowed.
//
// onRemove is optional; when provided we render a × button (used
// by the compose preview). Feed posts pass undefined and the X
// is omitted.
function PortfolioPostCard({ T, payload, lang = "es", onRemove, onOpenTicker }) {
  if (!payload) return null;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  // Privacy: never render payload.totalUsd or per-row qty. samas-0.3.5
  // dropped totalUsd from new payloads; older posts still have it on
  // the row but we ignore it here. Allocation-only view from now on.
  const gain = Number(payload.gainPct || 0);
  const gainColor = gain >= 0 ? T.accent : T.danger;
  const gainBg = gain >= 0 ? T.accentSoft : T.dangerSoft;
  const fmtPct = (n) => `${n >= 0 ? "+" : ""}${(n || 0).toFixed(1)}%`;
  return (
    <div style={{
      borderRadius: 16, overflow: "hidden",
      background: T.bg, border: `1.5px solid ${T.accent}`,
      // Subtle accent-tinted gradient header so the card reads
      // visually distinct from a regular text post at a glance.
      position: "relative",
    }}>
      <div style={{
        padding: "12px 14px",
        background: `linear-gradient(135deg, ${T.accentSoft}, transparent 70%)`,
        borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        {/* Pie-chart glyph */}
        <div style={{
          width: 28, height: 28, borderRadius: 999,
          background: T.accent, color: "#06180c",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>
            <path d="M22 12A10 10 0 0 0 12 2v10z"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
            color: T.accent, letterSpacing: 0.6, textTransform: "uppercase" }}>
            {tr("social.portfolio_card.title", lang)}
          </div>
          {/* Privacy: total cash value is not shared. We surface the
              composition (rows below) + the value-weighted gain
              chip on the right. samas-0.3.5. */}
          <div style={{
            fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
            marginTop: 4, lineHeight: 1.35,
          }}>
            {tr("social.portfolio_card.allocation_subtitle", lang, { n: rows.length })}
          </div>
        </div>
        <div style={{
          padding: "4px 10px", borderRadius: 999,
          background: gainBg, color: gainColor,
          fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
        }}>
          {fmtPct(gain)}
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            aria-label={tr("social.compose.remove_portfolio", lang)}
            style={{
              width: 24, height: 24, borderRadius: 12,
              background: T.surface, border: `1px solid ${T.border}`,
              color: T.textMute, fontFamily: FONT.sans, fontSize: 13,
              lineHeight: 1, cursor: "pointer", padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >×</button>
        )}
      </div>
      {/* Allocation bar (samas-0.3.8) — single horizontal stacked
          bar visualizing the share-of-book per ticker. Reinforces
          the privacy framing: composition matters, dollar amounts
          don't. Each segment width = pctOfBook for that ticker.
          Hidden when no rows have pctOfBook (legacy posts). */}
      {rows.length > 0 && rows.some((r) => r.pctOfBook != null) && (
        <div style={{ padding: "10px 14px 0" }}>
          <div style={{
            display: "flex", height: 8, borderRadius: 999, overflow: "hidden",
            background: T.bg, border: `1px solid ${T.border}`,
          }}>
            {rows.map((r, i) => {
              const w = r.pctOfBook != null ? Math.max(0, Number(r.pctOfBook)) : 0;
              if (w <= 0) return null;
              // Cycle a small accent palette so adjacent segments
              // read distinctly. Order: accent → softer accent →
              // amber → tertiary green → danger-tinted → muted.
              // Hand-picked so the bar reads as "composition", not
              // "performance" (we don't want viewers reading red as
              // "loss" here — the bar shows ALLOCATION, not gain).
              const palette = [
                T.accent,
                "#7DD3A0",   // softer green
                "#F59E0B",   // amber
                "#60A5FA",   // blue
                "#A78BFA",   // violet
                T.textMute,  // muted catch-all for tail
              ];
              const color = palette[i % palette.length];
              return (
                <div
                  key={r.ticker}
                  title={`${r.ticker} · ${w.toFixed(1)}%`}
                  style={{
                    flex: `${w} 0 0`,
                    minWidth: w >= 1 ? 4 : 0,
                    background: color,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Holdings rows. Each row: ticker chip · allocation % · day gain%.
          The ticker is tappable when onOpenTicker is provided so a
          reader can drill into that asset's feed. The compose
          preview passes onOpenTicker=undefined → non-interactive. */}
      <div style={{ padding: "8px 14px 12px" }}>
        {rows.length === 0 ? (
          <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, padding: "6px 0" }}>
            {tr("social.portfolio_card.empty", lang)}
          </div>
        ) : rows.map((r) => {
          const dayPct = Number(r.gainPct || 0);
          const dayColor = dayPct >= 0 ? T.accent : T.danger;
          // Allocation %: prefer pctOfBook from the new payload shape
          // (samas-0.3.5). Old payloads with `qty` instead — we no
          // longer render qty for privacy; fall back to "—" if no
          // pctOfBook (= legacy post pre-fix).
          const allocPct = r.pctOfBook != null ? Number(r.pctOfBook) : null;
          return (
            <div key={r.ticker} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 0",
              borderBottom: `1px solid ${T.border}`,
            }}>
              <button
                onClick={(e) => {
                  if (!onOpenTicker) return;
                  e.stopPropagation();
                  onOpenTicker(r.ticker);
                }}
                disabled={!onOpenTicker}
                style={{
                  padding: "3px 8px", borderRadius: 6,
                  background: T.surface, border: `1px solid ${T.border}`,
                  color: T.text, fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
                  letterSpacing: 0.4, cursor: onOpenTicker ? "pointer" : "default",
                }}
              >${r.ticker}</button>
              {/* Allocation chip — what fraction of the book this
                  ticker is. Privacy-safe (no $ amount, no qty). */}
              <div style={{
                fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
                color: T.text,
                padding: "2px 8px", borderRadius: 999,
                background: T.surface, border: `1px solid ${T.border}`,
              }}>
                {allocPct == null ? "—" : `${allocPct.toFixed(1)}%`}
              </div>
              <div style={{
                marginLeft: "auto",
                fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: dayColor,
              }}>
                {fmtPct(dayPct)}
              </div>
            </div>
          );
        })}
        <div style={{
          marginTop: 8, fontFamily: FONT.sans, fontSize: 10,
          color: T.textMute, letterSpacing: 0.3, textAlign: "right",
        }}>
          {tr("social.portfolio_card.locked_label", lang)}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PostCard — used by Feed + Profile
// ============================================================
// SWIPE-LEFT-TO-DELETE (samas-0.0.36)
//   When the post is owned by the caller (meId === p.author.id) and
//   onDelete is provided, the card supports an iOS-style swipe-left
//   gesture that reveals a red "Borrar" action. Tap → confirm modal
//   → onDelete. Tap on the still-visible card slice (or swipe right)
//   snaps it back. Implementation notes:
//     - Direction lock on first move (>6px): horizontal vs vertical.
//       Vertical wins → release the gesture so the page can scroll
//       normally. Horizontal wins → we own the gesture; clamp dx to
//       [-ACTION_WIDTH * 1.3, 0] so right-swipe is a no-op.
//     - movedRef gates the click handlers below — if the user just
//       swiped, the touchend-triggered click on the body region is
//       suppressed so we don't accidentally open the thread.
// ============================================================
const ACTION_WIDTH = 96;
const SNAP_THRESHOLD = 44;

function PostCard({ T, p, lang = "es", saved, meId, onLike, onRepost, onSave, onDelete, readonly, onOpenAuthor, onOpenThread, onOpenTicker, onOpenMention, onOpenHashtag }) {
  const handle = (p.author?.handle || "@user").replace(/^@/, "");
  // avatarPropsFor handles the displayName-missing case AND falls
  // back to a deterministic color so two posters in the same feed
  // never share a tint by accident.
  const { initials, color } = avatarPropsFor(p.author, T.accent);
  const displayName = p.author?.displayName || "Usuario";

  // Swipe-to-delete machinery. ownPost gates the whole feature; if
  // the post isn't ours we render the same JSX without the wrapper
  // listeners (no perf hit, no behavior change).
  const ownPost = !!(meId && p.author?.id === meId && onDelete);
  const [dx, setDx] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [animating, setAnimating] = useState(true);
  // Image lightbox state — when set, a fullscreen overlay renders
  // the image at native size inside this PostCard. Held local so a
  // post-with-image elsewhere doesn't fight for the same overlay.
  const [lightbox, setLightbox] = useState(null);
  const startRef = React.useRef(null);   // {x, y}
  const movedRef = React.useRef(false);  // moved past click threshold
  const dirRef   = React.useRef(null);   // 'h' | 'v' — locked after first 6px

  function onTouchStart(e) {
    if (!ownPost || confirming) return;
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
    movedRef.current = false;
    dirRef.current = null;
    setAnimating(false); // disable transition while finger drags
  }
  function onTouchMove(e) {
    if (!ownPost || !startRef.current || confirming) return;
    const t = e.touches[0];
    const dxCur = t.clientX - startRef.current.x;
    const dyCur = t.clientY - startRef.current.y;
    if (!dirRef.current) {
      if (Math.abs(dxCur) < 6 && Math.abs(dyCur) < 6) return;
      dirRef.current = Math.abs(dxCur) > Math.abs(dyCur) ? "h" : "v";
    }
    if (dirRef.current === "v") return;            // page-scroll path
    // Clamp to [-ACTION_WIDTH*1.3, 0] — no rightward overshoot from
    // the rest position; some leftward overshoot for elasticity.
    const clamped = Math.min(0, Math.max(dxCur, -ACTION_WIDTH * 1.3));
    setDx(clamped);
    movedRef.current = true;
  }
  function onTouchEnd() {
    if (!ownPost) return;
    setAnimating(true);
    if (dirRef.current === "h") {
      if (dx <= -SNAP_THRESHOLD) setDx(-ACTION_WIDTH);
      else setDx(0);
    }
    startRef.current = null;
  }
  // Wrap the existing click handlers so a just-completed swipe
  // doesn't fire a stray click (which would open the thread).
  function withSwipeGuard(fn) {
    if (!fn) return undefined;
    return (e) => {
      if (movedRef.current) {
        movedRef.current = false;
        e?.preventDefault?.();
        e?.stopPropagation?.();
        return;
      }
      fn(e);
    };
  }

  async function confirmDelete() {
    setConfirming(false);
    setDx(0);
    if (onDelete) await onDelete();
  }

  // Tap-into-profile handler. We bind it to the avatar/name area
  // so taps on the body or action buttons aren't hijacked.
  const openAuthor = (e) => {
    if (!onOpenAuthor || !p.author?.id) return;
    e.stopPropagation();
    onOpenAuthor(p.author.id);
  };
  const authorRowProps = onOpenAuthor && p.author?.id
    ? { onClick: withSwipeGuard(openAuthor), style: { cursor: "pointer" } }
    : {};

  // Inner card content — used both as the standalone return for
  // posts the user doesn't own AND as the foreground layer of the
  // swipe-wrapper for posts they do. NOTE: marginBottom is owned by
  // the wrapper, NOT the card itself, so owned + non-owned posts
  // have the same vertical rhythm. Before 0.0.53 the card had its
  // own marginBottom: 8 which stacked with the swipe wrapper's
  // marginBottom: 8 for owned posts → 16px gap on owned, 8px on
  // non-owned, plus the red action panel anchored to the wrapper
  // height extended past the visible card edge.
  const cardInner = (
    <div style={{
      padding: 14, borderRadius: 18,
      background: T.surface, border: `1px solid ${T.border}`,
      // When swiping, suppress text selection callouts that iOS
      // pops up on long-press — they fight with the gesture.
      WebkitUserSelect: ownPost ? "none" : "auto",
      WebkitTouchCallout: ownPost ? "none" : "default",
    }}>
      <div {...authorRowProps} style={{ display: "flex", gap: 10, marginBottom: 8, ...authorRowProps.style }}>
        <Avatar T={T} initials={initials} color={color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text }}>
              {displayName}
            </span>
            <span style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>
              @{handle} · {p.atLabel || ""}
            </span>
          </div>
        </div>
      </div>
      {/* Body + trade card live inside one clickable region that
          opens the thread when tapped. Interactive children inside
          (the $TICKER linkified spans, the trade-card ticker chip)
          stop propagation so they keep their own behaviors. The
          author row above and the action row below are siblings,
          not descendants of this region — they don't trigger thread
          open. */}
      <div
        onClick={onOpenThread ? withSwipeGuard(() => onOpenThread(p)) : undefined}
        style={{ cursor: onOpenThread ? "pointer" : "default" }}
      >
        {/* Body — for portfolio posts the body is OPTIONAL commentary
            (can be empty) so we only render the text block when there's
            something to show. For text posts body is always present and
            non-empty (CHECK constraint). */}
        {p.body && p.body.trim() && (
          <div style={{
            fontFamily: FONT.sans, fontSize: 14, color: T.text,
            lineHeight: 1.5, whiteSpace: "pre-wrap", marginBottom: 10,
          }}>{linkifyTickers(p.body, T, onOpenTicker, onOpenMention, onOpenHashtag)}</div>
        )}

        {/* Portfolio card body (samas-0.0.79). Read-only — the values
            were generated by sharePortfolio() at compose time from
            the broker API and immutably stored on posts.payload. */}
        {p.kind === "portfolio" && p.portfolio && (
          <div style={{ marginBottom: 10 }} onClick={(e) => e.stopPropagation()}>
            <PortfolioPostCard T={T} payload={p.portfolio} lang={lang} onOpenTicker={onOpenTicker} />
          </div>
        )}

        {/* Image attachment — rendered between body and trade card.
            object-fit: cover keeps tall portraits and wide screenshots
            both readable inside the same max-height card. Tap on the
            image opens the lightbox (handler stops propagation so it
            doesn't bubble up to the parent's onOpenThread). */}
        {p.imageUrl && (
          <div
            onClick={(e) => { e.stopPropagation(); setLightbox(p.imageUrl); }}
            style={{
              marginBottom: 10, borderRadius: 14, overflow: "hidden",
              border: `1px solid ${T.border}`, background: T.bg,
              maxHeight: 360, cursor: "zoom-in",
            }}
          >
            <img
              src={p.imageUrl}
              alt={tr("social.post.photo", lang)}
              loading="lazy"
              style={{
                display: "block", width: "100%", maxHeight: 360,
                objectFit: "cover",
              }}
            />
          </div>
        )}

        {p.trade && (
          // Privacy: trade-share cards no longer show qty or price
          // (samas-0.3.6). Same rule as portfolio shares — strangers
          // see WHAT side + WHICH ticker, but not how many units or
          // at what fill price. Brag the action, not the size.
          <div style={{
            padding: "10px 12px", borderRadius: 12, marginBottom: 10,
            background: T.bg, border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{
              padding: "3px 8px", borderRadius: 6,
              background: p.trade.side === "buy" ? T.accentSoft : T.dangerSoft,
              color: p.trade.side === "buy" ? T.accent : T.danger,
              fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
            }}>{p.trade.side === "buy" ? "COMPRA" : "VENTA"}</div>
            {/* Ticker chip — clickable when onOpenTicker is provided.
                Drills into the ticker feed for that symbol. */}
            <button
              onClick={(e) => { e.stopPropagation(); if (onOpenTicker) onOpenTicker(p.trade.ticker); }}
              disabled={!onOpenTicker}
              style={{
                padding: 0, background: "transparent", border: "none",
                fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text,
                cursor: onOpenTicker ? "pointer" : "default",
              }}
            >
              ${p.trade.ticker}
            </button>
            <div style={{
              marginLeft: "auto",
              fontFamily: FONT.sans, fontSize: 10, color: T.textMute,
              letterSpacing: 0.4, textTransform: "uppercase",
            }}>
              {tr("social.trade_card.via_samas", lang)}
            </div>
          </div>
        )}
      </div>

      {!readonly && (
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <ActionBtn T={T}
            icon={<Ico.Heart size={16} {...(p.likedByMe ? { fill: "currentColor" } : {})}/>}
            count={p.likes} active={p.likedByMe} activeColor={T.danger} onClick={onLike} />
          <ActionBtn T={T}
            icon={<Ico.Repeat size={16}/>} count={p.reposts}
            active={p.repostedByMe} activeColor={T.accent} onClick={onRepost} />
          <ActionBtn T={T}
            icon={<Ico.Comment size={16}/>} count={p.comments}
            onClick={onOpenThread ? () => onOpenThread(p) : undefined} />
          <ActionBtn T={T}
            icon={<Ico.Bookmark size={16} {...(saved ? { fill: "currentColor" } : {})}/>}
            active={saved} activeColor={T.accent} onClick={onSave} />
        </div>
      )}
    </div>
  );

  // Lightbox overlay — fixed position covers the whole screen.
  // Defined once so both the non-owner and owner branches can render
  // it. A null lightbox renders nothing (no DOM node, no z-index war).
  const lightboxJsx = lightbox && (
    <div
      onClick={() => setLightbox(null)}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.92)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, cursor: "zoom-out",
        // Animate in — quick fade so the transition feels
        // "tap → fullscreen" instead of "tap → nothing → fullscreen".
        animation: "samas-lightbox-in 140ms ease",
      }}
    >
      <style>{`
        @keyframes samas-lightbox-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
      {/* Close X — top-right, larger touch target than visual size. */}
      <button
        onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
        aria-label="Cerrar"
        style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top) + 14px)", right: 14,
          width: 38, height: 38, borderRadius: 999,
          background: "rgba(255,255,255,0.16)", color: "#fff",
          border: "none", cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <img
        src={lightbox}
        alt={tr("social.post.photo", lang)}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "100%", maxHeight: "100%",
          objectFit: "contain", borderRadius: 8,
          boxShadow: "0 30px 60px rgba(0,0,0,0.6)",
        }}
      />
    </div>
  );

  // No swipe wrapper for posts the user doesn't own — render the
  // raw card with the standard 8px gap below. The lightbox is
  // appended unconditionally so image taps work on every PostCard
  // regardless of ownership.
  if (!ownPost) {
    return (
      <>
        <div style={{ marginBottom: 8 }}>{cardInner}</div>
        {lightboxJsx}
      </>
    );
  }

  // Owned post → wrap in a position:relative container with a red
  // delete panel pinned to the right and the card translated by dx.
  // The wrapper owns the 8px gap so owned + non-owned posts match.
  return (
    <div style={{ position: "relative", marginBottom: 8 }}>
      {/* Red delete action panel — fills the ENTIRE row behind the
          card (inset: 0) with the same borderRadius as the card. The
          old fix had the panel pinned to a fixed 96px on the right,
          but the swipe clamp goes to -125px (1.3 × ACTION_WIDTH) so
          the card could slide past the panel's left edge and expose
          the page background between them. By making the panel
          identical in size to the card, the panel always fills the
          space the card vacates, regardless of overshoot. The
          delete button stays visually right-anchored via
          justifyContent: flex-end + paddingRight. */}
      <div style={{
        position: "absolute", inset: 0,
        borderRadius: 18,
        background: T.danger,
        display: "flex", alignItems: "center", justifyContent: "flex-end",
        paddingRight: 28,
        // Hide the panel entirely when at rest so its rounded corner
        // doesn't peek out from under the card border.
        opacity: dx < -2 ? 1 : 0,
        transition: animating ? "opacity 0.18s ease" : "none",
      }}>
        <button
          onClick={() => setConfirming(true)}
          aria-label={tr("social.post.delete", lang)}
          style={{
            background: "transparent", border: "none",
            color: "#fff", fontFamily: FONT.sans, fontWeight: 800, fontSize: 13,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            padding: 8, cursor: "pointer",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
          {tr("social.post.delete", lang)}
        </button>
      </div>

      {/* Foreground card — translated by swipe dx. cardInner no longer
          carries its own marginBottom (the wrapper owns it), so this
          div is just the touch + transform layer. */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          transform: `translateX(${dx}px)`,
          transition: animating ? "transform 0.18s ease" : "none",
          // Touch action: pan-y allows vertical scroll, blocks horizontal
          // browser gestures (back-swipe, etc) so we get a clean signal.
          touchAction: "pan-y",
        }}
      >
        {cardInner}
      </div>

      {/* Confirm modal — small inline overlay, dismissable by tap on
          backdrop or Cancel. We don't use window.confirm() because
          native dialogs in WKWebView under Capacitor look out of
          place and are slow to render. */}
      {confirming && (
        <div
          onClick={() => setConfirming(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 28,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 320, width: "100%",
              background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: 18, padding: "20px 18px",
            }}
          >
            <div style={{
              fontFamily: FONT.display, fontSize: 16, fontWeight: 700,
              color: T.text, marginBottom: 14, textAlign: "center",
            }}>{tr("social.post.delete_confirm", lang)}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setConfirming(false)}
                style={{
                  flex: 1, padding: "10px 14px", borderRadius: 12,
                  background: "transparent", border: `1px solid ${T.border}`,
                  color: T.text, fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
                  cursor: "pointer",
                }}
              >{tr("social.post.delete_no", lang)}</button>
              <button
                onClick={confirmDelete}
                style={{
                  flex: 1, padding: "10px 14px", borderRadius: 12,
                  background: T.danger, border: "none",
                  color: "#fff", fontFamily: FONT.sans, fontSize: 13, fontWeight: 800,
                  cursor: "pointer",
                }}
              >{tr("social.post.delete_yes", lang)}</button>
            </div>
          </div>
        </div>
      )}
      {lightboxJsx}
    </div>
  );
}

// ActionBtn — heart / repost / comment / bookmark button under each
// post. Three feel-improvements layered in 0.0.55:
//   1. Light haptic on every tap so the button feels "real" on
//      device. Fire-and-forget — never blocks the click handler.
//   2. Bump animation when `active` flips false → true (i.e. user
//      just liked / reposted / saved). The icon span re-mounts on
//      bumpKey change which re-runs the samas-action-bump keyframe
//      defined globally in Shell.jsx.
//   3. The universal button:active scale-down rule from Shell.jsx
//      already covers the press-down feel — nothing extra here.
function ActionBtn({ T, icon, count, active, activeColor, onClick }) {
  const [bumpKey, setBumpKey] = useState(0);
  const prevActiveRef = useRef(active);
  useEffect(() => {
    if (!prevActiveRef.current && active) {
      setBumpKey((k) => k + 1);
    }
    prevActiveRef.current = active;
  }, [active]);

  const handleClick = onClick ? () => {
    hapticNative("tap").catch(() => {});
    onClick();
  } : undefined;

  return (
    <button onClick={handleClick} style={{
      display: "flex", alignItems: "center", gap: 6,
      background: "transparent", border: "none", padding: 4,
      cursor: onClick ? "pointer" : "default",
      color: active ? activeColor : T.textMute,
      fontFamily: FONT.mono, fontSize: 12, fontWeight: 600,
    }}>
      <span
        key={bumpKey}
        style={{
          display: "inline-flex",
          // Only animate AFTER the first user toggle (bumpKey > 0).
          // bumpKey === 0 is the initial mount; running the bump
          // keyframe there would pop every heart on page load.
          ...(bumpKey > 0
            ? { animation: "samas-action-bump 350ms cubic-bezier(.34,1.56,.64,1)" }
            : {}),
        }}
      >
        {icon}
      </span>
      {count != null && <span>{count || 0}</span>}
    </button>
  );
}

function Avatar({ T, initials, color, size = 38 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 12, flexShrink: 0,
      background: color, color: T.accentInk,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: FONT.display, fontSize: Math.round(size * 0.36), fontWeight: 700,
    }}>{initials}</div>
  );
}
