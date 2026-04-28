// ============================================================
// NOTIFICATIONS — frontend API for the in-app inbox
// ============================================================
// Wraps public.notifications. RLS keeps queries scoped to the user;
// we never need to attach a where(user_id) ourselves. Same graceful-
// fallback shape as alerts.js — when the table hasn't been migrated
// yet, every read returns empty/0 and every write is a no-op so the
// UI keeps rendering.
// ============================================================

import { supabase } from "../../lib/supabase.js";

function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const msg = String(error.message || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("schema cache");
}

let _missingTableWarned = false;
function warnMissingTableOnce() {
  if (_missingTableWarned) return;
  _missingTableWarned = true;
  console.warn("[notifications] table not migrated yet — returning []. Apply supabase/notifications.sql to enable.");
}

function rowToNotif(r) {
  return {
    id: r.id,
    kind: r.kind || "system",
    title: r.title || "",
    body: r.body || "",
    data: r.data || {},
    readAt: r.read_at ? new Date(r.read_at).getTime() : null,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  };
}

/**
 * getNotifications({ limit, beforeMs }) — paginated newest-first.
 * Returns up to `limit` rows whose created_at < beforeMs (defaults to
 * everything). Empty array if the table doesn't exist yet.
 */
export async function getNotifications({ limit = 50, beforeMs } = {}) {
  let q = supabase
    .from("notifications")
    .select("id, kind, title, body, data, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (beforeMs) q = q.lt("created_at", new Date(beforeMs).toISOString());
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) { warnMissingTableOnce(); return []; }
    throw new Error(error.message);
  }
  return (data || []).map(rowToNotif);
}

/**
 * getUnreadCount() — number of rows with read_at IS NULL. Drives the
 * dot badge on the bell icon. Cheap thanks to the partial index in
 * the SQL migration.
 */
export async function getUnreadCount() {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) {
    if (isMissingTableError(error)) { warnMissingTableOnce(); return 0; }
    throw new Error(error.message);
  }
  return count || 0;
}

/**
 * markAsRead(id) — single row.
 */
export async function markAsRead(id) {
  if (!id) return;
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error && !isMissingTableError(error)) {
    console.warn("[notifications] markAsRead:", error.message);
  }
}

/**
 * markAllRead() — bulk mark all unread rows for the current user.
 * RLS scopes the update so we don't need an explicit user_id filter.
 */
export async function markAllRead() {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error && !isMissingTableError(error)) {
    console.warn("[notifications] markAllRead:", error.message);
  }
}

/**
 * deleteNotification(id) — clear one row. Useful for inbox cleanup.
 */
export async function deleteNotification(id) {
  if (!id) return;
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", id);
  if (error && !isMissingTableError(error)) {
    console.warn("[notifications] delete:", error.message);
  }
}
