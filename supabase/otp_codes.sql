-- ============================================================
-- OTP CODES TABLE
-- ============================================================
-- Stores server-generated OTP codes for WhatsApp verification.
-- Replaces the need for Twilio Verify service — we manage codes
-- ourselves so the WhatsApp Sandbox (messaging API) works on a
-- trial account without "Verified Caller IDs" restrictions.
--
-- Flow:
--   1. User requests OTP → Edge Function generates a 6-digit code,
--      hashes it, stores the hash in this table with a 10-min TTL.
--   2. Edge Function sends the plain code via Twilio Messaging API
--      to the user's WhatsApp (via sandbox).
--   3. User submits code → Edge Function hashes it and compares
--      against the stored hash. On match: marks phone_verified.
--
-- Security:
--   - RLS enabled with ZERO policies → client access is denied.
--   - Only server-side code using the service_role key can read
--     or write this table (bypasses RLS).
--   - Codes are hashed (SHA-256) so even if someone accessed the
--     table, they couldn't brute-force the plain code in a
--     meaningful way within the 10-minute TTL.
--   - user_id is the PK → only one active OTP per user at a time.
--     Requesting a new code invalidates the old one.
-- ============================================================

create table if not exists public.otp_codes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  phone      text not null,
  code_hash  text not null,
  expires_at timestamptz not null,
  attempts   integer not null default 0,
  created_at timestamptz default now()
);

alter table public.otp_codes enable row level security;

-- No policies on purpose. RLS enabled + no policies = default deny
-- for all anon/authenticated clients. Only the service_role (used
-- by Edge Functions) can read/write.

create index if not exists otp_codes_user_phone_idx
  on public.otp_codes(user_id, phone);
