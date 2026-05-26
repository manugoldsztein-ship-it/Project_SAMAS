-- ============================================================
-- PIN HASH — store the 4-digit PIN per user, in the database
-- ============================================================
-- Originally the PIN was stored in device-local localStorage. Moving
-- it to the database means the same PIN works across all devices
-- (iPhone, iPad, web) once a user signs in — they don't have to
-- set up a new PIN per device.
--
-- Stored as SHA-256(("samas-pin:" + pin)), same scheme as the old
-- localStorage version. 4-digit PINs only have 10,000 combinations
-- so the hash is a mild obfuscation, not strong defense against a
-- determined attacker with DB access. The real security is:
--   1. RLS — only the user themselves can read their own pin_hash.
--   2. Even if cracked, the PIN alone does nothing — you need the
--      email + password to reach the PIN gate at all.
-- ============================================================

alter table public.profiles
  add column if not exists pin_hash text;

comment on column public.profiles.pin_hash is
  'SHA-256 hash of the user-chosen 4-digit PIN. null = not yet set. Read/written client-side via the authenticated user''s own row (RLS).';
