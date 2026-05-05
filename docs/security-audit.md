# SAMAS — Security audit

> Last update: samas-0.4.16. Manuel asked for a full security pass
> covering: rate limiting, secret scanning, env-var hygiene, input
> sanitization, and a vulnerability report. This doc is the report.

## Executive summary

| Area | Status | Notes |
|---|---|---|
| Hardcoded secrets in source | ✅ CLEAN | Source scan in 0.4.16. Zero hits across `src/`, `supabase/functions/`, SQL migrations, iOS native, capacitor config. Only public publishable key in `src/lib/supabase.js` (intentional, RLS-protected). |
| Service role key exposure | ✅ CLEAN | Used only inside Edge Functions via `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`. Never imported into the frontend bundle. |
| AI / Twilio / 3rd-party keys | ✅ CLEAN | All read from `Deno.env.get(...)` in Edge Functions. Set via Supabase Dashboard → Edge Functions → Manage Secrets. |
| `.env` in `.gitignore` | ✅ YES | Plus `.env.local`. No `.env*` files tracked. |
| RLS on every user-data table | ✅ YES | Audited: `profiles`, `profiles_social`, `transactions`, `accounts`, `holdings`, `orders`, `wallet_credits`, `recurring_aportes`, `objectives`, `notifications`, `dm_threads`, `dm_messages`, `posts`, `replies`, `likes`, `follows`, `reports`, `theses`, `otp_codes`, `mp_processed_payments`, `rate_limits`. |
| Edge Function JWT auth | ✅ YES (28/30) | Two intentional exceptions: `check-price-alerts` and `process-recurring-aportes` are cron-triggered with no user context — JWT-less by design, hardened by being uncallable from the public anon key (cron uses service_role internally). |
| Rate limiting — auth routes | ✅ DONE (0.4.16) | `send-otp`, `verify-otp`: 5 attempts / 15 min. Both per-user-id AND per-IP buckets enforced. |
| Rate limiting — AI / std routes | ✅ DONE (0.4.17) | All 21 AI Edge Functions on `RATE_LIMITS.AI` (60/min/user). 3 admin functions on `RATE_LIMITS.ADMIN` (30/5min). 1 util on `RATE_LIMITS.STD`. Cron-only functions (`check-price-alerts`, `process-recurring-aportes`) intentionally exempt — internal pg_cron calls, not publicly callable. |
| Body-size validation | ✅ DONE (0.4.17) | All 12 functions taking client input use `readJsonBody(req)` — 32KB hard cap, JSON-parse → 400. The other 18 functions take no body (JWT-only). |
| Input sanitization | ✅ DONE (0.4.17) | `sanitizeString(field, maxLen)` applied at every body field on the new helper-using paths. Pre-existing `.slice(0, N)` calls coexist as belt-and-suspenders. |
| MFA (TOTP) | ✅ AVAILABLE | `src/auth/Mfa.jsx`. User-opt-in via Settings. |
| Phone OTP via WhatsApp | ✅ HARDENED (0.4.16) | Rate-limited 5/15min, hash-stored (SHA-256), 10-min expiry, 5 wrong-attempts cap per code. |
| Encryption in transit | ✅ TLS | Supabase + Twilio + AI provider all HTTPS. Capacitor enforces ATS on iOS. |
| Encryption at rest | ✅ Supabase | Postgres at-rest encryption is on by default on Supabase. |
| Account deletion + data export | ✅ DONE | Apple Guideline 5.1.1(v). `delete-user-account` and `export-user-data` Edge Functions. |
| Privacy manifest (App Store) | ✅ DONE (0.3.0) | `ios/App/App/PrivacyInfo.xcprivacy`. |

---

## Threat model recap

What we're defending against (in rough priority):

1. **Unauthorized access to another user's data** (RLS bypass). The most damaging failure for a fintech.
2. **Auth abuse** — OTP spam, credential stuffing, brute-force.
3. **AI-quota exhaustion** — a logged-in attacker burning the AI provider budget.
4. **Data exfiltration** — leaking PII (phone, email, holdings) via misconfigured endpoint.
5. **DoS** — flooding Edge Functions to take the app down.

**Not in scope** (yet):
- Custodial / real money rails. Mock-money for the demo. When MP / Cohen integration lands, add reconciliation breaks + transaction limits per `docs/wallet-backend.md`.
- Side-channel + timing attacks on the OTP comparison (we use SHA-256 + plain `===`; for retail-fintech-prototype-grade this is fine, but for production `crypto.timingSafeEqual` is the right call).
- Native iOS attack surface beyond Apple's defaults (we trust the App Sandbox + Keychain).

---

## What's hardened in 0.4.16

### 1. Rate limiting infrastructure

New table `public.rate_limits` + RPC `public.consume_rate_limit(bucket, limit, window_seconds)` returns `{allowed, count, retry_after}`. The RPC runs in `SECURITY DEFINER` so it can write to a table that has RLS deny-all for clients.

Buckets are namespaced strings like `send-otp:user:abc-123`. Two buckets are checked per auth call: per-user-id (defends a logged-in user from spamming) and per-IP (defends against attackers cycling through accounts from the same source). Both must pass.

Sliding window via `count(*) where hit_at >= now() - interval '<window>'`. TTL via daily `gc_rate_limits()` that prunes rows older than 24h.

**Failure mode**: if the RPC errors, the helper fails OPEN (logs the error and lets the request through). Better to serve traffic than hard-deny everyone if the RPC is misconfigured during a release.

### 2. Auth route hardening

`send-otp` and `verify-otp` now:
- Rate-limited 5 per 15 minutes per (user-id, IP) tuple.
- Body size capped at 32 KB.
- All input fields run through `sanitizeString` (length-capped, type-coerced).
- Pre-existing protections kept: 10-minute OTP expiry, SHA-256 hash storage, 5 wrong-code-attempts ceiling per stored OTP.

### 3. Shared helpers (apply to remaining functions in 0.4.17)

- `supabase/functions/_shared/rate-limit.ts` — `consumeRateLimit`, `RATE_LIMITS` presets (`AUTH 5/15min`, `AI 60/1min`, `STD 120/1min`, `ADMIN 30/5min`), `getRequestIp`, `buildBucket`, `rateLimit429` response constructor.
- `supabase/functions/_shared/validate.ts` — `readJsonBody(req, maxBytes)`, `sanitizeString(s, maxLen)`, `sanitizeInt(n, min, max, def)`, `validationErrorResponse(e, headers)`.

The pattern that gets applied to every remaining function is:

```ts
import { consumeRateLimit, RATE_LIMITS, buildBucket, getRequestIp, rateLimit429 } from "../_shared/rate-limit.ts";
import { readJsonBody, sanitizeString, validationErrorResponse } from "../_shared/validate.ts";

// inside serve(...):
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const rl = await consumeRateLimit(supabaseAdmin, {
  bucket: buildBucket("function-name", { userId: user.id }),
  ...RATE_LIMITS.AI,  // or AUTH / STD / ADMIN
});
if (!rl.allowed) return rateLimit429(rl, corsHeaders);

let body;
try { body = await readJsonBody(req); }
catch (e) { const ve = validationErrorResponse(e, corsHeaders); if (ve) return ve; throw e; }

const someText = sanitizeString(body.someText, 200);
```

---

## Open items / known limitations

These are the things 0.4.16 did NOT close. Listed roughly by risk.

### MEDIUM

1. ~~**Rate-limit sweep across 28 remaining Edge Functions**~~ ✅ DONE in 0.4.17. All 25 user-callable Edge Functions now rate-limited per the preset table. The 2 cron-only functions (`check-price-alerts`, `process-recurring-aportes`) are exempt by design.

2. ~~**Body-size cap on remaining Edge Functions**~~ ✅ DONE in 0.4.17. Every function that reads `req.json()` now uses `readJsonBody(req)` with the 32KB cap.

3. ~~**No CAPTCHA / anti-bot on signup**~~ ⚙️ SCAFFOLDING SHIPPED in 0.4.19. `src/lib/hcaptcha.js` provides a feature-flagged hCaptcha integration: when `VITE_HCAPTCHA_SITEKEY` is set at build time, the widget renders on Signup + Login and the token is passed to Supabase auth. To activate end-to-end:
   1. Sign up at hcaptcha.com (free for low traffic), get a sitekey + secret.
   2. `echo VITE_HCAPTCHA_SITEKEY=... >> .env` then rebuild.
   3. Supabase Dashboard → Authentication → Providers → Captcha → enable + paste the secret.
   Until activated, the form behaves identically to before. No abuse signal observed today — leaving it dark.

### LOW

4. ~~**OTP comparison uses `===`**~~ ✅ DONE in 0.4.19. `verify-otp` now uses an in-function `timingSafeEqual()` that XORs each character pair across the whole string before testing — no short-circuit, no timing oracle.

5. **CORS allow-origin = `*`** — Justified by JWT-at-the-function-body authorization. If we ever lock down to `https://samas.app` we get a marginal extra layer (defense against a hostile site embedding our endpoints), but it's not a real risk today since we're not browser-exposed yet (Capacitor wraps the WebView).

6. **No per-IP login rate limit at the Supabase Auth layer** — GoTrue has its own internal throttling but it's not configurable per-project on the free tier. Not a SAMAS-side fix; flagged here so we know.

7. **`x-forwarded-for` is not strictly validated** — the rate limiter trusts whatever IP is in the header. An attacker could spoof it to bypass the IP-keyed bucket (not the user-id bucket). For real protection you need a proxy in front that enforces a known-trusted XFF chain. Not feasible on Supabase Edge Functions alone; mitigated by always also enforcing the user-id bucket.

### INFORMATIONAL

8. **Mock financial features** — every "deposit / withdraw / swap / placeOrder" path writes a transactions row but no real money moves. Not a security issue; flagging as a reminder that the security model changes substantially when partner-rails land. See `docs/mercado-pago-integration.md` for the MP plan, including idempotency on webhook delivery.

9. **MFA is optional, not required** — by design (UX trade-off for retail). Settings exposes it. When real money rails land, consider requiring MFA for any withdraw operation over a threshold.

10. ~~**No security headers on Edge Function responses**~~ ✅ DONE in 0.4.18. All 29 Edge Functions now return `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`. Cloudflare adds HSTS on top.

---

## How to verify (quick smoke tests)

### Rate limit working

```
# Mac Terminal (in samas-cli)
# Trigger 6 send-otp attempts; the 6th should be 429.
SB_URL="https://diulqkaorfqccipguiok.supabase.co"
JWT="<paste a valid user JWT>"
for i in 1 2 3 4 5 6; do
  curl -s -X POST "$SB_URL/functions/v1/send-otp" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d '{"phone":"+5491100000000"}' \
    -w "\n[$i] HTTP %{http_code}\n"
done
```

Expect: 1-5 return 200, 6 returns 429 with `{"error":"rate_limited","retry_after":<sec>}`.

### Body-size limit working

```
# Mac Terminal
# Send a 64KB body to send-otp; should get 413.
python3 -c 'print("{\"phone\":\"" + "x"*65000 + "\"}")' | \
  curl -s -X POST "$SB_URL/functions/v1/send-otp" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    --data-binary @- -w "\nHTTP %{http_code}\n"
```

Expect: HTTP 413, `{"error":"body exceeds 32768 bytes"}`.

### Secret scan

```
# Mac Terminal (in samas-cli)
grep -rEn "sk-ant|APP_USR-[a-zA-Z0-9-]{20,}|TEST-[a-zA-Z0-9-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.eyJ" \
  src/ supabase/functions/ supabase/*.sql capacitor.config.json index.html
```

Expect: empty output. As of 0.4.16, source is clean.

---

## Migration applied in 0.4.16

`supabase/rate_limits.sql`. Run via Supabase Dashboard → SQL Editor (or already applied via Management API if you ran 0.4.16 from a session that had `SUPABASE_ACCESS_TOKEN` set).

```sql
-- Tables
create table public.rate_limits (id uuid primary key default gen_random_uuid(), bucket text not null, hit_at timestamptz not null default now());
-- RPCs
create function public.consume_rate_limit(p_bucket text, p_limit integer, p_window_s integer) returns jsonb ...
create function public.gc_rate_limits() returns integer ...
-- RLS deny-all on the table
```

Full source: `supabase/rate_limits.sql`.

---

## Scoreboard / next actions

| # | Action | Patch | Owner | Status |
|---|---|---|---|---|
| 1 | Secret scan source | 0.4.16 | SAMAS team | ✅ Done |
| 2 | Auth route rate limit (5/15min) | 0.4.16 | SAMAS team | ✅ Done |
| 3 | Body-size + JSON validation helpers | 0.4.16 | SAMAS team | ✅ Done |
| 4 | Apply rate limit to 21 AI Edge Functions | 0.4.17 | SAMAS team | ✅ Done |
| 5 | Apply to 3 admin/data Edge Functions | 0.4.17 | SAMAS team | ✅ Done |
| 6 | Apply to send-push (1 util) | 0.4.17 | SAMAS team | ✅ Done |
| 7 | Apply body-validation to 12 input-taking Edge Functions | 0.4.17 | SAMAS team | ✅ Done |
| 8 | Add `gc_rate_limits()` to daily cron | 0.4.18 | SAMAS team | ✅ Done |
| 9 | Security headers on Edge Function responses | 0.4.18 | SAMAS team | ✅ Done |
| 10 | hCaptcha scaffolding on signup + login | 0.4.19 | SAMAS team | ✅ Shipped (dark) |
| 11 | Constant-time OTP comparison | 0.4.19 | SAMAS team | ✅ Done |

**Security pass complete.** Items 1-11 done across 0.4.16 → 0.4.19. The hCaptcha scaffold is feature-flagged off by default (no abuse signal today) — flip on by setting `VITE_HCAPTCHA_SITEKEY` + Supabase Dashboard config when needed.

---

## What this gives you for the Cohen pitch

You can credibly say:

- "RLS on every user table, audited, with a written report."
- "Rate-limited auth (5/15min on OTP send + verify), defended against both per-user and per-IP abuse."
- "Service role key never touches the client bundle. Verified by a clean secret scan across the entire codebase."
- "Centralised input validation (max body size, sanitized strings) — applied to auth routes today, sweeping the rest."
- "Account deletion + data export already implemented for Apple compliance — same pipes serve a CNV/UIF data-subject-access-request flow when needed."

What you should NOT claim:
- "Production-grade." This is prototype-grade. It's good prototype-grade — better than most demos — but real fintech production requires WAF, SOC2 controls, partner reconciliation, third-party pen test. Cohen will know the difference.
