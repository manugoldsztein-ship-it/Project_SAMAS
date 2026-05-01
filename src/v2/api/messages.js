// ============================================================
// SAMAS v2 — Direct Messages API
// ============================================================
// Backs the Mensajes tab in v2 social. Schema + RLS in
// supabase/social_messages.sql. Two tables (dm_threads,
// dm_messages); thread row uniqueness enforced via UNIQUE on
// the sorted pair (user_a, user_b) so "open thread with X"
// always returns the same thread no matter who started.
//
// SHAPE
//   thread = {
//     id,                  // uuid
//     peer: { id, handle, displayName, avatarColor, verified },
//     lastMessageAt,       // ms epoch
//     lastMessage,         // { id, body, fromMe, at } — preview, may be null
//     unreadCount,         // count of messages where author <> me AND read_at is null
//     createdAt,
//   }
//   message = {
//     id, threadId, body, fromMe, at, readAt, authorId
//   }
// ============================================================

import { supabase } from "../../lib/supabase.js";

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error("Sesión no encontrada.");
  return data.user.id;
}

// Sorted pair helper — DB constraint requires user_a < user_b.
// Comparison on uuid type is byte-wise, which the JS string
// comparison emulates correctly for canonical lowercase uuids.
function sortedPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

function profileToPeer(p) {
  if (!p) return null;
  return {
    id: p.user_id,
    handle: p.handle,
    displayName: p.display_name,
    avatarColor: p.avatar_color || "#16C784",
    verified: !!p.verified,
  };
}

function rowToMessage(r, myUserId) {
  const at = r.created_at ? new Date(r.created_at).getTime() : Date.now();
  return {
    id: r.id,
    threadId: r.thread_id,
    body: r.body,
    fromMe: r.author_id === myUserId,
    at,
    readAt: r.read_at ? new Date(r.read_at).getTime() : null,
    authorId: r.author_id,
  };
}

// ----------------------------------------------------------
// THREADS
// ----------------------------------------------------------

/**
 * openThreadWith(peerUserId) — returns the existing thread between
 * the caller and `peerUserId`, creating it if missing. Idempotent:
 * any number of concurrent calls for the same pair land on the same
 * row thanks to UNIQUE(user_a, user_b).
 */
export async function openThreadWith(peerUserId) {
  const me = await currentUserId();
  if (peerUserId === me) throw new Error("No te podés DM a vos mismo.");
  const [user_a, user_b] = sortedPair(me, peerUserId);

  // Try to find existing thread first — most common case.
  const { data: existing, error: selErr } = await supabase
    .from("dm_threads")
    .select("id, user_a, user_b, last_message_at, created_at")
    .eq("user_a", user_a)
    .eq("user_b", user_b)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) return existing;

  // Create. If a concurrent caller wins the race, the unique
  // violation (23505) means the row exists now — re-select it.
  const { data: created, error: insErr } = await supabase
    .from("dm_threads")
    .insert({ user_a, user_b })
    .select("id, user_a, user_b, last_message_at, created_at")
    .single();
  if (insErr) {
    if (insErr.code === "23505") {
      const { data: again } = await supabase
        .from("dm_threads")
        .select("id, user_a, user_b, last_message_at, created_at")
        .eq("user_a", user_a)
        .eq("user_b", user_b)
        .maybeSingle();
      if (again) return again;
    }
    throw new Error(insErr.message);
  }
  return created;
}

/**
 * getThreads({ limit }) — list of threads the caller participates in,
 * sorted by recency (last_message_at desc), denormalized with the
 * peer's social profile + a preview of the most recent message + an
 * unread count.
 */
export async function getThreads({ limit = 30 } = {}) {
  const me = await currentUserId();

  // RLS already restricts to threads where me is a participant, so
  // a single SELECT covers it.
  const { data: threads, error } = await supabase
    .from("dm_threads")
    .select("id, user_a, user_b, last_message_at, created_at")
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  if (!threads || threads.length === 0) return [];

  // Resolve peer profiles + last-message previews + unread counts in
  // parallel. Three queries total, all batched.
  const peerIds = threads.map((t) => (t.user_a === me ? t.user_b : t.user_a));
  const threadIds = threads.map((t) => t.id);

  const [peersRes, lastMsgsRes, unreadRes] = await Promise.all([
    supabase
      .from("profiles_social")
      .select("user_id, handle, display_name, avatar_color, verified")
      .in("user_id", peerIds),
    // Most recent message per thread — fetched as a flat list, indexed
    // client-side. PostgREST doesn't expose lateral join, but the
    // dm_messages_by_thread index makes this fast enough.
    supabase
      .from("dm_messages")
      .select("id, thread_id, author_id, body, created_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("dm_messages")
      .select("thread_id")
      .in("thread_id", threadIds)
      .neq("author_id", me)
      .is("read_at", null),
  ]);

  const peersById = new Map();
  (peersRes.data || []).forEach((p) => peersById.set(p.user_id, p));

  const lastByThread = new Map();
  for (const m of lastMsgsRes.data || []) {
    if (!lastByThread.has(m.thread_id)) lastByThread.set(m.thread_id, m);
  }

  const unreadByThread = new Map();
  for (const r of unreadRes.data || []) {
    unreadByThread.set(r.thread_id, (unreadByThread.get(r.thread_id) || 0) + 1);
  }

  return threads.map((t) => {
    const peerId = t.user_a === me ? t.user_b : t.user_a;
    const last = lastByThread.get(t.id);
    return {
      id: t.id,
      peer: profileToPeer(peersById.get(peerId)) || { id: peerId, handle: "@unknown", displayName: "?", avatarColor: "#16C784" },
      lastMessageAt: t.last_message_at ? new Date(t.last_message_at).getTime() : 0,
      lastMessage: last ? {
        id: last.id,
        body: last.body,
        fromMe: last.author_id === me,
        at: new Date(last.created_at).getTime(),
      } : null,
      unreadCount: unreadByThread.get(t.id) || 0,
      createdAt: new Date(t.created_at).getTime(),
    };
  });
}

/**
 * getThread(threadId) — single thread denormalized like getThreads
 * returns. Useful for opening a conversation directly from a deep
 * link or a search result.
 */
export async function getThread(threadId) {
  const me = await currentUserId();
  const { data: t, error } = await supabase
    .from("dm_threads")
    .select("id, user_a, user_b, last_message_at, created_at")
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!t) throw new Error("Conversación no encontrada.");
  const peerId = t.user_a === me ? t.user_b : t.user_a;
  const { data: peer } = await supabase
    .from("profiles_social")
    .select("user_id, handle, display_name, avatar_color, verified")
    .eq("user_id", peerId)
    .maybeSingle();
  return {
    id: t.id,
    peer: profileToPeer(peer) || { id: peerId, handle: "@unknown", displayName: "?", avatarColor: "#16C784" },
    lastMessageAt: t.last_message_at ? new Date(t.last_message_at).getTime() : 0,
    lastMessage: null,
    unreadCount: 0,
    createdAt: new Date(t.created_at).getTime(),
  };
}

// ----------------------------------------------------------
// MESSAGES
// ----------------------------------------------------------

/**
 * getMessages(threadId, { limit, beforeMs }) — newest-first
 * paginated list. The conversation view will reverse the slice
 * for chronological render. beforeMs is the cursor for older
 * messages on scroll-up.
 */
export async function getMessages(threadId, { limit = 50, beforeMs } = {}) {
  const me = await currentUserId();
  let q = supabase
    .from("dm_messages")
    .select("id, thread_id, author_id, body, created_at, read_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (beforeMs) q = q.lt("created_at", new Date(beforeMs).toISOString());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map((r) => rowToMessage(r, me));
}

/**
 * sendMessage(threadId, body) — write a new message. RLS enforces
 * that the caller is a participant and the author. Returns the
 * created message.
 */
export async function sendMessage(threadId, body) {
  const me = await currentUserId();
  if (!body || !body.trim()) throw new Error("El mensaje está vacío.");
  if (body.length > 2000) throw new Error("Máximo 2000 caracteres.");
  const { data, error } = await supabase
    .from("dm_messages")
    .insert({ thread_id: threadId, author_id: me, body: body.trim() })
    .select("id, thread_id, author_id, body, created_at, read_at")
    .single();
  if (error) throw new Error(error.message);
  return rowToMessage(data, me);
}

/**
 * markRead(threadId) — bulk-mark every unread message in this
 * thread as read for the current user. RLS update policy clamps
 * us to messages we DIDN'T author, so this is safe even if a
 * client tries to abuse it.
 */
export async function markRead(threadId) {
  const me = await currentUserId();
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("dm_messages")
    .update({ read_at: nowIso })
    .eq("thread_id", threadId)
    .neq("author_id", me)
    .is("read_at", null);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * deleteThread(threadId) — delete the entire conversation. The
 * dm_messages cascade fires via FK so every message gets removed
 * along with the thread row. RLS gates this to participants only.
 *
 * Symmetric semantics: if the peer also deletes their side later,
 * both sides are clean; if only one side deletes, the peer's row
 * is gone too (since dm_threads is a single shared row, not per-
 * user). For "delete only my view" semantics we'd need a
 * dm_thread_hides lookup table — future patch if requested.
 *
 * samas-0.3.9.
 */
export async function deleteThread(threadId) {
  const { error } = await supabase
    .from("dm_threads")
    .delete()
    .eq("id", threadId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ----------------------------------------------------------
// Realtime payload mapping helper — exported so subscribers in
// the UI can convert raw INSERT payloads from supabase.channel
// the same way getMessages does.
// ----------------------------------------------------------
export function payloadToMessage(rawRow, myUserId) {
  return rowToMessage(rawRow, myUserId);
}
