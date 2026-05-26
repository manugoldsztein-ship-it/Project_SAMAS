-- ============================================================
-- REALTIME — opt social tables into supabase_realtime publication
-- ============================================================
-- Supabase's realtime stream comes from a Postgres logical
-- replication publication called supabase_realtime. Tables only
-- emit INSERT/UPDATE/DELETE events to subscribers if they're
-- members of that publication. The dashboard exposes the same via
-- Database → Replication → supabase_realtime → tick the boxes.
--
-- This migration adds the four tables the v2 client subscribes to:
--   - posts          (Social FeedView prepends new posts live)
--   - notifications  (Wallet bell badge + open-inbox prepend)
--   - likes          (future: live like-count on visible posts)
--   - follows        (future: live follower-count on profile screen)
--
-- The IF NOT EXISTS test is done via a do-block because
-- ALTER PUBLICATION ... ADD TABLE doesn't have a built-in
-- "if not exists" form in older Postgres versions. We catch the
-- duplicate-object error and continue.
--
-- HOW TO APPLY
--   psql "$SUPABASE_DB_URL" -f supabase/realtime_publication.sql
--   or paste into the Supabase SQL editor.
-- ============================================================

do $$
begin
  begin
    alter publication supabase_realtime add table public.posts;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.likes;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.follows;
  exception when duplicate_object then null;
  end;
end $$;
