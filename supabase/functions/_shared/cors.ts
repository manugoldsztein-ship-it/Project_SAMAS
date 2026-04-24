// Shared CORS headers for every Edge Function. The browser sends a
// preflight OPTIONS request before the real call, and without these
// headers the fetch from the client fails with a CORS error.
//
// `*` on the origin is fine for our case because the functions
// themselves check the user's Supabase JWT — the actual authorization
// happens at the function body level, not at the CORS layer. If we
// ever lock this down we'd swap to an explicit allow-list.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
