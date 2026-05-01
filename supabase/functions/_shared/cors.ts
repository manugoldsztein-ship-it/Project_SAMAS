// Shared CORS + security headers for every Edge Function.
//
// The CORS preamble is required because the iOS WebView and any
// browser client send a preflight OPTIONS before the real call.
// `*` on the origin is fine for our threat model — actual
// authorization happens at the function body level (JWT check),
// not at the CORS layer. If we ever lock this down we'd swap to
// an explicit allow-list.
//
// SECURITY HEADERS (samas-0.4.18) — added to defense-in-depth:
//   - X-Content-Type-Options: nosniff
//     Prevents browsers from MIME-sniffing a JSON response into
//     something executable. Cheap, no downside.
//   - Cache-Control: private, no-store
//     Authenticated API responses should never be cached by
//     intermediaries or by the WebView's HTTP cache. Stops a
//     stale token / stale balance from leaking via a shared cache.
//   - Referrer-Policy: no-referrer
//     If a response ever ends up navigated-to in a browser, don't
//     leak the function URL via the Referer header.
//   - X-Frame-Options: DENY
//     Belt-and-suspenders against clickjacking. JSON responses
//     can't really be framed but it's free.
//
// Functions can spread `corsHeaders` into their Response init's
// `headers` object — same pattern as before, the new headers come
// along for free.

export const corsHeaders = {
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
