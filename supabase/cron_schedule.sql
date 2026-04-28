-- ============================================================
-- CRON SCHEDULE — wire pg_cron to the Edge Functions
-- ============================================================
-- Run this ONCE in the Supabase SQL editor after both Edge
-- Functions are deployed. Without it, check-price-alerts and
-- process-recurring-aportes are dormant — the inbox stays empty
-- and aportes never land.
--
-- What it does:
--   1. Enables the pg_cron + pg_net extensions (safe if already on).
--   2. Stores SUPABASE_URL and SERVICE_ROLE_KEY in Supabase Vault
--      so the cron commands don't have plaintext secrets.
--   3. Schedules two jobs:
--        - check-price-alerts        every 2 minutes
--        - process-recurring-aportes daily at 12:00 UTC (09:00 AR)
--
-- BEFORE RUNNING:
--   Replace the two placeholder strings below:
--     <PROJECT_URL>      e.g. https://diulqkaorfqccipguiok.supabase.co
--     <SERVICE_ROLE_KEY> from Project Settings → API → service_role
--
-- The service_role key is sensitive — paste it in the SQL editor
-- only, never commit it to git.
--
-- To re-run with different values: unschedule first, then re-run.
--   select cron.unschedule('check-price-alerts-every-2min');
--   select cron.unschedule('process-recurring-aportes-daily');
-- ============================================================

-- 1. Extensions
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- 2. Vault secrets — wrapped in a DO block so re-running overwrites
--    rather than erroring on duplicate name.
do $$
declare
  v_project_url text := '<PROJECT_URL>';
  v_service_key text := '<SERVICE_ROLE_KEY>';
begin
  -- create or update project_url
  if exists (select 1 from vault.secrets where name = 'project_url') then
    update vault.secrets set secret = v_project_url where name = 'project_url';
  else
    perform vault.create_secret(v_project_url, 'project_url');
  end if;

  -- create or update service_role_key
  if exists (select 1 from vault.secrets where name = 'service_role_key') then
    update vault.secrets set secret = v_service_key where name = 'service_role_key';
  else
    perform vault.create_secret(v_service_key, 'service_role_key');
  end if;
end $$;

-- 3a. check-price-alerts — every 2 minutes, all day. Finnhub returns
--     0 for closed markets, which the function already filters out, so
--     off-hours runs are no-ops and cheap.
select cron.unschedule('check-price-alerts-every-2min')
where exists (select 1 from cron.job where jobname = 'check-price-alerts-every-2min');

select cron.schedule(
  'check-price-alerts-every-2min',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/check-price-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 3b. process-recurring-aportes — daily at 12:00 UTC (09:00 AR time).
--     The function itself is idempotent (skips rows whose
--     last_credited_at is already today in AR time), so a second run
--     in the same day is harmless.
select cron.unschedule('process-recurring-aportes-daily')
where exists (select 1 from cron.job where jobname = 'process-recurring-aportes-daily');

select cron.schedule(
  'process-recurring-aportes-daily',
  '0 12 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/process-recurring-aportes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 4. Sanity check — list scheduled jobs to confirm they took.
select jobname, schedule, active from cron.job order by jobname;
