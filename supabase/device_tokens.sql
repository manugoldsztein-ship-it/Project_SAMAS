-- ============================================================
-- DEVICE_TOKENS — APNs / FCM tokens for push notifications
-- ============================================================
-- One row per (user, device). Tokens come from
-- @capacitor/push-notifications' "registration" event after the user
-- grants iOS permission. The send-push Edge Function reads from this
-- table to find recipients.
--
-- Tokens rotate: iOS may issue a new APNs token after iCloud restore,
-- TestFlight install, or 'forget device'. We use the token itself as
-- the upsert key so the same physical device always maps to one row;
-- if the token changes, we just insert a new row and let the cron
-- prune stale ones (rows whose last_seen is > 90 days ago).
--
-- A user can have multiple tokens (iPhone + iPad + reinstalls), and
-- send-push fans out to all of them.
--
-- Privacy: rows are visible only to the owning user. The send-push
-- Edge Function uses the service_role key to bypass RLS.
-- ============================================================

create table if not exists public.device_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token       text not null,
  -- 'ios' | 'android' | 'web' — used by send-push to pick the correct
  -- transport (APNs vs FCM). Stored as text instead of an enum so we
  -- can add platforms without a migration.
  platform    text not null check (platform in ('ios', 'android', 'web')),
  -- Cosmetic, helps the user recognize devices in Settings.
  device_name text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  unique (token)
);

create index if not exists device_tokens_user
  on public.device_tokens (user_id);

create index if not exists device_tokens_last_seen
  on public.device_tokens (last_seen desc);

alter table public.device_tokens enable row level security;

-- A user can read their own tokens (so Settings can show "you have N
-- devices registered"), insert their own (registration), update their
-- own (refresh last_seen on app open), and delete their own (logout
-- or unregister).
drop policy if exists "device_tokens select own" on public.device_tokens;
create policy "device_tokens select own"
  on public.device_tokens
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "device_tokens insert own" on public.device_tokens;
create policy "device_tokens insert own"
  on public.device_tokens
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "device_tokens update own" on public.device_tokens;
create policy "device_tokens update own"
  on public.device_tokens
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "device_tokens delete own" on public.device_tokens;
create policy "device_tokens delete own"
  on public.device_tokens
  for delete
  to authenticated
  using (auth.uid() = user_id);

comment on table public.device_tokens is
  'Push notification tokens (APNs/FCM/web push) per (user, device). Used by the send-push Edge Function.';
comment on column public.device_tokens.token is
  'Raw token from the OS. Unique across the table — if the same token shows up for a different user, we treat it as a device handover and let the unique constraint update the user_id via UPSERT.';
comment on column public.device_tokens.last_seen is
  'Updated every time the app boots and finds the token still valid. Tokens older than 90 days are pruned by a cron.';
