-- ============================================================
-- SAMAS Plus — subscription tier + AI usage tracking (0.2.6)
-- ============================================================
-- Adds:
--   1. profiles_social.is_plus + plus_activated_at  — flag set
--      when the user subscribes (today: prototype tap-to-activate;
--      production: Apple StoreKit IAP receipt verification on
--      Edge Function). Per user, single boolean — when we wire
--      App Store IAP we'll likely move this to its own
--      `subscriptions` table with renewal/period tracking.
--
--   2. public.ai_usage_daily (user_id, date, count) — increments
--      every time a user-initiated AI call fires for non-Plus users.
--      Auto-loads (Daily Brief, Earnings Watch, Compare Benchmark,
--      Risk Score, Quarterly Review, Trade Coach, Position Size)
--      do NOT count — they're free in both tiers. The 8 user-
--      tappable AI surfaces (chat, deep analysis, rebalance, etc.)
--      consume one quota credit each call.
--
--   3. public.consume_ai_quota() — RPC the client calls before each
--      quota'd AI surface. Returns { allowed, is_plus, count, limit }.
--      SECURITY DEFINER so the user can't bypass via direct SQL
--      manipulation. Atomic increment via INSERT...ON CONFLICT, and
--      rolls back the increment when the user is over the limit so
--      a blocked attempt doesn't burn through future quota.
--
--   4. public.activate_plus() — RPC that flips is_plus = true. Today
--      it's just a boolean flip (prototype). When App Store IAP lands
--      this gets replaced with a server-side verification flow that
--      checks the receipt against Apple's verifyReceipt endpoint
--      before flipping the flag.
--
-- HOW TO RUN
--   Supabase SQL editor → New query → paste this entire file → Run.
-- ============================================================

-- 1. Subscription flag
alter table public.profiles_social
  add column if not exists is_plus boolean not null default false;

alter table public.profiles_social
  add column if not exists plus_activated_at timestamptz;

-- 2. Daily usage counter
create table if not exists public.ai_usage_daily (
  user_id    uuid not null references auth.users(id) on delete cascade,
  date       date not null default current_date,
  count      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.ai_usage_daily enable row level security;

-- Read-only for the user (so they can show their own count in UI).
-- Writes happen exclusively through consume_ai_quota() which uses
-- SECURITY DEFINER and bypasses RLS.
drop policy if exists "ai_usage_daily select own" on public.ai_usage_daily;
create policy "ai_usage_daily select own"
  on public.ai_usage_daily
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies — only the RPC writes.

create index if not exists ai_usage_daily_user_date_idx
  on public.ai_usage_daily (user_id, date);

-- 3. Atomic consume + check
create or replace function public.consume_ai_quota()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_plus boolean;
  v_count int;
  v_limit int := 5;
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;

  -- Plus check
  select is_plus into v_is_plus
  from public.profiles_social
  where id = v_user_id;

  if coalesce(v_is_plus, false) then
    return json_build_object(
      'allowed', true,
      'is_plus', true,
      'count',   0,
      'limit',   null
    );
  end if;

  -- Atomic upsert + increment
  insert into public.ai_usage_daily (user_id, date, count)
  values (v_user_id, current_date, 1)
  on conflict (user_id, date)
  do update set count = ai_usage_daily.count + 1, updated_at = now()
  returning count into v_count;

  if v_count > v_limit then
    -- Roll back the increment so a blocked attempt doesn't burn quota
    update public.ai_usage_daily
       set count = count - 1, updated_at = now()
     where user_id = v_user_id and date = current_date;
    return json_build_object(
      'allowed', false,
      'is_plus', false,
      'count',   v_count - 1,
      'limit',   v_limit
    );
  end if;

  return json_build_object(
    'allowed', true,
    'is_plus', false,
    'count',   v_count,
    'limit',   v_limit
  );
end;
$$;

grant execute on function public.consume_ai_quota() to authenticated;

-- 4. Plus activation (prototype — future: verify Apple IAP receipt)
create or replace function public.activate_plus()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;
  update public.profiles_social
     set is_plus = true, plus_activated_at = now()
   where id = v_user_id;
  return json_build_object('is_plus', true);
end;
$$;

grant execute on function public.activate_plus() to authenticated;

-- Helper for the UI to read the current day's usage WITHOUT consuming
-- a credit. Used to show "3/5 IA hoy" indicators.
create or replace function public.get_ai_quota_status()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_plus boolean;
  v_count int;
  v_limit int := 5;
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;

  select is_plus into v_is_plus
  from public.profiles_social
  where id = v_user_id;

  if coalesce(v_is_plus, false) then
    return json_build_object('is_plus', true, 'count', 0, 'limit', null);
  end if;

  select count into v_count
  from public.ai_usage_daily
  where user_id = v_user_id and date = current_date;

  return json_build_object(
    'is_plus', false,
    'count',   coalesce(v_count, 0),
    'limit',   v_limit
  );
end;
$$;

grant execute on function public.get_ai_quota_status() to authenticated;

comment on table public.ai_usage_daily is
  'Daily AI usage counter for free-tier quota enforcement. Writes via consume_ai_quota() RPC only.';
comment on function public.consume_ai_quota() is
  'Atomic quota check + increment. Returns { allowed, is_plus, count, limit }.';
comment on function public.activate_plus() is
  'Flips profiles_social.is_plus = true. Prototype — production needs Apple IAP receipt verification.';
