-- ============================================================
-- PRICE_ALERTS — user-configured price triggers
-- ============================================================
-- Replaces the localStorage-only mock that lived in src/v2/api/broker.js.
-- A row represents "notify me when <ticker>'s price goes <direction>
-- <target_price>". Once fired, we set fired_at and stop checking.
--
-- The check-price-alerts Edge Function (cron, runs every 1-2 minutes
-- during market hours) queries the active rows, fetches current
-- quotes, and calls send-push for any that match.
--
-- Why a separate fired_at column instead of deleting on fire: users
-- want to see the history ("you got pinged 3 days ago when AAPL hit
-- 200"). The Settings screen lists fired alerts under a "Recientes"
-- section.
-- ============================================================

create table if not exists public.price_alerts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  ticker       text not null,
  -- 'above' | 'below'. We store the direction explicitly rather than
  -- inferring from a signed delta because users tend to think of it
  -- that way ("alerta cuando suba a 200" vs "cuando baje a 150").
  direction    text not null check (direction in ('above', 'below')),
  target_price numeric(18, 6) not null,
  -- The currency the target_price is denominated in. ARS-listed CEDEARs
  -- are tracked in ARS; foreign equities in USD. The check-price-alerts
  -- function compares against the matching quote field.
  currency     text not null default 'USD' check (currency in ('USD', 'ARS')),
  -- Cosmetic note the user can attach ("comprar más si baja"). Not
  -- used for matching.
  note         text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  fired_at     timestamptz,
  -- Snapshot of the quote at fire-time, so the history view can show
  -- "AAPL hit $201.34" without re-fetching historical quotes.
  fired_price  numeric(18, 6)
);

create index if not exists price_alerts_user_active
  on public.price_alerts (user_id, active);

-- Hot path index for the cron: only scan rows that haven't fired yet
-- and are still active. Once a row's active=false, it's invisible to
-- the matcher.
create index if not exists price_alerts_unfired
  on public.price_alerts (ticker)
  where active = true and fired_at is null;

alter table public.price_alerts enable row level security;

drop policy if exists "price_alerts select own" on public.price_alerts;
create policy "price_alerts select own"
  on public.price_alerts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "price_alerts insert own" on public.price_alerts;
create policy "price_alerts insert own"
  on public.price_alerts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "price_alerts update own" on public.price_alerts;
create policy "price_alerts update own"
  on public.price_alerts
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "price_alerts delete own" on public.price_alerts;
create policy "price_alerts delete own"
  on public.price_alerts
  for delete
  to authenticated
  using (auth.uid() = user_id);

comment on table public.price_alerts is
  'User-configured price triggers. Polled by the check-price-alerts cron. Fired alerts retain history; not deleted.';
