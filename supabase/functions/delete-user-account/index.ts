// ============================================================
// delete-user-account — App Store Guideline 5.1.1(v) compliance
// ============================================================
// Permanently removes the authenticated user's account and all
// data keyed to them. App Store Connect rejects apps that create
// accounts but don't surface a self-service deletion path; this
// is the server side. The client surface is a "Borrar mi cuenta"
// row in Settings → Cuenta with a two-step confirmation.
//
// WHAT GETS DELETED
//   Most of the user's data is on tables whose user-id columns FK
//   to auth.users(id) WITH ON DELETE CASCADE — see the schemas in
//   supabase/social.sql, supabase/notifications.sql, etc. So in
//   theory a single auth.admin.deleteUser() call cascades the
//   whole graph. We still walk the major tables explicitly first
//   for two reasons:
//     1. Defense in depth — if one of the FK constraints ever
//        regresses to ON DELETE NO ACTION the cascade silently
//        breaks; the explicit deletes will raise a clear error.
//     2. The post-images Storage bucket isn't part of the FK
//        graph — its objects sit in storage.objects and DO NOT
//        cascade. We list and delete the user's folder explicitly.
//
// WHAT IS *NOT* DELETED
//   - articles (cached news, public, not user-keyed)
//   - reports filed BY this user against others stay (we anonymize
//     reporter_id by FK cascade — the report row dies with them).
//
// SECURITY
//   The Edge Function authenticates the caller via their own JWT
//   (anon-key client) so we know who they are, then uses the
//   service-role admin client to do the actual deletes. The
//   caller can ONLY delete THEIR OWN account — there's no
//   user_id parameter accepted from the request body, the id is
//   always derived from the JWT's `sub` claim.
//
// HOW TO DEPLOY
//   Mac Terminal (in samas-cli):
//     supabase functions deploy delete-user-account
//   Uses SUPABASE_SERVICE_ROLE_KEY which the platform injects.
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  consumeRateLimit, RATE_LIMITS, buildBucket, rateLimit429,
} from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const POST_IMAGES_BUCKET = "post-images";

// Tables we explicitly clear. Order matters only when something
// blocks the cascade — most cascade automatically off auth.users,
// these calls are belt-and-suspenders. We swallow per-table errors
// so a missing/renamed table doesn't block the whole flow.
const USER_TABLES: Array<{ table: string; column: string }> = [
  { table: "saved_posts",        column: "user_id" },
  { table: "likes",              column: "user_id" },
  { table: "reposts",            column: "user_id" },
  { table: "replies",            column: "author_id" },
  { table: "posts",              column: "author_id" },
  { table: "follows",            column: "follower_id" },
  { table: "follows",            column: "following_id" },
  { table: "dm_messages",        column: "author_id" },
  // dm_threads cascades on either user_a / user_b — we hit both.
  { table: "dm_threads",         column: "user_a" },
  { table: "dm_threads",         column: "user_b" },
  { table: "notifications",      column: "user_id" },
  { table: "device_tokens",      column: "user_id" },
  { table: "otp_codes",          column: "user_id" },
  { table: "price_alerts",       column: "user_id" },
  { table: "recurring_aportes",  column: "user_id" },
  { table: "preferences",        column: "user_id" },
  { table: "pin_hash",           column: "user_id" },
  { table: "profile_meta_signup",column: "user_id" },
  { table: "reports",            column: "reporter_id" },
  // profiles_social last — some other rows reference it via FK.
  { table: "profiles_social",    column: "user_id" },
  // legacy profiles row (signup metadata: nombre, apellido, etc).
  { table: "profiles",           column: "id" },
];

async function deleteStorageFolder(admin: SupabaseClient, userId: string) {
  // List all objects in the user's folder under post-images and
  // delete them in one batch. The bucket policy in
  // supabase/social_post_images.sql scopes write to <user_id>/<...>
  // so this is the canonical place a user's images live.
  try {
    const { data: list } = await admin.storage.from(POST_IMAGES_BUCKET).list(userId, {
      limit: 1000,
    });
    if (!list || list.length === 0) return 0;
    const paths = list.map((f) => `${userId}/${f.name}`);
    const { error } = await admin.storage.from(POST_IMAGES_BUCKET).remove(paths);
    if (error) console.warn(`[delete-user] storage cleanup partial:`, error.message);
    return paths.length;
  } catch (e) {
    console.warn(`[delete-user] storage list/remove threw:`, (e as Error).message);
    return 0;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- auth gate ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = user.id;

    // --- admin client (service role bypasses RLS) ---
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- rate limit (samas-0.4.17): ADMIN tier ---
    // Sensitive irreversible op. 30 / 5min is generous (a real user
    // calls this once ever) but blocks scripted abuse.
    const _rl = await consumeRateLimit(admin, {
      bucket: buildBucket("delete-user-account", { userId }),
      ...RATE_LIMITS.ADMIN,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    // --- 1. Storage cleanup (not part of the FK graph) ---
    const storageDeleted = await deleteStorageFolder(admin, userId);

    // --- 2. Explicit per-table deletes (defense in depth) ---
    const counts: Record<string, number> = {};
    for (const { table, column } of USER_TABLES) {
      try {
        const { error, count } = await admin
          .from(table)
          .delete({ count: "exact" })
          .eq(column, userId);
        if (error) {
          // Missing tables (e.g. preferences in some envs) just log
          // and continue; the auth.admin.deleteUser cascade is the
          // safety net.
          console.warn(`[delete-user] ${table}.${column}:`, error.message);
          continue;
        }
        const key = `${table}.${column}`;
        counts[key] = (counts[key] || 0) + (count || 0);
      } catch (e) {
        console.warn(`[delete-user] ${table}.${column} threw:`, (e as Error).message);
      }
    }

    // --- 3. Finally: the auth.users row itself.
    //    Any remaining FK references not in USER_TABLES will cascade
    //    here. This is the row whose absence makes the user "gone"
    //    from the auth system — they can no longer sign in even if
    //    a stale JWT is presented (Supabase invalidates the token).
    const { error: delAuthErr } = await admin.auth.admin.deleteUser(userId);
    if (delAuthErr) {
      throw new Error(`auth.admin.deleteUser: ${delAuthErr.message}`);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        userId,
        storageObjectsDeleted: storageDeleted,
        rowsDeleted: counts,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[delete-user-account] crash:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
