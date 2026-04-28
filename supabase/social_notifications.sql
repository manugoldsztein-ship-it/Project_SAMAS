-- ============================================================
-- SOCIAL NOTIFICATIONS — bridge social events to the inbox
-- ============================================================
-- Three Postgres triggers that fire whenever someone likes a post,
-- reposts a post, replies to a post, or follows a user. Each
-- trigger inserts a row into public.notifications addressed to the
-- person who should be notified (post author for like/repost/reply,
-- followed user for follow). Self-notifications are skipped at the
-- trigger level (so liking your own post doesn't ping you).
--
-- Why triggers instead of doing this in the client / Edge Function:
--   - Atomicity. The like row + notification row are written in the
--     same transaction. No way to drop the like but skip the
--     notification, or vice versa.
--   - Latency. The notification appears the moment the like commits,
--     not after a roundtrip to a function.
--   - RLS-safe. The function runs as security definer, so it can
--     write notification rows for any user — but it ONLY ever writes
--     rows derived from the actual NEW.* of the social event, so
--     there's no impersonation surface.
--
-- Kinds the migration introduces:
--   'social_like'    — someone liked your post
--   'social_repost'  — someone reposted your post
--   'social_reply'   — someone replied to your post
--   'social_follow'  — someone started following you
--
-- The frontend renders unknown kinds as a generic bell so this is
-- forward-compatible with the existing Wallet inbox.
--
-- Title strings are hardcoded in Spanish here, matching the pattern
-- the other cron-written notifications use (check-price-alerts,
-- process-recurring-aportes). The data jsonb carries the structured
-- payload (actor handle, post_id) so a future i18n pass can render
-- titles client-side from the data instead of the stored string.
--
-- HOW TO APPLY
--   psql "$SUPABASE_DB_URL" -f supabase/social_notifications.sql
--   or paste into the Supabase SQL editor.
--
-- Idempotent — re-running is safe.
-- ============================================================

-- Common helper: pull the actor's display_name from profiles_social.
-- Falls back to handle, then to "Alguien" so we always have something
-- to render. Returns the display string ready to splice into a title.
create or replace function public.social_actor_display(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(trim(ps.display_name), ''),
    nullif(ps.handle, ''),
    'Alguien'
  )
  from public.profiles_social ps
  where ps.user_id = p_user_id
$$;

-- ============================================================
-- LIKES → notify post author
-- ============================================================
create or replace function public.notify_post_liked() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_id uuid;
  v_actor     text;
  v_handle    text;
begin
  -- Look up the post's author. Skip if the post got deleted between
  -- the like committing and this trigger running.
  select author_id into v_author_id
  from public.posts
  where id = new.post_id;
  if v_author_id is null then return new; end if;

  -- Self-likes are silent.
  if v_author_id = new.user_id then return new; end if;

  v_actor  := public.social_actor_display(new.user_id);
  select handle into v_handle from public.profiles_social where user_id = new.user_id;

  insert into public.notifications (user_id, kind, title, body, data)
  values (
    v_author_id,
    'social_like',
    v_actor || ' dio like a tu post',
    null,
    jsonb_build_object(
      'post_id',     new.post_id,
      'actor_id',    new.user_id,
      'actor_handle', v_handle
    )
  );
  return new;
end $$;

drop trigger if exists notify_post_liked on public.likes;
create trigger notify_post_liked
  after insert on public.likes
  for each row execute function public.notify_post_liked();

-- ============================================================
-- REPOSTS → notify post author
-- ============================================================
create or replace function public.notify_post_reposted() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_id uuid;
  v_actor     text;
  v_handle    text;
begin
  select author_id into v_author_id
  from public.posts
  where id = new.post_id;
  if v_author_id is null then return new; end if;
  if v_author_id = new.user_id then return new; end if;

  v_actor  := public.social_actor_display(new.user_id);
  select handle into v_handle from public.profiles_social where user_id = new.user_id;

  insert into public.notifications (user_id, kind, title, body, data)
  values (
    v_author_id,
    'social_repost',
    v_actor || ' reposteó tu post',
    null,
    jsonb_build_object(
      'post_id',     new.post_id,
      'actor_id',    new.user_id,
      'actor_handle', v_handle
    )
  );
  return new;
end $$;

drop trigger if exists notify_post_reposted on public.reposts;
create trigger notify_post_reposted
  after insert on public.reposts
  for each row execute function public.notify_post_reposted();

-- ============================================================
-- REPLIES → notify post author
-- ============================================================
-- Reply body is included in the notification body so the inbox
-- preview shows the actual response, not just "X replied to your
-- post". Truncated to 140 chars so a max-length reply doesn't
-- balloon the notifications row.
create or replace function public.notify_post_replied() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_id uuid;
  v_actor     text;
  v_handle    text;
begin
  select author_id into v_author_id
  from public.posts
  where id = new.post_id;
  if v_author_id is null then return new; end if;
  if v_author_id = new.author_id then return new; end if;

  v_actor  := public.social_actor_display(new.author_id);
  select handle into v_handle from public.profiles_social where user_id = new.author_id;

  insert into public.notifications (user_id, kind, title, body, data)
  values (
    v_author_id,
    'social_reply',
    v_actor || ' respondió a tu post',
    left(new.body, 140),
    jsonb_build_object(
      'post_id',     new.post_id,
      'reply_id',    new.id,
      'actor_id',    new.author_id,
      'actor_handle', v_handle
    )
  );
  return new;
end $$;

drop trigger if exists notify_post_replied on public.replies;
create trigger notify_post_replied
  after insert on public.replies
  for each row execute function public.notify_post_replied();

-- ============================================================
-- FOLLOWS → notify followed user
-- ============================================================
-- Self-follow is already blocked by the CHECK constraint on
-- public.follows, so we don't need to re-check here.
create or replace function public.notify_user_followed() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  text;
  v_handle text;
begin
  v_actor  := public.social_actor_display(new.follower_id);
  select handle into v_handle from public.profiles_social where user_id = new.follower_id;

  insert into public.notifications (user_id, kind, title, body, data)
  values (
    new.following_id,
    'social_follow',
    v_actor || ' empezó a seguirte',
    null,
    jsonb_build_object(
      'actor_id',    new.follower_id,
      'actor_handle', v_handle
    )
  );
  return new;
end $$;

drop trigger if exists notify_user_followed on public.follows;
create trigger notify_user_followed
  after insert on public.follows
  for each row execute function public.notify_user_followed();
