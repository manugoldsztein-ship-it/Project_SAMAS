// ============================================================
// send-push — fan out a push notification to a user's iOS devices
// ============================================================
// Body (JSON):
//   {
//     userId: "uuid",
//     title:  "AAPL hit 200",
//     body:   "Tu alerta se disparó · USD 200.34",
//     data:   { kind: "alert", ticker: "AAPL", alertId: "..." }   // optional
//   }
//
// Behaviour:
//   1. Look up every device_tokens row for userId where platform='ios'.
//   2. Sign an ES256 JWT for APNs (cached for ~50 minutes — the spec
//      allows up to 60, we leave a 10-minute safety margin).
//   3. POST a notification to api.push.apple.com for each token via
//      HTTP/2. Deno's fetch supports HTTP/2 transparently.
//   4. If APNs returns 410 (Unregistered) or 400 BadDeviceToken, drop
//      the row from device_tokens — that token is dead and would just
//      cost us API calls.
//
// Secrets required:
//   APNS_TEAM_ID        — Apple Developer Team ID (10 chars, e.g. AB12CD34EF)
//   APNS_KEY_ID         — the .p8 key's ID (10 chars, shown when you
//                         created it on developer.apple.com)
//   APNS_PRIVATE_KEY    — the .p8 file contents, including the
//                         "-----BEGIN PRIVATE KEY-----" lines, as a
//                         single string (newlines preserved or \n).
//   APNS_BUNDLE_ID      — your iOS bundle id (e.g. app.samas.broker)
//   APNS_USE_SANDBOX    — "true" while in dev/TestFlight, "false" in
//                         production. Sandbox URL =
//                         api.sandbox.push.apple.com; prod =
//                         api.push.apple.com.
//   SUPABASE_SERVICE_ROLE_KEY — auto-provisioned
//
// Caller auth:
//   The function accepts both authenticated user calls (their JWT in
//   Authorization, userId must equal auth.uid()) and service-role
//   calls (used by check-price-alerts, no auth.uid() restriction).
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
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

const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "";
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
const APNS_PRIVATE_KEY = (Deno.env.get("APNS_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID") ?? "app.samas.broker";
const APNS_USE_SANDBOX = (Deno.env.get("APNS_USE_SANDBOX") ?? "true").toLowerCase() === "true";
const APNS_HOST = APNS_USE_SANDBOX
  ? "https://api.sandbox.push.apple.com"
  : "https://api.push.apple.com";

const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// ----- JWT signing (ES256) -----
// APNs accepts a single bearer token signed with your .p8 key. We cache
// it for ~50 minutes and re-sign on the next call past expiry.

let cachedJwt: { token: string; expiresAt: number } | null = null;

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function base64UrlEncode(input: string | Uint8Array): string {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = input;
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.expiresAt > now + 60) return cachedJwt.token;

  if (!APNS_TEAM_ID || !APNS_KEY_ID || !APNS_PRIVATE_KEY) {
    throw new Error("APNs env vars missing (TEAM_ID / KEY_ID / PRIVATE_KEY)");
  }

  const header = base64UrlEncode(JSON.stringify({
    alg: "ES256",
    kid: APNS_KEY_ID,
    typ: "JWT",
  }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: APNS_TEAM_ID,
    iat: now,
  }));
  const unsigned = `${header}.${payload}`;

  const keyBuf = pemToArrayBuffer(APNS_PRIVATE_KEY);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBuf,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    cryptoKey,
    new TextEncoder().encode(unsigned),
  );
  const sig = base64UrlEncode(new Uint8Array(sigBuf));
  const token = `${unsigned}.${sig}`;
  cachedJwt = { token, expiresAt: now + 50 * 60 };
  return token;
}

// ----- APNs HTTP/2 send -----
async function sendToApns(
  token: string,
  jwt: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; reason?: string }> {
  const url = `${APNS_HOST}/3/device/${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": `bearer ${jwt}`,
      "apns-topic": APNS_BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (res.ok) return { ok: true, status: res.status };
  let reason: string | undefined;
  try {
    const body = await res.json();
    reason = body?.reason;
  } catch { /* ignore */ }
  return { ok: false, status: res.status, reason };
}

// ----- handler -----
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const body = await req.json();
    const userId: string | undefined = body?.userId;
    const title: string = body?.title ?? "SAMAS";
    const message: string = body?.body ?? "";
    const data: Record<string, unknown> = body?.data ?? {};

    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // Service-role client so we can read every user's tokens and prune
    // dead ones regardless of which JWT called us.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // If a user JWT is present, restrict to their own userId. The
    // check-price-alerts cron uses service role and bypasses this.
    const authHeader = req.headers.get("authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      const userJwt = authHeader.slice("Bearer ".length);
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
        global: { headers: { Authorization: `Bearer ${userJwt}` } },
      });
      const { data: u } = await userClient.auth.getUser();
      const callerId = u?.user?.id;
      // If a real user is calling, they can only push to themselves.
      // The cron uses the service role key with no Authorization header,
      // which lands here as no callerId — allowed.
      if (callerId && callerId !== userId) {
        return new Response(JSON.stringify({ error: "userId mismatch" }), {
          status: 403, headers: { ...corsHeaders, "content-type": "application/json" },
        });
      }
      // Rate limit user-initiated pushes. Service-role/cron path
      // skipped (callerId === undefined). samas-0.4.17.
      if (callerId) {
        const _rl = await consumeRateLimit(admin, {
          bucket: buildBucket("send-push", { userId: callerId }),
          ...RATE_LIMITS.STD,
        });
        if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);
      }
    }

    const { data: rows, error } = await admin
      .from("device_tokens")
      .select("id, token, platform")
      .eq("user_id", userId)
      .eq("platform", "ios");
    if (error) throw error;
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ status: "no-devices", sent: 0 }), {
        status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const jwt = await signApnsJwt();
    const apnsPayload = {
      aps: {
        alert: { title, body: message },
        sound: "default",
        // 'mutable-content' lets a Notification Service Extension
        // modify the payload (e.g. inject an image). We don't use one
        // yet; harmless to leave on so future-us can.
        "mutable-content": 1,
      },
      ...data,
    };

    let sent = 0;
    let pruned = 0;
    const errors: Array<{ token: string; reason?: string }> = [];

    // Fan out sequentially to keep Deno's network state simple. APNs
    // is fast (~30ms per call) and a single user rarely has more than
    // a handful of devices, so parallelizing would save tens of ms at
    // most.
    for (const row of rows) {
      const r = await sendToApns(row.token, jwt, apnsPayload);
      if (r.ok) {
        sent++;
        // Update last_seen so the prune-cron won't drop this token.
        await admin.from("device_tokens")
          .update({ last_seen: new Date().toISOString() })
          .eq("id", row.id);
        continue;
      }
      // 410 = Unregistered (user deleted the app or restored from
      // backup). 400 with reason BadDeviceToken means the same.
      if (r.status === 410 || r.reason === "BadDeviceToken" ||
          r.reason === "Unregistered" || r.reason === "DeviceTokenNotForTopic") {
        await admin.from("device_tokens").delete().eq("id", row.id);
        pruned++;
        continue;
      }
      errors.push({ token: row.token.slice(0, 8) + "…", reason: r.reason });
    }

    return new Response(JSON.stringify({
      status: "ok", sent, pruned, errors,
    }), {
      status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[send-push]", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
