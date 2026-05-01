-- ============================================================
-- AI quota — reset at AR midnight, not UTC midnight (samas-0.4.5)
-- ============================================================
-- Original consume_ai_quota / get_ai_quota_status used current_date,
-- which evaluates in the database's session timezone (UTC by default
-- on Supabase). For users in Argentina (UTC-3), that means quota
-- resets at 21:00 local time — confusing if they hit the limit at
-- 20:30 and expect a midnight rollover.
--
-- Fix: replace current_date with the equivalent date in
-- America/Argentina/Buenos_Aires. Postgres handles timezone-aware
-- date arithmetic natively.
--
-- Trade-off: this hardcodes AR for all users. If we expand to
-- another country later, swap to a per-user timezone column on
-- profiles_social and reference it here. For the AR-targeted
-- launch this is the right call.
--
-- Idempotent (CREATE OR REPLACE FUNCTION). Re-runs are no-ops if
-- the body is already at this version.
-- ============================================================

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
  -- Today in Buenos Aires time. Quota resets at midnight local.
  v_today date := (current_timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
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

  -- Atomic upsert + increment, keyed on AR-local date
  insert into public.ai_usage_daily (user_id, date, count)
  values (v_user_id, v_today, 1)
  on conflict (user_id, date)
  do update set count = ai_usage_daily.count + 1, updated_at = now()
  returning count into v_count;

  if v_count > v_limit then
    -- Roll back the increment so a blocked attempt doesn't burn quota
    update public.ai_usage_daily
       set count = count - 1, updated_at = now()
     where user_id = v_user_id and date = v_today;
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
  v_today date := (current_timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
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
  where user_id = v_user_id and date = v_today;

  return json_build_object(
    'is_plus', false,
    'count',   coalesce(v_count, 0),
    'limit',   v_limit
  );
end;
$$;

grant execute on function public.get_ai_quota_status() to authenticated;
