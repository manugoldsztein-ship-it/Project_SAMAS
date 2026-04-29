// ============================================================
// SAMAS v2 — Social API (Supabase-backed)
// ============================================================
// Owns: posts, replies, likes, reposts, follows, profiles_social,
// saved_posts, reports. Schema + RLS in supabase/social.sql.
//
// EVERY function on this module exports the same signature it had
// in the mock — Social.jsx is wired to this surface and doesn't
// know we swapped storage layers. The DB ↔ JS field mapping is
// done in row-mapping helpers at the top of the file.
//
// ROW MAPPING
//   posts.body                → post.body
//   posts.ticker              → post.ticker
//   posts.trade (jsonb)       → post.trade
//   posts.likes_count         → post.likes
//   posts.comments_count      → post.comments
//   posts.reposts_count       → post.reposts
//   posts.created_at          → post.at (ms epoch) + post.atLabel (relative)
//   posts.deleted_at          → not surfaced (filtered out by RLS for non-author)
//
// PROFILE AUTO-PROVISION
//   The first time a logged-in user opens Social, getMe() will find
//   no row in profiles_social and auto-create one with derived
//   defaults (handle from email local-part, display_name from
//   first/last name on the legacy profiles row). This is the only
//   write the user can do without an explicit action.
// ============================================================

import { supabase } from "../../lib/supabase.js";
import { jitter, relativeStamp } from "./_mock.js";

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error("Sesión no encontrada.");
  return data.user.id;
}

function profileRowToUser(r) {
  if (!r) return null;
  return {
    id: r.user_id,
    handle: r.handle,
    displayName: r.display_name,
    avatarColor: r.avatar_color || "#16C784",
    bio: r.bio || "",
    verified: !!r.verified,
    isAdmin: !!r.is_admin,
    // University claim + auto-verified flag. The verified flag is set
    // by the BEFORE-INSERT trigger on profiles_social — see
    // supabase/social_university.sql. Frontend only renders the badge
    // when both are present (a claim alone isn't enough).
    university: r.university || null,
    universityVerified: !!r.university_verified,
    // CNV idóneo flag. Service-role-only (RLS locked). Frontend
    // shows a blue tick distinct from the university green tick.
    // See supabase/social_cnv_idoneo.sql.
    cnvIdoneo: !!r.cnv_idoneo,
    // created_at — passes through as ms epoch when present in the
    // row. Most callers project this column already; for getMe() we
    // get it for free via select("*"). The ProfileView "Se unió en
    // …" line only renders when this is set, so callers that don't
    // need it can keep their narrower projections.
    createdAt: r.created_at ? new Date(r.created_at).getTime() : null,
  };
}

// Map a stored university key (uba / udesa / itba / ...) to the human
// label we render in the badge. Mirrors AR_UNIVERSITIES in
// src/auth/SupabaseAuth.jsx — keep in sync if you add a new uni.
const AR_UNI_LABELS = {
  uba:      "Universidad de Buenos Aires",
  udesa:    "Universidad de San Andrés",
  itba:     "ITBA",
  utdt:     "Universidad Torcuato Di Tella",
  austral:  "Universidad Austral",
  uca:      "UCA",
  palermo:  "Universidad de Palermo",
  ub:       "Universidad de Belgrano",
  utn:      "UTN",
  unlp:     "Universidad Nacional de La Plata",
  unc:      "Universidad Nacional de Córdoba",
  ucema:    "UCEMA",
  siglo21:  "Universidad Siglo 21",
};

export function universityLabel(key) {
  if (!key) return "";
  return AR_UNI_LABELS[String(key).toLowerCase()] || String(key);
}

function postRowToPost(r, opts = {}) {
  const { likedByMe = false, repostedByMe = false, savedByMe = false, author } = opts;
  const at = r.created_at ? new Date(r.created_at).getTime() : Date.now();
  return {
    id: r.id,
    body: r.body,
    ticker: r.ticker || null,
    trade: r.trade || null,
    at,
    atLabel: relativeStamp(at),
    likes: r.likes_count || 0,
    comments: r.comments_count || 0,
    reposts: r.reposts_count || 0,
    likedByMe,
    repostedByMe,
    savedByMe,
    author: author || (r.author ? profileRowToUser({
      user_id: r.author.user_id || r.author_id,
      handle: r.author.handle,
      display_name: r.author.display_name,
      avatar_color: r.author.avatar_color,
      bio: r.author.bio,
      verified: r.author.verified,
      is_admin: r.author.is_admin,
    }) : null),
  };
}

// Try to derive a handle from the legacy profiles row. Falls back to
// the email local-part if no profile row exists yet (newly-signed-up
// user opening Social before completing onboarding).
async function deriveDefaults(userId) {
  // Pull display_name from the legacy `profiles` table if present.
  let firstName = "";
  let lastName = "";
  let email = "";
  // signupUni — the optional university key the user picked at
  // signup. Lives in auth.users.raw_user_meta_data.university (set
  // by SignupView in src/auth/SupabaseAuth.jsx). Empty / undefined =
  // user didn't claim a uni. The BEFORE-INSERT trigger on
  // profiles_social validates whatever we pass against the email
  // domain — so even if a malicious client sets a uni they don't
  // belong to, the trigger refuses to flip university_verified.
  let signupUni = "";
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("nombre, apellido")
      .eq("id", userId)
      .maybeSingle();
    firstName = (profile?.nombre || "").trim();
    lastName  = (profile?.apellido || "").trim();
  } catch {}
  try {
    const { data: u } = await supabase.auth.getUser();
    email = u?.user?.email || "";
    signupUni = String(u?.user?.user_metadata?.university || "").trim();
  } catch {}
  const fullName = [firstName, lastName].filter(Boolean).join(" ")
    || (email ? email.split("@")[0] : "Usuario");
  // handle: lowercase email local-part, with random suffix to avoid
  // collisions on common names. Profile UI lets the user change it.
  const base = (email.split("@")[0] || fullName.toLowerCase())
    .replace(/[^a-z0-9_]/gi, "")
    .slice(0, 12) || "user";
  const suffix = Math.floor(Math.random() * 9000 + 1000); // 4 digits
  const handle = `@${base}${suffix}`;
  // Pick a color from a small palette so the avatar isn't always the
  // same accent green.
  const palette = ["#16C784", "#3B82F6", "#F59E0B", "#EC4899", "#8B5CF6", "#06B6D4"];
  const avatarColor = palette[Math.floor(Math.random() * palette.length)];
  const out = { handle, display_name: fullName, avatar_color: avatarColor };
  if (signupUni) out.university = signupUni;
  return out;
}

// ----------------------------------------------------------
// PROFILE
// ----------------------------------------------------------

/**
 * getMe() — current user's social profile. Auto-creates the row on
 * first access (no separate "social signup" step).
 */
export async function getMe() {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("profiles_social")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return profileRowToUser(data);

  // Auto-provision with derived defaults.
  const defaults = await deriveDefaults(userId);
  const { data: created, error: insErr } = await supabase
    .from("profiles_social")
    .insert({ user_id: userId, ...defaults })
    .select("*")
    .single();
  if (insErr) {
    // Race: another tab provisioned at the same time. Re-read.
    const { data: again } = await supabase
      .from("profiles_social")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (again) return profileRowToUser(again);
    throw new Error(insErr.message);
  }
  return profileRowToUser(created);
}

/**
 * updateMe({ handle, displayName, bio, avatarColor }) — patch the
 * caller's profile_social row. Only the user themselves can flip
 * these fields (RLS); verified / is_admin are admin-only.
 */
export async function updateMe(patch) {
  const userId = await currentUserId();
  const dbPatch = {};
  if (patch.handle != null)       dbPatch.handle = patch.handle;
  if (patch.displayName != null)  dbPatch.display_name = patch.displayName;
  if (patch.bio != null)          dbPatch.bio = patch.bio;
  if (patch.avatarColor != null)  dbPatch.avatar_color = patch.avatarColor;
  const { data, error } = await supabase
    .from("profiles_social")
    .update(dbPatch)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return profileRowToUser(data);
}

// ----------------------------------------------------------
// FEED
// ----------------------------------------------------------

/**
 * getFeed({ tab, ticker, limit }) — list of posts for a given tab.
 *
 * tab:    'for_you' | 'following' | 'trades'   (default 'for_you')
 *           - 'for_you' is the Trending feed (post-0.0.36): the user
 *             sees posts ranked by engagement, not chronologically.
 *             Implementation pulls a wider candidate window of recent
 *             posts (last ~7 days, capped at TRENDING_CANDIDATE_LIMIT)
 *             then sorts client-side by likes+reposts+comments and
 *             slices to `limit`. Sorting in JS instead of Postgres
 *             keeps the query simple and lets us tweak the formula
 *             without a migration.
 *           - 'following' is strictly chronological — you're already
 *             curating who shows up; no need to re-rank.
 *           - 'trades' is also chronological because users mostly
 *             want fresh trade calls.
 * ticker: optional uppercase symbol — when set, returns only posts
 *         where posts.ticker = upper(ticker). Backed by the
 *         posts_by_ticker partial index. Composes with `tab`, e.g.
 *         tab='trades', ticker='NVDA' → trades on NVDA.
 *
 * Implementation: one query for posts (joined to author profile),
 * three more for "my likes / reposts / saves" to compute per-row
 * flags. All batched in parallel.
 */
const TRENDING_CANDIDATE_LIMIT = 200;
const TRENDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function getFeed({ tab = "for_you", ticker = null, limit = 20 } = {}) {
  const userId = await currentUserId();

  // Step 1: figure out which posts to fetch.
  // For "following" we need the list of authors I follow first.
  let authorFilter = null;
  if (tab === "following") {
    const { data: follows, error: fErr } = await supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", userId);
    if (fErr) throw new Error(fErr.message);
    const ids = (follows || []).map((r) => r.following_id);
    if (ids.length === 0) return [];     // not following anyone yet
    authorFilter = ids;
  }

  // Trending-mode = pull a fatter recent window so the engagement
  // sort has a meaningful candidate pool. Other tabs keep the
  // requested limit since they don't re-sort.
  const isTrending = tab === "for_you" && !authorFilter && !ticker;
  const fetchLimit = isTrending ? TRENDING_CANDIDATE_LIMIT : limit;

  let q = supabase
    .from("posts")
    .select(`
      id, author_id, body, ticker, trade,
      likes_count, comments_count, reposts_count, created_at,
      author:profiles_social!author_id (
        user_id, handle, display_name, avatar_color, verified
      )
    `)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (isTrending) {
    // Only consider posts from the last week. Older viral posts
    // would otherwise sit at the top forever — engagement is
    // sticky, recency is not.
    const sinceIso = new Date(Date.now() - TRENDING_WINDOW_MS).toISOString();
    q = q.gte("created_at", sinceIso);
  }

  if (authorFilter) q = q.in("author_id", authorFilter);
  if (tab === "trades") q = q.not("trade", "is", null);
  if (ticker) q = q.eq("ticker", String(ticker).toUpperCase());

  const { data: posts, error } = await q;
  if (error) throw new Error(error.message);
  if (!posts || posts.length === 0) return [];

  // Trending re-sort: engagement score = likes + reposts + comments.
  // Equal-weight is a fine MVP — the brief said "based on likes
  // reposts and comments". We tie-break on recency so two equally
  // engaged posts surface the newer one.
  let ordered = posts;
  if (isTrending) {
    ordered = [...posts].sort((a, b) => {
      const sa = (a.likes_count || 0) + (a.reposts_count || 0) + (a.comments_count || 0);
      const sb = (b.likes_count || 0) + (b.reposts_count || 0) + (b.comments_count || 0);
      if (sa !== sb) return sb - sa;
      const ta = a.created_at ? +new Date(a.created_at) : 0;
      const tb = b.created_at ? +new Date(b.created_at) : 0;
      return tb - ta;
    }).slice(0, limit);
  }
  // Reassign so downstream uses the trimmed/sorted list.
  // (We can't reassign `posts` directly since it's a const; use
  // `ordered` from here on out.)

  const postIds = ordered.map((p) => p.id);

  // Step 2 (parallel): my likes / reposts / saves on these posts.
  const [likesRes, repostsRes, savesRes] = await Promise.all([
    supabase.from("likes").select("post_id").eq("user_id", userId).in("post_id", postIds),
    supabase.from("reposts").select("post_id").eq("user_id", userId).in("post_id", postIds),
    supabase.from("saved_posts").select("post_id").eq("user_id", userId).in("post_id", postIds),
  ]);
  const liked = new Set((likesRes.data || []).map((r) => r.post_id));
  const reposted = new Set((repostsRes.data || []).map((r) => r.post_id));
  const saved = new Set((savesRes.data || []).map((r) => r.post_id));

  return ordered.map((p) =>
    postRowToPost(p, {
      likedByMe: liked.has(p.id),
      repostedByMe: reposted.has(p.id),
      savedByMe: saved.has(p.id),
      author: p.author ? profileRowToUser(p.author) : null,
    })
  );
}

/**
 * getPost(postId) — single post with denormalized author + my flags.
 */
export async function getPost(postId) {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("posts")
    .select(`
      id, author_id, body, ticker, trade,
      likes_count, comments_count, reposts_count, created_at,
      author:profiles_social!author_id (
        user_id, handle, display_name, avatar_color, verified
      )
    `)
    .eq("id", postId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Post no encontrado.");

  const [{ data: lk }, { data: rp }, { data: sv }] = await Promise.all([
    supabase.from("likes").select("post_id").eq("user_id", userId).eq("post_id", postId).maybeSingle(),
    supabase.from("reposts").select("post_id").eq("user_id", userId).eq("post_id", postId).maybeSingle(),
    supabase.from("saved_posts").select("post_id").eq("user_id", userId).eq("post_id", postId).maybeSingle(),
  ]);
  return postRowToPost(data, {
    likedByMe: !!lk,
    repostedByMe: !!rp,
    savedByMe: !!sv,
    author: data.author ? profileRowToUser(data.author) : null,
  });
}

// ----------------------------------------------------------
// CREATE / DELETE POSTS
// ----------------------------------------------------------

/**
 * createPost({ body, trade }) — publish a new post. Body is
 * client-side trimmed and length-checked; the server enforces the
 * same limits via the CHECK constraint (defense in depth).
 */
export async function createPost({ body, trade }) {
  const userId = await currentUserId();
  if (!body || !body.trim()) throw new Error("El post está vacío.");
  if (body.length > 280) throw new Error("Máximo 280 caracteres.");

  // Light client-side moderation. Server-side moderation is a future
  // Edge Function; the point of this list is to make the demo feel
  // less spammable, not to be a real filter.
  const banned = ["spam", "scam", "estafa garantizada"];
  if (banned.some((w) => body.toLowerCase().includes(w))) {
    throw new Error("Tu post fue marcado por moderación. Revisalo y volvé a intentarlo.");
  }

  const ticker = trade?.ticker ? String(trade.ticker).toUpperCase() : null;

  const { data, error } = await supabase
    .from("posts")
    .insert({
      author_id: userId,
      body: body.trim(),
      ticker,
      trade: trade || null,
    })
    .select(`
      id, author_id, body, ticker, trade,
      likes_count, comments_count, reposts_count, created_at,
      author:profiles_social!author_id (
        user_id, handle, display_name, avatar_color, verified
      )
    `)
    .single();
  if (error) throw new Error(error.message);
  return postRowToPost(data, {
    likedByMe: false, repostedByMe: false, savedByMe: false,
    author: data.author ? profileRowToUser(data.author) : null,
  });
}

/**
 * getPostsByAuthor(userId, { limit, beforeMs }) — paginated
 * newest-first posts authored by `userId`. Used by ProfileView to
 * render someone's post timeline. Same denormalization shape as
 * getFeed (author profile embedded, my-flags computed).
 */
export async function getPostsByAuthor(authorId, { limit = 30, beforeMs } = {}) {
  const me = await currentUserId();
  let q = supabase
    .from("posts")
    .select(`
      id, author_id, body, ticker, trade,
      likes_count, comments_count, reposts_count, created_at,
      author:profiles_social!author_id (
        user_id, handle, display_name, avatar_color, verified
      )
    `)
    .eq("author_id", authorId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (beforeMs) q = q.lt("created_at", new Date(beforeMs).toISOString());
  const { data: posts, error } = await q;
  if (error) throw new Error(error.message);
  if (!posts || posts.length === 0) return [];

  const postIds = posts.map((p) => p.id);
  const [likesRes, repostsRes, savesRes] = await Promise.all([
    supabase.from("likes").select("post_id").eq("user_id", me).in("post_id", postIds),
    supabase.from("reposts").select("post_id").eq("user_id", me).in("post_id", postIds),
    supabase.from("saved_posts").select("post_id").eq("user_id", me).in("post_id", postIds),
  ]);
  const liked = new Set((likesRes.data || []).map((r) => r.post_id));
  const reposted = new Set((repostsRes.data || []).map((r) => r.post_id));
  const saved = new Set((savesRes.data || []).map((r) => r.post_id));

  return posts.map((p) =>
    postRowToPost(p, {
      likedByMe: liked.has(p.id),
      repostedByMe: reposted.has(p.id),
      savedByMe: saved.has(p.id),
      author: p.author ? profileRowToUser(p.author) : null,
    })
  );
}

/**
 * getUserById(userId) — full peer profile for a drill-in: their
 * social profile + post count + followers/following counts +
 * whether the caller follows them. One round trip-ish: 4 parallel
 * lightweight queries.
 */
export async function getUserById(userId) {
  const me = await currentUserId();

  const [profileRes, postsCountRes, followersCountRes, followingCountRes, iFollowRes] = await Promise.all([
    supabase
      .from("profiles_social")
      .select("user_id, handle, display_name, avatar_color, bio, verified, is_admin, created_at, university, university_verified, cnv_idoneo")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("author_id", userId)
      .is("deleted_at", null),
    supabase
      .from("follows")
      .select("follower_id", { count: "exact", head: true })
      .eq("following_id", userId),
    supabase
      .from("follows")
      .select("following_id", { count: "exact", head: true })
      .eq("follower_id", userId),
    me === userId ? Promise.resolve({ data: null }) : supabase
      .from("follows")
      .select("follower_id")
      .eq("follower_id", me)
      .eq("following_id", userId)
      .maybeSingle(),
  ]);

  if (profileRes.error) throw new Error(profileRes.error.message);
  if (!profileRes.data) throw new Error("Usuario no encontrado.");

  return {
    ...profileRowToUser(profileRes.data),
    bio: profileRes.data.bio || "",
    createdAt: profileRes.data.created_at ? new Date(profileRes.data.created_at).getTime() : null,
    postCount: postsCountRes.count || 0,
    followersCount: followersCountRes.count || 0,
    followingCount: followingCountRes.count || 0,
    followedByMe: !!iFollowRes.data,
    isMe: me === userId,
  };
}

/**
 * deletePost(postId) — soft-delete (sets deleted_at). Only the
 * author can call this; RLS enforces.
 */
export async function deletePost(postId) {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("posts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", postId)
    .eq("author_id", userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ----------------------------------------------------------
// LIKES / REPOSTS
// ----------------------------------------------------------
// Insert/delete patterns. Composite PKs make the writes idempotent
// at the database level — calling like twice doesn't create two rows.
// We swallow the unique-violation error on insert so the caller
// always sees a successful "now liked" response.

async function fetchPostCount(postId, field) {
  const { data, error } = await supabase
    .from("posts")
    .select(field)
    .eq("id", postId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.[field] || 0;
}

export async function likePost(postId) {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("likes")
    .insert({ post_id: postId, user_id: userId });
  // 23505 = unique_violation = already liked. Treat as success.
  if (error && error.code !== "23505") throw new Error(error.message);
  const likes = await fetchPostCount(postId, "likes_count");
  return { likes, likedByMe: true };
}

export async function unlikePost(postId) {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("likes").delete()
    .eq("post_id", postId).eq("user_id", userId);
  if (error) throw new Error(error.message);
  const likes = await fetchPostCount(postId, "likes_count");
  return { likes, likedByMe: false };
}

export async function repostPost(postId) {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("reposts")
    .insert({ post_id: postId, user_id: userId });
  if (error && error.code !== "23505") throw new Error(error.message);
  const reposts = await fetchPostCount(postId, "reposts_count");
  return { reposts, repostedByMe: true };
}

export async function unrepostPost(postId) {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("reposts").delete()
    .eq("post_id", postId).eq("user_id", userId);
  if (error) throw new Error(error.message);
  const reposts = await fetchPostCount(postId, "reposts_count");
  return { reposts, repostedByMe: false };
}

// ----------------------------------------------------------
// FOLLOWS
// ----------------------------------------------------------

export async function follow(targetUserId) {
  const userId = await currentUserId();
  if (userId === targetUserId) throw new Error("No te podés seguir a vos mismo.");
  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: userId, following_id: targetUserId });
  if (error && error.code !== "23505") throw new Error(error.message);
  return { ok: true };
}

export async function unfollow(targetUserId) {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("follows").delete()
    .eq("follower_id", userId).eq("following_id", targetUserId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ----------------------------------------------------------
// USERS / SEARCH / FOLLOWING LIST
// ----------------------------------------------------------

/**
 * getUsers({ query }) — accounts other than me, optional handle/name
 * substring filter, with `followedByMe` flag computed via a second
 * lightweight query.
 */
export async function getUsers({ query = "" } = {}) {
  const userId = await currentUserId();
  let q = supabase
    .from("profiles_social")
    .select("user_id, handle, display_name, avatar_color, verified")
    .neq("user_id", userId)
    .limit(50);
  const trimmed = (query || "").trim();
  if (trimmed) {
    // Case-insensitive contains on either handle or display_name.
    const pattern = `%${trimmed.replace(/[%_]/g, "")}%`;
    q = q.or(`handle.ilike.${pattern},display_name.ilike.${pattern}`);
  }
  const { data: users, error } = await q;
  if (error) throw new Error(error.message);
  if (!users || users.length === 0) return [];

  // followedByMe in one query: fetch follow rows for the visible set.
  const ids = users.map((u) => u.user_id);
  const { data: follows } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId)
    .in("following_id", ids);
  const followed = new Set((follows || []).map((r) => r.following_id));

  return users.map((u) => ({
    ...profileRowToUser(u),
    followedByMe: followed.has(u.user_id),
  }));
}

/**
 * getFollowing() — users I follow, denormalized to the social profile.
 */
export async function getFollowing() {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("follows")
    .select(`
      following_id,
      profile:profiles_social!following_id (
        user_id, handle, display_name, avatar_color, verified
      )
    `)
    .eq("follower_id", userId);
  if (error) throw new Error(error.message);
  return (data || [])
    .map((r) => r.profile)
    .filter(Boolean)
    .map(profileRowToUser);
}

// ----------------------------------------------------------
// SAVED POSTS (private bookmarks)
// ----------------------------------------------------------

export async function savePost(postId) {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("saved_posts")
    .insert({ user_id: userId, post_id: postId });
  if (error && error.code !== "23505") throw new Error(error.message);
  return { ok: true };
}

export async function unsavePost(postId) {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("saved_posts").delete()
    .eq("user_id", userId).eq("post_id", postId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function getSavedPosts() {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("saved_posts")
    .select(`
      created_at,
      post:posts!post_id (
        id, author_id, body, ticker, trade,
        likes_count, comments_count, reposts_count, created_at,
        author:profiles_social!author_id (
          user_id, handle, display_name, avatar_color, verified
        )
      )
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const posts = (data || []).map((r) => r.post).filter(Boolean);
  if (posts.length === 0) return [];

  const ids = posts.map((p) => p.id);
  const [likesRes, repostsRes] = await Promise.all([
    supabase.from("likes").select("post_id").eq("user_id", userId).in("post_id", ids),
    supabase.from("reposts").select("post_id").eq("user_id", userId).in("post_id", ids),
  ]);
  const liked = new Set((likesRes.data || []).map((r) => r.post_id));
  const reposted = new Set((repostsRes.data || []).map((r) => r.post_id));
  return posts.map((p) =>
    postRowToPost(p, {
      likedByMe: liked.has(p.id),
      repostedByMe: reposted.has(p.id),
      savedByMe: true,
      author: p.author ? profileRowToUser(p.author) : null,
    })
  );
}

// ----------------------------------------------------------
// REPLIES
// ----------------------------------------------------------

export async function getReplies(postId) {
  const { data, error } = await supabase
    .from("replies")
    .select(`
      id, post_id, body, created_at,
      author:profiles_social!author_id (
        user_id, handle, display_name, avatar_color, verified
      )
    `)
    .eq("post_id", postId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((r) => {
    const at = r.created_at ? new Date(r.created_at).getTime() : Date.now();
    return {
      id: r.id,
      postId: r.post_id,
      body: r.body,
      at,
      atLabel: relativeStamp(at),
      author: r.author ? profileRowToUser(r.author) : null,
    };
  });
}

export async function createReply({ postId, body }) {
  const userId = await currentUserId();
  if (!body || !body.trim()) throw new Error("La respuesta está vacía.");
  if (body.length > 280) throw new Error("Máximo 280 caracteres.");
  const { data, error } = await supabase
    .from("replies")
    .insert({ post_id: postId, author_id: userId, body: body.trim() })
    .select(`
      id, post_id, body, created_at,
      author:profiles_social!author_id (
        user_id, handle, display_name, avatar_color, verified
      )
    `)
    .single();
  if (error) throw new Error(error.message);
  const at = new Date(data.created_at).getTime();
  return {
    id: data.id,
    postId: data.post_id,
    body: data.body,
    at,
    atLabel: relativeStamp(at),
    author: data.author ? profileRowToUser(data.author) : null,
  };
}

// ----------------------------------------------------------
// REPORTS / MODERATION
// ----------------------------------------------------------

export async function reportPost({ postId, reason }) {
  const userId = await currentUserId();
  if (!reason || !reason.trim()) throw new Error("Indicá un motivo.");
  const { data, error } = await supabase
    .from("reports")
    .insert({ post_id: postId, reporter_id: userId, reason: reason.trim() })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { ok: true, reportId: data.id };
}

/**
 * getModerationQueue({ status }) — RLS will silently return [] for
 * non-admins because the select policy gates rows on is_admin (or
 * own reports). The frontend should hide the moderation tab if
 * profile.isAdmin is false anyway.
 */
export async function getModerationQueue({ status = "pending" } = {}) {
  const { data, error } = await supabase
    .from("reports")
    .select(`
      id, reason, status, action, created_at, resolved_at,
      reporter:profiles_social!reporter_id (
        user_id, handle, display_name, avatar_color, verified
      ),
      post:posts!post_id (
        id, author_id, body, ticker, trade,
        likes_count, comments_count, reposts_count, created_at,
        author:profiles_social!author_id (
          user_id, handle, display_name, avatar_color, verified
        )
      )
    `)
    .eq("status", status)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    id: r.id,
    reason: r.reason,
    status: r.status,
    action: r.action,
    at: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    atLabel: relativeStamp(r.created_at ? new Date(r.created_at).getTime() : Date.now()),
    resolvedAt: r.resolved_at,
    reporter: r.reporter ? profileRowToUser(r.reporter) : null,
    post: r.post ? postRowToPost(r.post, {
      author: r.post.author ? profileRowToUser(r.post.author) : null,
    }) : null,
  }));
}

/**
 * resolveReport({ reportId, action }) — admin endpoint. Action drives
 * the side effect:
 *   "dismiss"      → mark resolved, no post change
 *   "delete_post"  → mark resolved, soft-delete the reported post
 *   "ban_user"     → TODO (not implemented; leaves a marker for future)
 */
export async function resolveReport({ reportId, action }) {
  if (!["dismiss", "delete_post", "ban_user"].includes(action)) {
    throw new Error("Acción inválida.");
  }
  // Pull the post_id first so we can soft-delete it if needed.
  const { data: report, error: rErr } = await supabase
    .from("reports").select("post_id").eq("id", reportId).maybeSingle();
  if (rErr) throw new Error(rErr.message);
  if (!report) throw new Error("Report no encontrado.");

  const { error: uErr } = await supabase
    .from("reports")
    .update({ status: "resolved", action, resolved_at: new Date().toISOString() })
    .eq("id", reportId);
  if (uErr) throw new Error(uErr.message);

  if (action === "delete_post") {
    await supabase
      .from("posts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", report.post_id);
  }
  return { ok: true };
}

// ----------------------------------------------------------
// Demo / dev helpers — no-op in real backend (kept for compat
// with any UI that still calls _resetDemo from the legacy mock).
// ----------------------------------------------------------
export function _resetDemo() {
  if (typeof console !== "undefined") {
    console.warn("[social] _resetDemo is a no-op against the real backend.");
  }
  return { ok: false, reason: "live-backend" };
}

// jitter is no longer needed (real network latency is real), but
// leave the import surface stable so any future debug code can
// re-add artificial latency without changing imports.
void jitter;
