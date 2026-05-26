// ============================================================
// SEED SOCIAL — invoke the seed-social-demo Edge Function
// ============================================================
// The actual seeding lives server-side because creating auth.users
// rows AND inserting posts authored by them both require the
// service-role key (RLS clamps `auth.uid() = author_id` on every
// social write). See supabase/functions/seed-social-demo/index.ts
// for the heavy lifting and the idempotency contract.
//
// This module is just the thin client wrapper called from the
// "Sembrar red social" button in SettingsSheet.
// ============================================================

import { supabase } from "./supabase.js";

/**
 * seedSocialDemo() — populate the social tab with a curated set of
 * 12 fake AR-flavored users plus posts, replies, follows, likes,
 * reposts, and a few DMs to the caller.
 *
 * Returns the function's response object on success (counters for
 * each thing created) or throws on error. Idempotent — re-running
 * is a no-op rather than a duplicate-data hazard.
 */
export async function seedSocialDemo() {
  const { data, error } = await supabase.functions.invoke("seed-social-demo", {
    body: {},
  });
  if (error) {
    // supabase.functions.invoke wraps non-2xx responses in `error`;
    // try to surface the JSON body's message if present.
    const ctx = error?.context;
    let detail = "";
    try {
      const body = await ctx?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Seed falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Seed falló: ${data.error}`);
  return data;
}
