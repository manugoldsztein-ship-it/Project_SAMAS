// ============================================================
// export-user-data — App Store Guideline 5.1.1(v) compliance
// ============================================================
// Returns a JSON dump of every row in the database that's keyed
// to the authenticated user. The client receives this as a
// single JSON document with one key per source table; users can
// copy it to clipboard or save it via the iOS share sheet.
//
// WHAT GETS EXPORTED
//   profile + posts + replies + likes + reposts + follows +
//   saved_posts + dm_threads + dm_messages + notifications +
//   device_tokens + price_alerts + preferences + the legacy
//   profiles row. Reports filed BY this user are included so
//   they get the moderation history they sent. Pin hashes,
//   OTP codes, and cron-cycle internals are NOT included
//   (they're transient infrastructure, not user-meaningful).
//
// SECURITY
//   Same shape as delete-user-account: the user_id is derived
//   from the authenticated JWT, never from the request body.
//   The service-role client bypasses RLS so we can read across
//   tables that have row-level restrictions, but the WHERE
//   clauses still scope every query to the caller's user_id.
//   No way for caller A to export caller B's data.
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy export-user-data
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
  // samas-0.4.18 security headers
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

// Helper: select all rows from `table` where `column` = userId.
// Returns an empty array on error (logged) so a missing table
// doesn't blow up the whole export. We don't use ".single()" or
// ".maybeSingle()" anywhere — every section is an array even
// when there's at most one row, so the JSON shape stays
// predictable for downstream processing.
async function safeSelect(
  admin: SupabaseClient,
  table: string,
  column: string,
  userId: string,
): Promise<unknown[]> {
  try {
    const { data, error } = await admin.from(table).select("*").eq(column, userId);
    if (error) {
      console.warn(`[export] ${table}.${column}: ${error.message}`);
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn(`[export] ${table}.${column} threw:`, (e as Error).message);
    return [];
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

    // --- admin client (bypasses RLS for cross-table reads) ---
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- rate limit (samas-0.4.17): ADMIN tier ---
    // Heavy IO op (parallel queries across ~18 tables). Throttle to
    // 30 / 5min so a script can't spam this and DoS our DB.
    const _rl = await consumeRateLimit(admin, {
      bucket: buildBucket("export-user-data", { userId }),
      ...RATE_LIMITS.ADMIN,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    // Run every section's query in parallel — single round-trip
    // latency-wise, and the underlying postgres can handle a
    // dozen concurrent point queries on user_id without breaking
    // a sweat.
    const [
      profileSocial,
      profileLegacy,
      posts,
      replies,
      likes,
      reposts,
      follows,
      followers,
      savedPosts,
      threadsA,
      threadsB,
      dmMessages,
      notifications,
      deviceTokens,
      priceAlerts,
      recurringAportes,
      preferences,
      reports,
    ] = await Promise.all([
      safeSelect(admin, "profiles_social",      "user_id",      userId),
      safeSelect(admin, "profiles",             "id",           userId),
      safeSelect(admin, "posts",                "author_id",    userId),
      safeSelect(admin, "replies",              "author_id",    userId),
      safeSelect(admin, "likes",                "user_id",      userId),
      safeSelect(admin, "reposts",              "user_id",      userId),
      safeSelect(admin, "follows",              "follower_id",  userId),
      safeSelect(admin, "follows",              "following_id", userId),
      safeSelect(admin, "saved_posts",          "user_id",      userId),
      safeSelect(admin, "dm_threads",           "user_a",       userId),
      safeSelect(admin, "dm_threads",           "user_b",       userId),
      safeSelect(admin, "dm_messages",          "author_id",    userId),
      safeSelect(admin, "notifications",        "user_id",      userId),
      safeSelect(admin, "device_tokens",        "user_id",      userId),
      safeSelect(admin, "price_alerts",         "user_id",      userId),
      safeSelect(admin, "recurring_aportes",    "user_id",      userId),
      safeSelect(admin, "preferences",          "user_id",      userId),
      safeSelect(admin, "reports",              "reporter_id",  userId),
    ]);

    const out = {
      // Surfaced at the top so the user can read their identity
      // before the bulky lists below.
      _meta: {
        exportedAt: new Date().toISOString(),
        userId,
        email: user.email ?? null,
        appStoreCompliance: "Apple App Store Guideline 5.1.1(v)",
        format:  "JSON, all timestamps ISO-8601 UTC",
      },
      profile: {
        social: profileSocial[0] ?? null,
        legacy: profileLegacy[0] ?? null,
      },
      social: {
        posts,
        replies,
        likesGiven:    likes,
        repostsGiven:  reposts,
        following:     follows,
        followers,
        savedPosts,
        reportsFiled:  reports,
      },
      messages: {
        // Threads where the user is either side. Combined to make
        // the export self-contained without needing the user to
        // join two arrays mentally.
        threads:  [...threadsA, ...threadsB],
        messages: dmMessages,
      },
      notifications,
      device:   { tokens: deviceTokens },
      finance:  {
        priceAlerts,
        recurringAportes,
      },
      preferences: preferences[0] ?? null,
    };

    return new Response(JSON.stringify(out, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[export-user-data] crash:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
