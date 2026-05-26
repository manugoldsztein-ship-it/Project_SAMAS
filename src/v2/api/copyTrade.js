// ============================================================
// SAMAS v2 — Copy Trade API (samas-0.4.90)
// ============================================================
// Wraps public.copy_relationships. RLS does the auth heavy lifting:
// the copier owns their rows; the leader can read who's copying them.
//
// Stats helpers (getCopyStats / getTopTraders) are MOCK por ahora —
// deterministic numbers seeded by user_id so the same trader shows
// the same stats every session, but they don't reflect real trade
// outcomes. When transaction data is reliable + Cohen wires real fills,
// swap each helper for a real SQL query — the shapes don't change.
// ============================================================

import { supabase } from "../../lib/supabase.js";

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error("Sesión no encontrada.");
  return data.user.id;
}

// ----------------------------------------------------------
// Deterministic mock-stats helpers
// ----------------------------------------------------------
// Hash the user_id into a stable 0..1 number so a leader's stats
// don't flicker across renders. Cheap djb2-style.
function seedFromId(id) {
  const s = String(id || "");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h) / 2147483647;
}

function mockStatsFor(userId) {
  const seed = seedFromId(userId);
  // Return %: -10..+45 (most traders positive, some negative). YTD-ish.
  const returnPct = Math.round((-10 + seed * 55) * 10) / 10;
  // Win rate 35..78%
  const winRate = Math.round(35 + seed * 43);
  // Trades count 12..240
  const tradesCount = Math.round(12 + seed * 228);
  // Max drawdown -2..-22% (always negative)
  const maxDdPct = Math.round((-2 - seed * 20) * 10) / 10;
  return { returnPct, winRate, tradesCount, maxDdPct };
}

// ----------------------------------------------------------
// Mutations
// ----------------------------------------------------------

/**
 * startCopying({ leaderId, allocationPct }) — creates a new active
 * relationship, or reactivates + updates allocation if one already
 * exists (UPSERT pattern via DB unique constraint).
 *
 * @returns {Promise<{ id, leaderId, allocationPct, startedAt }>}
 */
export async function startCopying({ leaderId, allocationPct }) {
  const copierId = await currentUserId();
  if (!leaderId) throw new Error("Trader inválido.");
  if (leaderId === copierId) throw new Error("No te podés copiar a vos mismo.");
  const pct = Math.max(1, Math.min(100, Math.round(allocationPct || 25)));

  // Try to find an existing relationship (active or stopped). If it
  // exists, UPDATE — keeps audit history. Otherwise INSERT.
  const { data: existing, error: selErr } = await supabase
    .from("copy_relationships")
    .select("id, is_active, allocation_pct")
    .eq("copier_id", copierId)
    .eq("leader_id", leaderId)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);

  if (existing) {
    const { data, error } = await supabase
      .from("copy_relationships")
      .update({
        is_active: true,
        allocation_pct: pct,
        stopped_at: null,
        started_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id, leader_id, allocation_pct, started_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      id: data.id, leaderId: data.leader_id,
      allocationPct: data.allocation_pct, startedAt: data.started_at,
    };
  }

  const { data, error } = await supabase
    .from("copy_relationships")
    .insert({
      copier_id: copierId,
      leader_id: leaderId,
      allocation_pct: pct,
      is_active: true,
    })
    .select("id, leader_id, allocation_pct, started_at")
    .single();
  if (error) throw new Error(error.message);
  return {
    id: data.id, leaderId: data.leader_id,
    allocationPct: data.allocation_pct, startedAt: data.started_at,
  };
}

/**
 * stopCopying(leaderId) — marks the relationship inactive. We keep
 * the row (audit) and only set is_active=false + stopped_at.
 */
export async function stopCopying(leaderId) {
  const copierId = await currentUserId();
  const { error } = await supabase
    .from("copy_relationships")
    .update({ is_active: false, stopped_at: new Date().toISOString() })
    .eq("copier_id", copierId)
    .eq("leader_id", leaderId);
  if (error) throw new Error(error.message);
  return true;
}

// ----------------------------------------------------------
// Queries
// ----------------------------------------------------------

/**
 * getMyCopies() — list of leaders the current user is copying.
 * Joins profiles_social by leader_id so the UI gets display name,
 * handle, avatar color out of the gate.
 *
 * @returns {Promise<Array<{
 *   leaderId, allocationPct, startedAt,
 *   displayName, handle, avatarColor, bio,
 *   stats: { returnPct, winRate, tradesCount, maxDdPct },
 * }>>}
 */
export async function getMyCopies() {
  const copierId = await currentUserId();
  const { data: rels, error } = await supabase
    .from("copy_relationships")
    .select("leader_id, allocation_pct, started_at")
    .eq("copier_id", copierId)
    .eq("is_active", true)
    .order("started_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!rels?.length) return [];

  const leaderIds = rels.map((r) => r.leader_id);
  const { data: profiles } = await supabase
    .from("profiles_social")
    .select("user_id, handle, display_name, avatar_color, bio")
    .in("user_id", leaderIds);
  const byId = new Map((profiles || []).map((p) => [p.user_id, p]));

  return rels.map((r) => {
    const p = byId.get(r.leader_id) || {};
    return {
      leaderId: r.leader_id,
      allocationPct: r.allocation_pct,
      startedAt: r.started_at,
      displayName: p.display_name || "Trader",
      handle: p.handle || "trader",
      avatarColor: p.avatar_color || "#16C784",
      bio: p.bio || "",
      stats: mockStatsFor(r.leader_id),
    };
  });
}

/**
 * getMyCopiers() — list of users copying ME. Used to render the
 * "X traders te copian" badge on own profile + future leader rev share.
 */
export async function getMyCopiers() {
  const leaderId = await currentUserId();
  const { data: rels, error } = await supabase
    .from("copy_relationships")
    .select("copier_id, allocation_pct, started_at")
    .eq("leader_id", leaderId)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return rels || [];
}

/**
 * getCopyStatus(leaderId) — am I copying this person? Used by
 * ProfileView to render the CTA in the right state.
 *
 * @returns {Promise<{ isCopying: boolean, allocationPct?: number }>}
 */
export async function getCopyStatus(leaderId) {
  const copierId = await currentUserId();
  if (!leaderId || leaderId === copierId) return { isCopying: false };
  const { data, error } = await supabase
    .from("copy_relationships")
    .select("allocation_pct, is_active")
    .eq("copier_id", copierId)
    .eq("leader_id", leaderId)
    .maybeSingle();
  if (error) return { isCopying: false };
  if (!data || !data.is_active) return { isCopying: false };
  return { isCopying: true, allocationPct: data.allocation_pct };
}

/**
 * getCopyStats(leaderId) — leader's headline metrics. MOCK por
 * ahora. Also counts active copiers from the live DB (real signal).
 *
 * @returns {Promise<{ copiers, returnPct, winRate, tradesCount, maxDdPct }>}
 */
export async function getCopyStats(leaderId) {
  if (!leaderId) return null;
  const { count } = await supabase
    .from("copy_relationships")
    .select("id", { count: "exact", head: true })
    .eq("leader_id", leaderId)
    .eq("is_active", true);
  return { copiers: count || 0, ...mockStatsFor(leaderId) };
}

/**
 * getTopTraders({ limit }) — leaderboard for the "discover top
 * traders" carousel. MOCK ranking: pulls profiles_social rows
 * (with bio set, looks like a real trader) and sorts by mockStats'
 * returnPct.
 *
 * When real trade data lands we swap this for a materialized view
 * computed nightly off transactions.
 */
export async function getTopTraders({ limit = 20 } = {}) {
  let meId = null;
  try { meId = await currentUserId(); } catch {}

  const { data, error } = await supabase
    .from("profiles_social")
    .select("user_id, handle, display_name, avatar_color, bio, cnv_idoneo, university_verified")
    .limit(60);
  if (error) throw new Error(error.message);

  const rows = (data || [])
    .filter((p) => p.user_id !== meId)
    .map((p) => ({
      leaderId: p.user_id,
      handle: p.handle || "trader",
      displayName: p.display_name || "Trader",
      avatarColor: p.avatar_color || "#16C784",
      bio: p.bio || "",
      cnvIdoneo: !!p.cnv_idoneo,
      universityVerified: !!p.university_verified,
      stats: mockStatsFor(p.user_id),
    }))
    .sort((a, b) => b.stats.returnPct - a.stats.returnPct)
    .slice(0, limit);

  return rows;
}
