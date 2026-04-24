// ============================================================
// SUPABASE CLIENT — single shared instance for the whole app
// ============================================================
// The URL and publishable key are intentionally hardcoded here.
// Both values are safe to ship client-side: the publishable key
// (sb_publishable_...) is the new format that replaced the anon
// JWT — it's meant to be bundled with the front-end, and all
// actual data access is gated by Postgres Row Level Security
// (see the SQL migration in supabase/schema.sql).
//
// If you ever rotate the project, swap both values here and the
// whole app picks up the new target on next build.
//
// NEVER put the secret_key (sb_secret_...) here. That one
// bypasses RLS and is admin-level; it only lives on the server
// side (Edge Functions, scripts, future API proxy).

import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://diulqkaorfqccipguiok.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_qOP-a__qtrDdE_b_u1M70w_dd035D6O";

// createClient is resilient by design — a bad URL or key won't throw here,
// only the actual network calls fail later. Wrapping in try/catch just in
// case the bundled SDK hits an edge case when loaded from file:// origin.
let _supabase;
try {
  _supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      // Persist session across reloads (JWT in localStorage, refresh
      // handled automatically by the SDK).
      persistSession: true,
      autoRefreshToken: true,
      // Disable URL detection — on file:// origin, parsing window.location
      // for auth tokens can trigger odd edge cases. We set it to true only
      // once we're running under http(s).
      detectSessionInUrl: false,
    },
  });
  console.log("[SAMAS] Supabase client initialized:", SUPABASE_URL);
} catch (err) {
  console.error("[SAMAS] Supabase createClient failed:", err);
  // Provide a stub so the rest of the app can load even if Supabase fails.
  // Every call returns an error-shaped response so the UI can still mount.
  _supabase = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: err }),
      getUser: async () => ({ data: { user: null }, error: err }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signUp: async () => ({ data: null, error: err }),
      signInWithPassword: async () => ({ data: null, error: err }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: err }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: err }) }) }),
      update: () => ({ eq: async () => ({ error: err }) }),
    }),
    supabaseUrl: SUPABASE_URL,
  };
}
export const supabase = _supabase;

// Small convenience helper for the parts of the UI that only care
// whether the user is logged in. Returns the current user or null.
export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

// Subscribe to auth state changes. React components should call this
// inside a useEffect and tear down the returned subscription on unmount.
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return () => data.subscription.unsubscribe();
}
