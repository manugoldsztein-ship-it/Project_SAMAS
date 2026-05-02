-- ============================================================
-- SAMAS Plus — fix "column id does not exist" (samas-0.4.44)
-- ============================================================
-- Bug: las RPCs activate_plus(), cancel_plus(), consume_ai_quota()
-- y get_ai_quota_status() queryaban `where id = v_user_id` sobre
-- profiles_social, pero esa tabla usa `user_id` como primary key
-- (no `id`). Resultado: cualquier intento de suscribirse o usar
-- la quota tiraba: ERROR column "id" does not exist.
--
-- Este archivo recrea las 4 RPCs con el column name correcto.
--
-- HOW TO RUN
--   Supabase SQL editor → New query → paste TODO el archivo → Run.
-- ============================================================

-- 1. consume_ai_quota — atomic check + increment
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

  select is_plus into v_is_plus
  from public.profiles_social
  where user_id = v_user_id;

  if coalesce(v_is_plus, false) then
    return json_build_object(
      'allowed', true,
      'is_plus', true,
      'count',   0,
      'limit',   null
    );
  end if;

  insert into public.ai_usage_daily (user_id, date, count)
  values (v_user_id, current_date, 1)
  on conflict (user_id, date)
  do update set count = ai_usage_daily.count + 1, updated_at = now()
  returning count into v_count;

  if v_count > v_limit then
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

-- 2. activate_plus — flip is_plus = true
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
   where user_id = v_user_id;
  return json_build_object('is_plus', true);
end;
$$;

-- 3. cancel_plus — flip is_plus = false
create or replace function public.cancel_plus()
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
     set is_plus = false, plus_activated_at = null
   where user_id = v_user_id;
  return json_build_object('is_plus', false);
end;
$$;

-- 4. get_ai_quota_status — read-only quota status
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
  where user_id = v_user_id;

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

grant execute on function public.consume_ai_quota()    to authenticated;
grant execute on function public.activate_plus()       to authenticated;
grant execute on function public.cancel_plus()         to authenticated;
grant execute on function public.get_ai_quota_status() to authenticated;
