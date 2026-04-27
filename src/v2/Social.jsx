// ============================================================
// SAMAS v2 — Social tab MVP
// ============================================================
// Twitter/X-style feed of trader posts. Currently mock-only
// (api/social.js drives everything from localStorage). The legacy
// MobileApp had no social feature — this is a fresh build.
//
// What it has:
//   - Top tabs: Siguiendo / Para vos / Trades
//   - Compose box at the top (max 280 chars, banned-word gate enforced
//     server-side in api/social.js)
//   - Post cards with author / body / trade card / like / repost / report
//
// What's NOT here yet (TODO once we get to it):
//   - Replies / threads
//   - Profile pages and follow lists
//   - Admin moderation queue
//   - Real backend (Supabase tables + RLS)
// ============================================================

import React, { useEffect, useState, useCallback } from "react";
import { FONT } from "./theme.js";
import { Ico } from "./icons.jsx";
import { social as socialApi } from "./api/index.js";

const TABS = [
  { id: "following", label: "Siguiendo" },
  { id: "for_you",   label: "Para vos"  },
  { id: "trades",    label: "Trades"    },
];

export function SocialPage({ T }) {
  const [tab, setTab] = useState("for_you");
  const [posts, setPosts] = useState([]);
  const [me, setMe] = useState(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [feed, m] = await Promise.all([
        socialApi.getFeed({ tab, limit: 30 }),
        socialApi.getMe(),
      ]);
      setPosts(feed); setMe(m);
    } catch (e) { console.error("[social] load:", e); }
  }, [tab]);

  useEffect(() => { refresh(); }, [refresh]);

  async function publish() {
    setErr(null);
    if (!body.trim()) { setErr("El post está vacío."); return; }
    setBusy(true);
    try {
      await socialApi.createPost({ body });
      setBody("");
      await refresh();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function toggleLike(p) {
    try {
      if (p.likedByMe) await socialApi.unlikePost(p.id);
      else await socialApi.likePost(p.id);
      await refresh();
    } catch (e) { console.error(e); }
  }

  async function repost(p) {
    try { await socialApi.repostPost(p.id); await refresh(); }
    catch (e) { console.error(e); }
  }

  return (
    <div style={{ paddingBottom: 110 }}>
      {/* Header */}
      <div style={{
        padding: "calc(env(safe-area-inset-top) + 20px) 20px 0",
      }}>
        <div style={{
          fontFamily: FONT.display, fontSize: 28, fontWeight: 700,
          color: T.text, letterSpacing: -0.6,
        }}>Social</div>
        <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, marginTop: 2 }}>
          Lo que están haciendo los traders
        </div>
      </div>

      {/* Top tabs */}
      <div style={{
        display: "flex", gap: 4, padding: 4, margin: "16px 16px 0",
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 12,
      }}>
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "10px 0", borderRadius: 8,
              background: active ? T.bg : "transparent",
              border: active ? `1px solid ${T.border}` : "1px solid transparent",
              color: active ? T.text : T.textMute,
              fontFamily: FONT.sans, fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>{t.label}</button>
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
              placeholder="¿Qué pensás del mercado hoy?"
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
              >{busy ? "Publicando..." : "Publicar"}</button>
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
              onLike={() => toggleLike(p)}
              onRepost={() => repost(p)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PostCard({ T, p, onLike, onRepost }) {
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

      {/* Trade card if attached */}
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

      {/* Actions */}
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <ActionBtn T={T} icon={<Ico.Heart size={16} {...(p.likedByMe ? { fill: "currentColor" } : {})}/>}
          count={p.likes} active={p.likedByMe} activeColor={T.danger} onClick={onLike} />
        <ActionBtn T={T} icon={<Ico.Repeat size={16}/>} count={p.reposts}
          active={p.repostedByMe} activeColor={T.accent} onClick={onRepost} />
        <ActionBtn T={T} icon={<Ico.Comment size={16}/>} count={p.comments} />
      </div>
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
      <span>{count || 0}</span>
    </button>
  );
}

function Avatar({ T, initials, color }) {
  return (
    <div style={{
      width: 38, height: 38, borderRadius: 12, flexShrink: 0,
      background: color, color: T.accentInk,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: FONT.display, fontSize: 14, fontWeight: 700,
    }}>{initials}</div>
  );
}
