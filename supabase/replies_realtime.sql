-- ============================================================
-- REPLIES — opt into supabase_realtime publication
-- ============================================================
-- The original realtime_publication.sql added posts, notifications,
-- likes, and follows. Replies were left out because the UI didn't
-- read them at the time. With samas-0.0.28 (the thread view) we
-- now subscribe to INSERTs on replies filtered by post_id, so
-- the table needs to live in the publication.
--
-- HOW TO APPLY
--   psql "$SUPABASE_DB_URL" -f supabase/replies_realtime.sql
--   or paste into the Supabase SQL editor.
--
-- Idempotent — re-running is safe via the duplicate_object catch.
-- ============================================================

do $$
begin
  begin
    alter publication supabase_realtime add table public.replies;
  exception when duplicate_object then null;
  end;
end $$;
