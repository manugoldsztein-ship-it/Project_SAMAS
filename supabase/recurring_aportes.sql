-- ============================================================
-- RECURRING_APORTES — scheduled monthly contributions
-- ============================================================
-- Replaces the localStorage mock in src/v2/api/wallet.js. A row
-- represents "deposit {amount} {currency} on day {day_of_month} of
-- every month". The process-recurring-aportes cron runs daily, finds
-- rows whose next_due is today (in Argentina/Buenos_Aires time), credits
-- the user's wallet via wallet_credits insert, and advances next_due
-- by one month.
--
-- Why next_due as DATE (not TIMESTAMPTZ): contributions are scheduled
-- in calendar-day terms ("the 5th of each month"), independent of
-- exact wall-clock time. The cron interprets a row as "due" when
-- next_due <= current_date in AR time. This avoids DST headaches and
-- makes the SQL query trivial.
--
-- day_of_month is capped at 28 to dodge the Feb 30/31 question. If we
-- ever want to support "last day of month", that's a separate flag.
-- ============================================================

create table if not exists public.recurring_aportes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  amount            numeric(18, 2) not null check (amount > 0),
  currency          text not null check (currency in ('ARS', 'USD')),
  -- Day of month (1-28). Capped at 28 so the schedule fires every
  -- month without skipping February. If a user picks 29-31 we clamp
  -- to 28 client-side.
  day_of_month      integer not null check (day_of_month between 1 and 28),
  -- Calendar date the next contribution should fire. Stored in AR
  -- time. Recomputed by the cron on each successful credit.
  next_due          date not null,
  -- The last successful credit, used to:
  --   (a) keep the cron idempotent if it re-fires within the same day;
  --   (b) surface "último aporte" in the UI.
  last_credited_at  timestamptz,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  -- One active aporte per user. If the user wants two (one ARS, one
  -- USD), we lift this in a follow-up. v1 keeps the model simple.
  unique (user_id) deferrable initially deferred
);

create index if not exists recurring_aportes_due
  on public.recurring_aportes (next_due)
  where active = true;

alter table public.recurring_aportes enable row level security;

drop policy if exists "recurring_aportes select own" on public.recurring_aportes;
create policy "recurring_aportes select own"
  on public.recurring_aportes
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "recurring_aportes insert own" on public.recurring_aportes;
create policy "recurring_aportes insert own"
  on public.recurring_aportes
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "recurring_aportes update own" on public.recurring_aportes;
create policy "recurring_aportes update own"
  on public.recurring_aportes
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "recurring_aportes delete own" on public.recurring_aportes;
create policy "recurring_aportes delete own"
  on public.recurring_aportes
  for delete
  to authenticated
  using (auth.uid() = user_id);

comment on table public.recurring_aportes is
  'User-scheduled monthly contributions. Polled by the process-recurring-aportes cron. One active aporte per user.';
comment on column public.recurring_aportes.next_due is
  'Calendar date of the next contribution in Argentina/Buenos_Aires time.';
comment on column public.recurring_aportes.last_credited_at is
  'Timestamp of the most recent successful credit. Cron uses this for idempotency.';

-- ----------------------------------------------------------
-- WALLET_CREDITS — append-only ledger of off-app credits
-- ----------------------------------------------------------
-- The cron writes one row per successful aporte fire. The frontend
-- reads it for the "Movimientos" list (alongside on-app transfers /
-- card swipes). Keeping a separate ledger from the existing
-- transactions table because the wallet state lives client-side
-- (localStorage) for now — when we move that to Supabase, we'll
-- merge.
--
-- A future production-grade flow would also write a real bank-side
-- transaction record; for the demo, the credit is symbolic.
-- ============================================================

create table if not exists public.wallet_credits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  source        text not null check (source in ('aporte_recurring', 'manual')),
  amount        numeric(18, 2) not null check (amount > 0),
  currency      text not null check (currency in ('ARS', 'USD')),
  note          text,
  -- Which aporte fired this credit (null for manual top-ups).
  aporte_id     uuid references public.recurring_aportes(id) on delete set null,
  credited_at   timestamptz not null default now()
);

create index if not exists wallet_credits_user_recent
  on public.wallet_credits (user_id, credited_at desc);

alter table public.wallet_credits enable row level security;

drop policy if exists "wallet_credits select own" on public.wallet_credits;
create policy "wallet_credits select own"
  on public.wallet_credits
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Inserts only via service_role (the cron). No user-side INSERT
-- policy on purpose.
