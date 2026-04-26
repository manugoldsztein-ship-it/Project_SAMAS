// ============================================================
// SAMAS v2 — Social API (Twitter-like feed)
// ============================================================
// Owns: posts, replies, likes, reposts, follows, profiles, reports.
// Moderation queue is also surfaced here so admin tooling can drain
// it without a separate service.
//
// PRODUCTION INTEGRATION TARGET — Supabase native
//   Unlike wallet/card/broker (which integrate with external partners),
//   the social graph is owned by SAMAS itself. The "production swap"
//   here means moving from this file's in-memory mock to Supabase
//   tables + RLS + a few edge functions for write paths. Schema and
//   policies live in supabase/social.sql (TODO when wiring real).
//
// SCHEMA WE'LL CREATE WHEN GOING REAL
//   posts(id, author_id, body, ticker, created_at, deleted_at, ...)
//   likes(post_id, user_id)
//   reposts(id, post_id, user_id, created_at)
//   replies(id, post_id, author_id, body, created_at)
//   follows(follower_id, following_id)
//   reports(id, post_id, reporter_id, reason, created_at, resolved_at)
//   profiles_social(handle, display_name, avatar_color, bio, verified)
// ============================================================

import { jitter, maybeFail, genId, relativeStamp } from "./_mock.js";

const STORAGE_KEY = "samas_v2_social_mock";

function loadState() {
  if (typeof localStorage === "undefined") return seed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : seed();
  } catch { return seed(); }
}

function saveState(s) {
  state = s;
  if (typeof localStorage !== "undefined") {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
  }
}

// ----------------------------------------------------------
// Seed users + a handful of posts so the feed isn't empty for the
// first run. The current viewer is "santi" (us); the rest are
// other accounts we follow.
// ----------------------------------------------------------
function seed() {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  return {
    me: { id: "u_santi", handle: "@santirola", displayName: "Santi R.", avatarColor: "oklch(0.78 0.16 145)", verified: true },
    users: [
      { id: "u_manu", handle: "@manugold",   displayName: "Manuel G.",   avatarColor: "oklch(0.62 0.16 65)" },
      { id: "u_lupi", handle: "@lupimar",    displayName: "Lucía P.",    avatarColor: "oklch(0.72 0.16 350)" },
      { id: "u_tk",   handle: "@tk_trader",  displayName: "Tomás K.",    avatarColor: "oklch(0.65 0.18 145)" },
      { id: "u_caro", handle: "@caroinvest", displayName: "Carolina M.", avatarColor: "oklch(0.62 0.18 280)" },
    ],
    posts: [
      {
        id: genId(), authorId: "u_manu", at: now - 2 * hour,
        body: "Cargando NVDA pre-earnings. La narrativa de IA sigue intacta y los multiples se ajustaron. Target 950 en 2 semanas.",
        trade: { side: "buy", ticker: "NVDA", qty: 2, price: 888.40 },
        likes: 142, comments: 28, reposts: 11,
        likedByMe: false, repostedByMe: false,
      },
      {
        id: genId(), authorId: "u_lupi", at: now - 4 * hour,
        body: "GGAL volando con el resultado del Q1. +18% en el mes. Tomé ganancia de la mitad y dejo correr el resto.",
        trade: { side: "sell", ticker: "GGAL", qty: 125, price: 4250 },
        likes: 89, comments: 14, reposts: 6,
        likedByMe: true, repostedByMe: false,
      },
      {
        id: genId(), authorId: "u_tk", at: now - 6 * hour,
        body: "Recordatorio: el dólar MEP no baja porque vos lo desees. Cobertura siempre. 70/30 USD/ARS es mi mix.",
        trade: null,
        likes: 312, comments: 47, reposts: 38,
        likedByMe: false, repostedByMe: false,
      },
      {
        id: genId(), authorId: "u_caro", at: now - 9 * hour,
        body: "Primer trade del mes y salió bien. Gracias a los que respondieron mi pregunta sobre stops ayer 🙌",
        trade: { side: "buy", ticker: "AAPL", qty: 3, price: 213.10 },
        likes: 56, comments: 9, reposts: 2,
        likedByMe: false, repostedByMe: false,
      },
    ],
    follows: ["u_manu", "u_lupi", "u_tk", "u_caro"],
    reports: [],   // post-id, reporter, reason, status — drains the moderation queue.
  };
}

let state = loadState();

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------
function userById(id) {
  if (id === state.me.id) return state.me;
  return state.users.find((u) => u.id === id) || { id, handle: "@unknown", displayName: "?" };
}

function denormalizePost(p) {
  const author = userById(p.authorId);
  return {
    id: p.id,
    body: p.body,
    trade: p.trade,
    at: p.at,
    atLabel: relativeStamp(p.at),
    likes: p.likes, comments: p.comments, reposts: p.reposts,
    likedByMe: p.likedByMe, repostedByMe: p.repostedByMe,
    author: {
      id: author.id, handle: author.handle, displayName: author.displayName,
      avatarColor: author.avatarColor, verified: author.verified || false,
    },
  };
}

// ----------------------------------------------------------
// Public API
// ----------------------------------------------------------

/**
 * getFeed({ tab, limit }) — list of posts for a given tab.
 *
 * tabs:
 *   "following"   only people I follow (default)
 *   "for_you"     algorithmic / popular
 *   "trades"      only posts that contain a trade card
 *   "near"        geographic — TODO
 *
 * Production: GET /social/feed?tab=...  with cursor pagination.
 */
export async function getFeed({ tab = "following", limit = 20 } = {}) {
  await jitter();
  let rows = state.posts;
  if (tab === "following") rows = rows.filter((p) => state.follows.includes(p.authorId));
  else if (tab === "trades") rows = rows.filter((p) => !!p.trade);
  // for_you / near use the full set in the mock.
  return rows.slice(0, limit).map(denormalizePost);
}

/**
 * getPost(postId) — single post + denormalized author.
 */
export async function getPost(postId) {
  await jitter();
  const p = state.posts.find((x) => x.id === postId);
  if (!p) throw new Error("Post no encontrado.");
  return denormalizePost(p);
}

/**
 * createPost({ body, ticker, trade }) — publish a new post.
 *
 * Production: POST /social/posts. The server should run cheap
 * server-side moderation (banned-words list) and return 422 with a
 * reason if rejected. We return the created post on success.
 *
 * @param {{
 *   body: string,                  // 1..280 chars (we'll enforce server-side)
 *   trade?: { side: "buy"|"sell", ticker: string, qty: number, price: number },
 * }} input
 */
export async function createPost({ body, trade }) {
  await jitter(300, 700);
  if (!body || !body.trim()) throw new Error("El post está vacío.");
  if (body.length > 280) throw new Error("Máximo 280 caracteres.");

  // Demo-time moderation gate. In production this lives server-side.
  const banned = ["spam", "scam", "estafa garantizada"];
  if (banned.some((w) => body.toLowerCase().includes(w))) {
    throw new Error("Tu post fue marcado por moderación. Revisalo y volvé a intentarlo.");
  }

  await maybeFail(0.02, "No pudimos publicar tu post. Probá de nuevo.");

  const post = {
    id: genId(),
    authorId: state.me.id,
    at: Date.now(),
    body: body.trim(),
    trade: trade || null,
    likes: 0, comments: 0, reposts: 0,
    likedByMe: false, repostedByMe: false,
  };
  saveState({ ...state, posts: [post, ...state.posts] });
  return denormalizePost(post);
}

/**
 * deletePost(postId) — soft-delete (sets deleted_at server-side; in
 * the mock we just remove it from the list).
 */
export async function deletePost(postId) {
  await jitter();
  const p = state.posts.find((x) => x.id === postId);
  if (!p) throw new Error("Post no encontrado.");
  if (p.authorId !== state.me.id) throw new Error("Solo podés borrar tus propios posts.");
  saveState({ ...state, posts: state.posts.filter((x) => x.id !== postId) });
  return { ok: true };
}

/**
 * likePost(postId) / unlikePost(postId) — toggle like.
 * Server should be idempotent (calling like twice = single row).
 */
export async function likePost(postId) {
  await jitter(80, 200);
  const idx = state.posts.findIndex((p) => p.id === postId);
  if (idx < 0) throw new Error("Post no encontrado.");
  if (state.posts[idx].likedByMe) return { likes: state.posts[idx].likes, likedByMe: true };
  const next = { ...state, posts: [...state.posts] };
  next.posts[idx] = { ...next.posts[idx], likes: next.posts[idx].likes + 1, likedByMe: true };
  saveState(next);
  return { likes: next.posts[idx].likes, likedByMe: true };
}
export async function unlikePost(postId) {
  await jitter(80, 200);
  const idx = state.posts.findIndex((p) => p.id === postId);
  if (idx < 0) throw new Error("Post no encontrado.");
  if (!state.posts[idx].likedByMe) return { likes: state.posts[idx].likes, likedByMe: false };
  const next = { ...state, posts: [...state.posts] };
  next.posts[idx] = { ...next.posts[idx], likes: Math.max(0, next.posts[idx].likes - 1), likedByMe: false };
  saveState(next);
  return { likes: next.posts[idx].likes, likedByMe: false };
}

/**
 * repostPost(postId) — repost (boost). Mock just increments the count
 * and flips the flag. Real impl creates a row in `reposts`.
 */
export async function repostPost(postId) {
  await jitter();
  const idx = state.posts.findIndex((p) => p.id === postId);
  if (idx < 0) throw new Error("Post no encontrado.");
  if (state.posts[idx].repostedByMe) return { reposts: state.posts[idx].reposts, repostedByMe: true };
  const next = { ...state, posts: [...state.posts] };
  next.posts[idx] = { ...next.posts[idx], reposts: next.posts[idx].reposts + 1, repostedByMe: true };
  saveState(next);
  return { reposts: next.posts[idx].reposts, repostedByMe: true };
}

/**
 * follow(userId) / unfollow(userId) — mutate the follow graph.
 */
export async function follow(userId) {
  await jitter();
  if (state.follows.includes(userId)) return { ok: true };
  saveState({ ...state, follows: [...state.follows, userId] });
  return { ok: true };
}
export async function unfollow(userId) {
  await jitter();
  saveState({ ...state, follows: state.follows.filter((id) => id !== userId) });
  return { ok: true };
}

/**
 * reportPost({ postId, reason }) — flag a post for moderator review.
 *
 * Production: POST /social/reports. Inserts into `reports` table; an
 * admin sees it in their queue (getModerationQueue below).
 */
export async function reportPost({ postId, reason }) {
  await jitter();
  if (!reason || !reason.trim()) throw new Error("Indicá el motivo del reporte.");
  const report = {
    id: genId(),
    postId,
    reporterId: state.me.id,
    reason: reason.trim().slice(0, 500),
    at: Date.now(),
    status: "pending",
  };
  saveState({ ...state, reports: [report, ...state.reports] });
  return { ok: true, reportId: report.id };
}

/**
 * getMe() — current user's social profile.
 */
export async function getMe() {
  await jitter(50, 150);
  return { ...state.me };
}

// ----------------------------------------------------------
// Admin / Moderation — only callable by users with is_admin=true
// (server-side enforced via RLS on the real impl).
// ----------------------------------------------------------

/**
 * getModerationQueue({ status }) — open reports.
 * Admin sees everything; regular users get 403 in production.
 */
export async function getModerationQueue({ status = "pending" } = {}) {
  await jitter();
  return state.reports
    .filter((r) => r.status === status)
    .map((r) => {
      const post = state.posts.find((p) => p.id === r.postId);
      const reporter = userById(r.reporterId);
      return {
        ...r,
        atLabel: relativeStamp(r.at),
        post: post ? denormalizePost(post) : null,
        reporter: { id: reporter.id, handle: reporter.handle, displayName: reporter.displayName },
      };
    });
}

/**
 * resolveReport({ reportId, action }) — admin decides.
 * action: "dismiss" | "delete_post" | "ban_user"
 */
export async function resolveReport({ reportId, action }) {
  await jitter();
  const idx = state.reports.findIndex((r) => r.id === reportId);
  if (idx < 0) throw new Error("Report no encontrado.");
  const r = state.reports[idx];

  const next = { ...state, reports: [...state.reports] };
  next.reports[idx] = { ...r, status: "resolved", action, resolvedAt: Date.now() };

  if (action === "delete_post") {
    next.posts = next.posts.filter((p) => p.id !== r.postId);
  }
  // ban_user is a stub for the demo — would flag the user in real impl.

  saveState(next);
  return { ok: true };
}

// ----------------------------------------------------------
// Demo helpers
// ----------------------------------------------------------
export function _resetDemo() {
  saveState(seed());
}
