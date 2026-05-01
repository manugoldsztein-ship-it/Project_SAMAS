-- ============================================================
-- rate_limits_cron.sql (samas-0.4.18) — daily TTL job
-- ============================================================
-- Schedules public.gc_rate_limits() to run daily and prune rows
-- older than 24h. Without this the table grows monotonically — at
-- our current shape (a few hundred rows/day) it'd take years to
-- become a problem, but we add the cron now so we don't have to
-- think about it later.
--
-- Time: 03:00 UTC = 00:00 ART (midnight in Argentina). Off-peak,
-- doesn't compete with the 12:00 UTC aporte cron or the every-2-min
-- alert cron.
-- ============================================================

-- Idempotent: drop the prior schedule if it exists, then create.
-- The unschedule call is wrapped in a do-block so it doesn't fail
-- on first run when the job doesn't exist yet.
do $$
begin
  perform cron.unschedule('rate-limits-gc-daily');
exception when others then
  -- Job didn't exist; that's fine.
  null;
end $$;

select cron.schedule(
  'rate-limits-gc-daily',
  '0 3 * * *',
  $$ select public.gc_rate_limits(); $$
);
