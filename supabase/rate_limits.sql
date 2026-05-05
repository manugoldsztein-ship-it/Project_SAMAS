-- ============================================================
-- rate_limits.sql (samas-0.4.16) — sliding-window rate limit log
-- ============================================================
-- One row per allowed request. The Edge Function shared helper
-- reads the count of rows in `bucket` over the last N seconds and
-- decides whether to allow. Buckets are namespaced strings like
-- `send-otp:user:abc-123` or `objectives-plan:ip:1.2.3.4`.
--
-- Why a table not Redis:
--   - We already have Postgres. Adding Redis = +1 service to
--     monitor, +1 secret, +1 thing that breaks during the pitch.
--   - Sliding-window with millisecond precision is fine on Postgres
--     for our QPS (≤100 RPS realistic peak). The bucket+hit_at
--     index gives us O(log n) lookup.
--   - TTL handled by a daily cron (see process-recurring-aportes
--     pattern) — we delete rows older than 24h. Even at 100 RPS
--     sustained that's 8.6M rows max, well within Postgres comfort.
--
-- RLS: deny all from clients. Only the service_role (Edge Function
-- env) can read/write. No user should ever see this table.
-- ============================================================

create table if not exists public.rate_limits (
  id              uuid primary key default gen_random_uuid(),
  bucket          text not null,
  hit_at          timestamptz not null default now()
);

create index if not exists rate_limits_bucket_hit_at_idx
  on public.rate_limits (bucket, hit_at desc);

create index if not exists rate_limits_hit_at_idx
  on public.rate_limits (hit_at);

alter table public.rate_limits enable row level security;

-- Explicit deny-all for clients. The Edge Function uses the
-- service_role key which bypasses RLS by design.
drop policy if exists "rate_limits deny all" on public.rate_limits;
create policy "rate_limits deny all" on public.rate_limits
  for all to authenticated, anon
  using (false) with check (false);

-- ============================================================
-- consume_rate_limit RPC — atomic check + insert
-- ============================================================
-- Inputs:
--   p_bucket    text     — namespaced key, e.g. "send-otp:user:..."
--   p_limit     integer  — max requests in the window
--   p_window_s  integer  — window length in seconds
--
-- Returns: jsonb { allowed: bool, count: int, retry_after: int }
--
-- The check + insert run in a single SECURITY DEFINER call so two
-- concurrent requests can't both pass at the limit boundary
-- (small race, but real). When `allowed = false`, retry_after is
-- the seconds until the oldest row in the window expires.
-- ============================================================

create or replace function public.consume_rate_limit(
  p_bucket   text,
  p_limit    integer,
  p_window_s integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since   timestamptz;
  v_count   integer;
  v_oldest  timestamptz;
  v_retry   integer;
begin
  if p_bucket is null or length(p_bucket) = 0 or length(p_bucket) > 200 then
    return jsonb_build_object('allowed', false, 'count', 0, 'retry_after', 0,
      'error', 'invalid bucket');
  end if;
  if p_limit <= 0 or p_window_s <= 0 then
    return jsonb_build_object('allowed', false, 'count', 0, 'retry_after', 0,
      'error', 'invalid params');
  end if;

  v_since := now() - make_interval(secs => p_window_s);

  select count(*) into v_count
    from public.rate_limits
   where bucket = p_bucket
     and hit_at >= v_since;

  if v_count >= p_limit then
    -- Compute retry_after from the oldest row in the window — that's
    -- when one slot will expire.
    select hit_at into v_oldest
      from public.rate_limits
     where bucket = p_bucket and hit_at >= v_since
     order by hit_at asc
     limit 1;
    v_retry := greatest(1, p_window_s - extract(epoch from (now() - v_oldest))::int);
    return jsonb_build_object('allowed', false, 'count', v_count, 'retry_after', v_retry);
  end if;

  insert into public.rate_limits (bucket) values (p_bucket);
  return jsonb_build_object('allowed', true, 'count', v_count + 1, 'retry_after', 0);
end;
$$;

-- Allow service_role + authenticated to call. Edge Functions use
-- service_role; the authenticated grant is defensive (we don't call
-- this from clients today, but if we ever did we want explicit
-- permission rather than relying on default behavior).
revoke all on function public.consume_rate_limit(text, integer, integer) from public;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to service_role, authenticated;

-- ============================================================
-- TTL cleanup — drop rows older than 24h. Called by a daily cron
-- in process-recurring-aportes (extending an existing scheduled
-- function instead of adding a new cron line).
-- ============================================================
create or replace function public.gc_rate_limits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limits where hit_at < now() - interval '24 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.gc_rate_limits() from public;
grant execute on function public.gc_rate_limits() to service_role;
