// ============================================================
// ACCOUNT — client wrappers for the App Store self-service flows
// ============================================================
// Two thin wrappers around the matching Edge Functions. Both flows
// require the service role on the server side (deleting an
// auth.users row, reading across RLS-restricted tables) so neither
// can run client-side directly. This module is just the network
// glue + error normalization.
//
// See:
//   supabase/functions/delete-user-account/index.ts
//   supabase/functions/export-user-data/index.ts
// for the actual logic.
// ============================================================

import { supabase } from "./supabase.js";

/**
 * deleteAccount() — calls the delete-user-account Edge Function
 * for the currently-authenticated user. On success the auth.users
 * row is gone; we then explicitly sign the local session out so
 * the SamasShell's effects don't try to query as a deleted user
 * and hit RLS-blocked rows. Throws on any server error.
 */
export async function deleteAccount() {
  const { data, error } = await supabase.functions.invoke("delete-user-account", {
    body: {},
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Borrado falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Borrado falló: ${data.error}`);
  // Sign out locally so the next render doesn't try to query as a
  // deleted user. signOut() also clears the persisted session in
  // localStorage. Best-effort — if it throws we still return
  // success because the server-side deletion already happened.
  try { await supabase.auth.signOut(); } catch (_) {}
  return data;
}

/**
 * exportData() — calls the export-user-data Edge Function and
 * returns a JSON object containing every row keyed to the
 * authenticated user. Caller is responsible for surfacing the
 * data (download / share / clipboard) — this function only
 * fetches and parses.
 *
 * Returns the parsed export object directly (top-level keys:
 * _meta, profile, social, messages, notifications, device,
 * finance, preferences).
 */
export async function exportData() {
  const { data, error } = await supabase.functions.invoke("export-user-data", {
    body: {},
  });
  if (error) {
    let detail = "";
    try {
      const body = await error?.context?.json?.();
      if (body?.error) detail = `: ${body.error}`;
    } catch (_) { /* fall through */ }
    throw new Error(`Exportación falló${detail || ": " + (error.message || "error desconocido")}`);
  }
  if (data?.error) throw new Error(`Exportación falló: ${data.error}`);
  return data;
}
