// ============================================================
// rate-limit.ts (samas-0.4.16) — shared sliding-window rate limiter
// ============================================================
// Wraps the public.consume_rate_limit RPC. Returns a structured
// result so the caller can build a consistent 429 response.
//
// USAGE:
//
//   import { consumeRateLimit, RATE_LIMITS, rateLimit429 } from "../_shared/rate-limit.ts";
//
//   const rl = await consumeRateLimit(supabaseAdmin, {
//     bucket: `send-otp:user:${user.id}`,
//     ...RATE_LIMITS.AUTH,
//   });
//   if (!rl.allowed) return rateLimit429(rl, corsHeaders);
//
// THE PRESETS (RATE_LIMITS.*):
//
//   AUTH    — 5 / 15 min. send-otp, verify-otp. Manuel's spec.
//   AI      — 60 / 1 min. AI Edge Functions (analyze-portfolio,
//             chat-portfolio, etc.). Defense-in-depth on top of the
//             ai_usage_daily quota for SAMAS Plus accounts.
//   STD     — 120 / 1 min. Everything else. Generous, just blocks
//             trivial DoS / scraping.
//   ADMIN   — 30 / 5 min. delete-user-account, export-user-data.
//             Sensitive but rarely-called.
//
// BUCKET KEY GUIDELINES:
//
//   - Always include the function name as the prefix so different
//     functions don't share buckets: `send-otp:user:abc-123`.
//   - For authenticated routes use the user_id (post auth.getUser).
//   - For unauthenticated/cron routes use the IP from the request
//     headers via getRequestIp(req) below — falls back to "unknown"
//     so it still behaves (one shared bucket > no limit at all).
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export type RateLimitResult = {
  allowed: boolean;
  count: number;
  retryAfter: number;
};

export type RateLimitConfig = {
  bucket: string;
  limit: number;
  windowSec: number;
};

export const RATE_LIMITS = {
  AUTH:  { limit: 5,   windowSec: 15 * 60 },
  AI:    { limit: 60,  windowSec: 60      },
  STD:   { limit: 120, windowSec: 60      },
  ADMIN: { limit: 30,  windowSec: 5 * 60  },
} as const;

// Returns the best-effort client IP. Supabase puts it in x-forwarded-for
// (comma-separated, leftmost is the client). Edge Functions also expose
// cf-connecting-ip on Cloudflare-fronted projects.
export function getRequestIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return "unknown";
}

// Build a bucket key. `prefix` should be the function name (e.g.
// "send-otp"). Pass either userId OR ip — userId takes priority
// for authenticated routes (more accurate than IP behind NAT/CGN).
export function buildBucket(
  prefix: string,
  identity: { userId?: string | null; ip?: string | null },
): string {
  if (identity.userId) return `${prefix}:user:${identity.userId}`;
  return `${prefix}:ip:${identity.ip || "unknown"}`;
}

// Call the SECURITY DEFINER RPC. Pass the supabase admin client
// (service_role) — anonClient won't have permission to insert into
// public.rate_limits.
export async function consumeRateLimit(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  cfg: RateLimitConfig,
): Promise<RateLimitResult> {
  try {
    const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
      p_bucket:   cfg.bucket,
      p_limit:    cfg.limit,
      p_window_s: cfg.windowSec,
    });
    if (error) {
      // Fail OPEN on RPC errors — better to serve traffic than to
      // hard-deny everyone if the RPC is misconfigured. Log loudly so
      // we notice in the function logs.
      console.error("[rate-limit] RPC error, failing open:", error);
      return { allowed: true, count: 0, retryAfter: 0 };
    }
    const r = data || {};
    return {
      allowed: !!r.allowed,
      count: Number(r.count) || 0,
      retryAfter: Number(r.retry_after) || 0,
    };
  } catch (e) {
    console.error("[rate-limit] threw, failing open:", (e as Error).message);
    return { allowed: true, count: 0, retryAfter: 0 };
  }
}

// Convenience: build a 429 Response with retry-after header.
export function rateLimit429(
  rl: RateLimitResult,
  baseHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      retry_after: rl.retryAfter,
      message: `Demasiadas solicitudes. Probá de nuevo en ${rl.retryAfter}s.`,
    }),
    {
      status: 429,
      headers: {
        ...baseHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(rl.retryAfter),
      },
    },
  );
}

// Convenience constructor — most Edge Functions need one of these
// inside their `serve(...)` to talk to public.rate_limits.
export function makeAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
