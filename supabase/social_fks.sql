-- ============================================================
-- SOCIAL — supplementary FKs to profiles_social for PostgREST
-- ============================================================
-- The original social.sql migration declared every author/user
-- column as a FK to auth.users(id). That's the right cascade
-- target (delete user → cascade delete their posts, follows, etc.),
-- but PostgREST's relational select syntax —
--
--     .select("body, author:profiles_social!author_id(...)")
--
-- — needs a DIRECT FK from each social table's user-ish column to
-- profiles_social(user_id). Without it, the API call dies with:
--
--     Could not find a relationship between 'posts' and
--     'profiles_social' in the schema cache
--
-- Adding a second FK to the same column is fine in Postgres: both
-- constraints are checked on insert and both cascade on delete.
-- The data already lines up because profiles_social.user_id is a
-- subset of auth.users.id (every social profile belongs to a user).
--
-- This migration assumes profiles_social rows exist for any user
-- whose id appears in posts/replies/follows/etc. Today that's
-- guaranteed because getMe() auto-creates a profiles_social row on
-- first access AND because the only writer to these tables is the
-- frontend, which always calls getMe() before composing.
--
-- HOW TO APPLY
--   psql "$SUPABASE_DB_URL" -f supabase/social_fks.sql
--   or paste this whole file into the Supabase SQL editor.
--
-- Idempotent — re-running is safe.
-- ============================================================

-- posts.author_id → profiles_social.user_id
alter table public.posts
  drop constraint if exists posts_author_profile_fkey;
alter table public.posts
  add constraint posts_author_profile_fkey
  foreign key (author_id)
  references public.profiles_social(user_id) on delete cascade;

-- replies.author_id → profiles_social.user_id
alter table public.replies
  drop constraint if exists replies_author_profile_fkey;
alter table public.replies
  add constraint replies_author_profile_fkey
  foreign key (author_id)
  references public.profiles_social(user_id) on delete cascade;

-- follows.following_id → profiles_social.user_id
-- (We embed the followed user's profile in getFollowing(); the
-- follower side stays anchored to auth.users only because we never
-- embed the follower's profile from a follows row.)
alter table public.follows
  drop constraint if exists follows_following_profile_fkey;
alter table public.follows
  add constraint follows_following_profile_fkey
  foreign key (following_id)
  references public.profiles_social(user_id) on delete cascade;

-- reports.reporter_id → profiles_social.user_id
alter table public.reports
  drop constraint if exists reports_reporter_profile_fkey;
alter table public.reports
  add constraint reports_reporter_profile_fkey
  foreign key (reporter_id)
  references public.profiles_social(user_id) on delete cascade;

-- Force PostgREST to refresh its schema cache so the new
-- relationships are picked up immediately. Without this it can
-- take up to a minute to re-poll; the NOTIFY makes it instant.
notify pgrst, 'reload schema';
