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

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { FONT } from "./theme.js";
import { Ico } from "./icons.jsx";
import { social as socialApi, messages as messagesApi } from "./api/index.js";
import { useEdgeSwipeBack } from "./useEdgeSwipeBack.js";
import { usePullToRefresh } from "./usePullToRefresh.jsx";
import { setRefreshHandler, callRefreshFor } from "./refreshRegistry.js";
import { avatarPropsFor } from "./shared.jsx";
import { supabase } from "../lib/supabase.js";
import { t as tr } from "../lib/i18n.js";

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
  const navBottom = isNativeApp
    ? "calc(env(safe-area-inset-bottom) + 12px)"
    : 12;

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
    setTab("messages");
  }

  // iOS-style swipe-from-left-edge back to the wallet shell.
  const { bind: swipeBind, style: swipeStyle } = useEdgeSwipeBack(onBack);
  // Pull-to-refresh — calls the active sub-tab's registered handler.
  const { bind: ptrBind, indicator: ptrIndicator } = usePullToRefresh(
    () => callRefreshFor(`social-${tab}`)
  );

  return (
    <div {...swipeBind} style={{
      position: "absolute", inset: 0,
      background: T.bg, color: T.text,
      overflow: "hidden",
      display: "flex", flexDirection: "column",
      fontFamily: FONT.sans,
      animation: "samas-shell-in 240ms cubic-bezier(.2,.8,.2,1)",
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
        {tab === "feed"     && <FeedView T={T} lang={lang} user={user} />}
        {tab === "search"   && <SearchView T={T} lang={lang} user={user} onMessageUser={openDmWith} />}
        {tab === "messages" && <MessagesView T={T} lang={lang} user={user} />}
        {tab === "profile"  && <ProfileView T={T} lang={lang} user={user} />}
      </div>

      {/* Bottom nav */}
      <SocialNav T={T} tab={tab} setTab={setTab} bottomInset={navBottom} lang={lang} />
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
const FEED_TABS = [
  { id: "following", key: "social.tab.following" },
  { id: "for_you",   key: "social.tab.for_you"  },
  { id: "trades",    key: "social.tab.trades"    },
];

function FeedView({ T, lang = "es", user = null }) {
  const [tab, setTab] = useState("for_you");
  const [posts, setPosts] = useState([]);
  const [me, setMe] = useState(null);
  const [savedIds, setSavedIds] = useState([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Trade attachment: when the Broker hands off a filled trade, we
  // prefill `body` with a default sentence and `pendingTrade` with
  // the jsonb-shaped payload. publish() forwards both to createPost
  // so the post lands with a trade card. The user can clear the
  // attachment with the X button (body stays).
  const [pendingTrade, setPendingTrade] = useState(null);

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
      if (!trade || !trade.ticker || !trade.qty || !trade.price) return;
      setPendingTrade(trade);
      const tplKey = trade.side === "buy"
        ? "social.compose.trade_buy_template"
        : "social.compose.trade_sell_template";
      const priceStr = `US$${Number(trade.price).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
      setBody(tr(tplKey, lang, {
        qty: String(trade.qty),
        ticker: String(trade.ticker),
        price: priceStr,
      }));
    } catch (e) {
      console.warn("[social] trade prefill failed:", e);
    }
  }, [lang]);

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
        .subscribe();
    })();
    return () => {
      alive = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [tab]);

  async function publish() {
    setErr(null);
    if (!body.trim()) { setErr("El post está vacío."); return; }
    setBusy(true);
    try {
      await socialApi.createPost({ body, trade: pendingTrade || undefined });
      setBody("");
      setPendingTrade(null);
      await refresh();
    } catch (e) { setErr(e.message); }
    setBusy(false);
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

  return (
    <div style={{ paddingBottom: 110 }}>
      {/* Top tabs */}
      <div style={{
        display: "flex", gap: 4, padding: 4, margin: "16px 16px 0",
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 12,
      }}>
        {FEED_TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "10px 0", borderRadius: 8,
              background: active ? T.bg : "transparent",
              border: active ? `1px solid ${T.border}` : "1px solid transparent",
              color: active ? T.text : T.textMute,
              fontFamily: FONT.sans, fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>{tr(t.key, lang)}</button>
          );
        })}
      </div>

      {/* Compose */}
      <div style={{
        margin: "16px", padding: 14, borderRadius: 18,
        background: T.surface, border: `1px solid ${T.border}`,
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
          <div style={{ flex: 1, minWidth: 0 }}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, 280))}
              placeholder={tr("social.compose_ph", lang)}
              rows={3}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "transparent", border: "none", outline: "none",
                color: T.text, fontFamily: FONT.sans, fontSize: 14,
                resize: "none",
              }}
            />
            {/* Trade-card preview — shown when the Broker handed off
                a filled trade. Same visual as the published trade
                card on a feed item; an X button removes the
                attachment without clearing the body text. */}
            {pendingTrade && (
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
                  {pendingTrade.qty} {pendingTrade.ticker}
                </div>
                <div style={{ fontFamily: FONT.mono, fontSize: 12, color: T.textMute, marginLeft: "auto" }}>
                  US${Number(pendingTrade.price).toLocaleString("es-AR")}
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.textMute }}>
                {body.length}/280
              </span>
              <button
                onClick={publish}
                disabled={busy || !body.trim()}
                style={{
                  padding: "8px 16px", borderRadius: 999,
                  background: !body.trim() ? T.surface : T.accent,
                  color: !body.trim() ? T.textMute : T.accentInk,
                  fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
                  border: !body.trim() ? `1px solid ${T.border}` : "none",
                  cursor: busy || !body.trim() ? "default" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >{busy ? "…" : tr("social.publish", lang)}</button>
            </div>
            {err && <div style={{ marginTop: 8, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}
          </div>
        </div>
      </div>

      {/* Feed */}
      <div style={{ margin: "0 16px" }}>
        {posts.length === 0 ? (
          <div style={{
            padding: 30, textAlign: "center",
            color: T.textMute, fontFamily: FONT.sans, fontSize: 13,
          }}>
            {tab === "following"
              ? "Seguí gente para ver sus posts acá."
              : "Nada por acá todavía."}
          </div>
        ) : (
          posts.map((p) => (
            <PostCard
              key={p.id}
              T={T} p={p}
              saved={savedIds.includes(p.id)}
              onLike={() => toggleLike(p)}
              onRepost={() => repost(p)}
              onSave={() => toggleSave(p)}
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
function SearchView({ T, lang = "es", user = null, onMessageUser }) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setUsers(await socialApi.getUsers({ query })); }
    catch {} finally { setLoading(false); }
  }, [query]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => setRefreshHandler("social-search", refresh), [refresh]);

  async function toggleFollow(u) {
    try {
      if (u.followedByMe) await socialApi.unfollow(u.id);
      else await socialApi.follow(u.id);
      await refresh();
    } catch {}
  }

  return (
    <div style={{ paddingBottom: 110 }}>
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
            placeholder="Buscar por usuario o nombre"
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

      <div style={{ margin: "0 16px" }}>
        {loading ? null : users.length === 0 ? (
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
            />
          ))
        )}
      </div>
    </div>
  );
}

function UserRow({ T, user, onToggleFollow, onMessage }) {
  const handle = user.handle.replace(/^@/, "");
  const { initials, color } = avatarPropsFor(user, T.accent);
  return (
    <div style={{
      padding: "12px 4px", display: "flex", alignItems: "center", gap: 12,
      borderBottom: `1px solid ${T.border}`,
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
function MessagesView({ T, lang = "es", user = null }) {
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
      />
    );
  }

  if (threads === null) {
    return (
      <div style={{ padding: 24, color: T.textMute, fontFamily: FONT.sans, fontSize: 13 }}>
        Cargando…
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div style={{
        padding: 32, paddingBottom: 110,
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
    <div style={{ paddingBottom: 110 }}>
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
// Subscribes to INSERTs on dm_messages for THIS thread so peer
// replies stream in live. Marks unread-as-read on open.
function ConversationView({ T, lang = "es", thread, onBack }) {
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
      paddingBottom: 110,
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
      </div>

      {/* Message list */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: "auto",
        padding: "14px 16px",
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        {messages === null ? (
          <div style={{ color: T.textMute, fontFamily: FONT.sans, fontSize: 12, textAlign: "center" }}>Cargando…</div>
        ) : messages.length === 0 ? (
          <div style={{ color: T.textMute, fontFamily: FONT.sans, fontSize: 13, textAlign: "center", padding: 30 }}>
            Empezá la conversación.
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} style={{
              alignSelf: m.fromMe ? "flex-end" : "flex-start",
              maxWidth: "78%",
              padding: "8px 12px", borderRadius: 14,
              background: m.fromMe ? T.accent : T.surface,
              color: m.fromMe ? T.accentInk : T.text,
              border: m.fromMe ? "none" : `1px solid ${T.border}`,
              fontFamily: FONT.sans, fontSize: 14, lineHeight: 1.4,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {m.body}
            </div>
          ))
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
// PROFILE — your stuff: posts, saved, follow stats
// ============================================================
function ProfileView({ T, lang = "es", user = null }) {
  const [me, setMe] = useState(null);
  const [myPosts, setMyPosts] = useState([]);
  const [following, setFollowing] = useState([]);
  const [saved, setSaved] = useState([]);
  const [view, setView] = useState("posts"); // "posts" | "saved"

  useEffect(() => {
    let alive = true;
    Promise.all([
      socialApi.getMe(),
      socialApi.getFeed({ tab: "for_you", limit: 60 }),
      socialApi.getFollowing(),
      socialApi.getSavedPosts(),
    ]).then(([m, feed, follows, sav]) => {
      if (!alive) return;
      setMe(m);
      setMyPosts(feed.filter((p) => p.author?.id === m.id));
      setFollowing(follows);
      setSaved(sav);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!me) return null;
  // avatarPropsFor centralizes the "what initials, what color" rule.
  // Pass me first (preferred — has display_name + avatar_color from
  // the social profile); the auth user is a fallback only if me is
  // somehow missing fields.
  const { initials, color } = avatarPropsFor(
    { ...me, email: user?.email },
    T.accent,
  );
  const handle = me.handle.replace(/^@/, "");
  const list = view === "posts" ? myPosts : saved;

  return (
    <div style={{ paddingBottom: 110 }}>
      {/* Profile header */}
      <div style={{ padding: "20px 16px 16px", display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar T={T} initials={initials} color={color} size={64}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text }}>
              {me.displayName}
            </span>
            {me.verified && <span style={{ color: T.accent, fontFamily: FONT.mono, fontSize: 13, fontWeight: 800 }}>✓</span>}
          </div>
          <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute }}>
            @{handle}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 8, fontFamily: FONT.mono, fontSize: 12 }}>
            <span style={{ color: T.text }}><b>{myPosts.length}</b> <span style={{ color: T.textMute }}>posts</span></span>
            <span style={{ color: T.text }}><b>{following.length}</b> <span style={{ color: T.textMute }}>siguiendo</span></span>
            <span style={{ color: T.text }}><b>{saved.length}</b> <span style={{ color: T.textMute }}>guardados</span></span>
          </div>
        </div>
      </div>

      {/* Posts / Saved toggle */}
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

      <div style={{ margin: "16px" }}>
        {list.length === 0 ? (
          <div style={{
            padding: 30, textAlign: "center",
            color: T.textMute, fontFamily: FONT.sans, fontSize: 13,
          }}>
            {view === "posts"
              ? "Todavía no publicaste nada."
              : "Aún no guardaste posts."}
          </div>
        ) : (
          list.map((p) => <PostCard key={p.id} T={T} p={p} readonly />)
        )}
      </div>
    </div>
  );
}

// ============================================================
// PostCard — used by Feed + Profile
// ============================================================
function PostCard({ T, p, saved, onLike, onRepost, onSave, readonly }) {
  const handle = (p.author?.handle || "@user").replace(/^@/, "");
  // avatarPropsFor handles the displayName-missing case AND falls
  // back to a deterministic color so two posters in the same feed
  // never share a tint by accident.
  const { initials, color } = avatarPropsFor(p.author, T.accent);
  const displayName = p.author?.displayName || "Usuario";
  return (
    <div style={{
      padding: 14, marginBottom: 8, borderRadius: 18,
      background: T.surface, border: `1px solid ${T.border}`,
    }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
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
      <div style={{
        fontFamily: FONT.sans, fontSize: 14, color: T.text,
        lineHeight: 1.5, whiteSpace: "pre-wrap", marginBottom: 10,
      }}>{p.body}</div>

      {p.trade && (
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
          <div style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text }}>
            {p.trade.qty} {p.trade.ticker}
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 12, color: T.textMute, marginLeft: "auto" }}>
            US${p.trade.price?.toLocaleString("es-AR")}
          </div>
        </div>
      )}

      {!readonly && (
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <ActionBtn T={T}
            icon={<Ico.Heart size={16} {...(p.likedByMe ? { fill: "currentColor" } : {})}/>}
            count={p.likes} active={p.likedByMe} activeColor={T.danger} onClick={onLike} />
          <ActionBtn T={T}
            icon={<Ico.Repeat size={16}/>} count={p.reposts}
            active={p.repostedByMe} activeColor={T.accent} onClick={onRepost} />
          <ActionBtn T={T}
            icon={<Ico.Comment size={16}/>} count={p.comments} />
          <ActionBtn T={T}
            icon={<Ico.Bookmark size={16} {...(saved ? { fill: "currentColor" } : {})}/>}
            active={saved} activeColor={T.accent} onClick={onSave} />
        </div>
      )}
    </div>
  );
}

function ActionBtn({ T, icon, count, active, activeColor, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6,
      background: "transparent", border: "none", padding: 4,
      cursor: onClick ? "pointer" : "default",
      color: active ? activeColor : T.textMute,
      fontFamily: FONT.mono, fontSize: 12, fontWeight: 600,
    }}>
      {icon}
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
