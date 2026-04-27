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
import { social as socialApi } from "./api/index.js";
import { useEdgeSwipeBack } from "./useEdgeSwipeBack.js";
import { usePullToRefresh } from "./usePullToRefresh.jsx";
import { setRefreshHandler, callRefreshFor } from "./refreshRegistry.js";
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
export function SocialPage({ T, isNativeApp = false, onBack, lang = "es" }) {
  const [tab, setTab] = useState("feed");
  const navBottom = isNativeApp
    ? "calc(env(safe-area-inset-bottom) + 12px)"
    : 12;

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
        {tab === "feed"     && <FeedView T={T} lang={lang} />}
        {tab === "search"   && <SearchView T={T} lang={lang} />}
        {tab === "messages" && <MessagesView T={T} lang={lang} />}
        {tab === "profile"  && <ProfileView T={T} lang={lang} />}
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

function FeedView({ T, lang = "es" }) {
  const [tab, setTab] = useState("for_you");
  const [posts, setPosts] = useState([]);
  const [me, setMe] = useState(null);
  const [savedIds, setSavedIds] = useState([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

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

  async function publish() {
    setErr(null);
    if (!body.trim()) { setErr("El post está vacío."); return; }
    setBusy(true);
    try { await socialApi.createPost({ body }); setBody(""); await refresh(); }
    catch (e) { setErr(e.message); }
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
          <Avatar T={T}
            initials={(me?.displayName || "Vos").split(/\s+/).slice(0,2).map((s)=>s[0]).join("").toUpperCase()}
            color={me?.avatarColor || T.accent}
          />
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
function SearchView({ T, lang = "es" }) {
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
          users.map((u) => <UserRow key={u.id} T={T} user={u} onToggleFollow={() => toggleFollow(u)} />)
        )}
      </div>
    </div>
  );
}

function UserRow({ T, user, onToggleFollow }) {
  const initials = user.displayName.split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  const handle = user.handle.replace(/^@/, "");
  return (
    <div style={{
      padding: "12px 4px", display: "flex", alignItems: "center", gap: 12,
      borderBottom: `1px solid ${T.border}`,
    }}>
      <Avatar T={T} initials={initials} color={user.avatarColor || T.accent} />
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
  );
}

// ============================================================
// MESSAGES — DM inbox (placeholder: needs real backend)
// ============================================================
function MessagesView({ T, lang = "es" }) {
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
          Mensajes directos
        </div>
        <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5 }}>
          Pronto vas a poder mandar DMs entre traders, compartir trades y guardar conversaciones.
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PROFILE — your stuff: posts, saved, follow stats
// ============================================================
function ProfileView({ T, lang = "es" }) {
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
  const initials = me.displayName.split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  const handle = me.handle.replace(/^@/, "");
  const list = view === "posts" ? myPosts : saved;

  return (
    <div style={{ paddingBottom: 110 }}>
      {/* Profile header */}
      <div style={{ padding: "20px 16px 16px", display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar T={T} initials={initials} color={me.avatarColor || T.accent} size={64}/>
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
  const displayName = p.author?.displayName || "Usuario";
  const handle = (p.author?.handle || "@user").replace(/^@/, "");
  const initials = displayName
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((s) => s[0]).join("").toUpperCase() || "??";
  return (
    <div style={{
      padding: 14, marginBottom: 8, borderRadius: 18,
      background: T.surface, border: `1px solid ${T.border}`,
    }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
        <Avatar T={T} initials={initials} color={p.author?.avatarColor || T.accent} />
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
