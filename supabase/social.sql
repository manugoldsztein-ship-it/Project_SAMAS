-- ============================================================
-- SOCIAL — posts, likes, replies, follows, reports, saves
-- ============================================================
-- The social graph for SAMAS lives entirely in Supabase: every
-- table here is owned by us (no external partner integration). The
-- v2 client (src/v2/api/social.js) is wired to read/write these
-- tables via the supabase-js client. RLS enforces who can see what.
--
-- TABLES
--   profiles_social      one row per user — handle, display name, avatar color, bio
--   posts                top-level text posts (1..280 chars), optional trade card
--   likes                composite PK so a like is idempotent (one row per user per post)
--   reposts              composite PK, same shape as likes
--   replies              threaded comments under a post
--   follows              directional graph; (follower_id -> following_id)
--   saved_posts          private bookmarks (only owner reads)
--   reports              moderation queue (admins read, anyone files)
--
-- DENORMALIZED COUNTS
--   posts.likes_count / comments_count / reposts_count are kept in
--   sync with the child tables via triggers. Reads of the feed only
--   need a single SELECT off posts (+ join to profiles_social for
--   the author panel) — no per-post COUNT subqueries.
--
-- HOW TO APPLY
--   psql "$SUPABASE_DB_URL" -f supabase/social.sql
--   or paste this whole file into the Supabase SQL editor.
--
-- The migration is idempotent — re-running it is safe.
-- ============================================================

-- ============================================================
-- 1. profiles_social
-- ============================================================
-- Every authenticated user gets one row. The frontend creates this
-- lazily the first time the user opens the Social tab (see
-- ensureProfile() in api/social.js); no auth-side trigger needed.
--
-- handle is globally unique and forms the public identity ("@manugold").
-- avatar_color is a hex string the avatar component renders as the
-- circle background — keeps avatars cheap until we add image upload.
-- ============================================================

create table if not exists public.profiles_social (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  handle         text not null unique,
  display_name   text not null,
  avatar_color   text not null default '#16C784',
  bio            text,
  verified       boolean not null default false,
  is_admin       boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Case-insensitive lookup for "find user by @handle" / search.
create index if not exists profiles_social_handle_lower
  on public.profiles_social (lower(handle));

alter table public.profiles_social enable row level security;

drop policy if exists "profiles_social select all"     on public.profiles_social;
drop policy if exists "profiles_social insert own"     on public.profiles_social;
drop policy if exists "profiles_social update own"     on public.profiles_social;

-- Anyone authenticated can read profiles (we display them next to posts).
create policy "profiles_social select all"
  on public.profiles_social for select to authenticated using (true);

-- A user can create exactly one row, keyed to their auth.uid().
create policy "profiles_social insert own"
  on public.profiles_social for insert to authenticated
  with check (auth.uid() = user_id);

-- A user can update their own row only — handle, display_name, bio, avatar_color.
-- They CANNOT flip verified or is_admin (only the service role can).
create policy "profiles_social update own"
  on public.profiles_social for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and verified = (select verified from public.profiles_social where user_id = auth.uid())
    and is_admin = (select is_admin from public.profiles_social where user_id = auth.uid())
  );

-- ============================================================
-- 2. posts
-- ============================================================
-- Soft delete via deleted_at — we keep the row so likes/replies still
-- have a valid FK and the moderation queue can show what was reported
-- after the post was taken down. Feeds filter on deleted_at is null.
--
-- The trade column is jsonb so the side/ticker/qty/price card can
-- evolve without a migration. The ticker column at the top level is
-- separate — used as a search axis ("posts about NVDA"). Set ticker
-- = upper(trade->>'ticker') in the frontend or via trigger.
-- ============================================================

create table if not exists public.posts (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid not null references auth.users(id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 280),
  ticker          text,
  trade           jsonb,
  likes_count     integer not null default 0,
  comments_count  integer not null default 0,
  reposts_count   integer not null default 0,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- Hot path: global "for you" feed in reverse chronological order, live posts only.
create index if not exists posts_recent
  on public.posts (created_at desc)
  where deleted_at is null;

-- "All my posts" / profile view.
create index if not exists posts_by_author
  on public.posts (author_id, created_at desc)
  where deleted_at is null;

-- Ticker filter ("posts about NVDA") — partial because most posts
-- don't reference a ticker.
create index if not exists posts_by_ticker
  on public.posts (upper(ticker), created_at desc)
  where deleted_at is null and ticker is not null;

alter table public.posts enable row level security;

drop policy if exists "posts select live"  on public.posts;
drop policy if exists "posts insert own"   on public.posts;
drop policy if exists "posts update own"   on public.posts;
drop policy if exists "posts delete own"   on public.posts;

-- Public feed — anyone authenticated reads non-deleted posts. Deleted
-- posts are still visible to the author (so a "you deleted this" UX
-- can show) and to admins.
create policy "posts select live"
  on public.posts for select to authenticated
  using (
    deleted_at is null
    or auth.uid() = author_id
    or exists (select 1 from public.profiles_social
               where user_id = auth.uid() and is_admin)
  );

create policy "posts insert own"
  on public.posts for insert to authenticated
  with check (auth.uid() = author_id);

-- Edit window: author can update their own row. Counts (likes/replies/
-- reposts) are mutated only by triggers running with the function's
-- privileges, not by the user directly — so we don't need a column-level
-- restriction.
create policy "posts update own"
  on public.posts for update to authenticated
  using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- Hard delete reserved for the service role / admin tooling. Users
-- who want to "delete" their post hit the soft-delete path: UPDATE
-- posts SET deleted_at = now() WHERE id = ? — covered by the update
-- policy above.
create policy "posts delete own"
  on public.posts for delete to authenticated
  using (auth.uid() = author_id);

-- ============================================================
-- 3. likes
-- ============================================================
-- Composite PK is the entire idempotency contract: clicking like
-- twice from a flaky network only ever creates one row.
-- ============================================================

create table if not exists public.likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- "Posts I've liked" — used for the saved-likes view and to compute
-- the likedByMe flag on each row in the feed (left join).
create index if not exists likes_by_user
  on public.likes (user_id, created_at desc);

alter table public.likes enable row level security;

drop policy if exists "likes select all"   on public.likes;
drop policy if exists "likes insert own"   on public.likes;
drop policy if exists "likes delete own"   on public.likes;

create policy "likes select all"
  on public.likes for select to authenticated using (true);

create policy "likes insert own"
  on public.likes for insert to authenticated
  with check (auth.uid() = user_id);

create policy "likes delete own"
  on public.likes for delete to authenticated
  using (auth.uid() = user_id);

-- Trigger: keep posts.likes_count in sync.
create or replace function public.likes_count_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set likes_count = likes_count + 1 where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts set likes_count = greatest(0, likes_count - 1) where id = old.post_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists likes_count_sync on public.likes;
create trigger likes_count_sync
  after insert or delete on public.likes
  for each row execute function public.likes_count_sync();

-- ============================================================
-- 4. reposts
-- ============================================================
-- Same shape as likes; same idempotency story.
-- ============================================================

create table if not exists public.reposts (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists reposts_by_user
  on public.reposts (user_id, created_at desc);

alter table public.reposts enable row level security;

drop policy if exists "reposts select all"  on public.reposts;
drop policy if exists "reposts insert own"  on public.reposts;
drop policy if exists "reposts delete own"  on public.reposts;

create policy "reposts select all"
  on public.reposts for select to authenticated using (true);

create policy "reposts insert own"
  on public.reposts for insert to authenticated
  with check (auth.uid() = user_id);

create policy "reposts delete own"
  on public.reposts for delete to authenticated
  using (auth.uid() = user_id);

create or replace function public.reposts_count_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set reposts_count = reposts_count + 1 where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts set reposts_count = greatest(0, reposts_count - 1) where id = old.post_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists reposts_count_sync on public.reposts;
create trigger reposts_count_sync
  after insert or delete on public.reposts
  for each row execute function public.reposts_count_sync();

-- ============================================================
-- 5. replies
-- ============================================================
-- Threaded one level deep — a reply has a post_id, not a parent
-- reply id. If we ever want nested threads, add parent_reply_id
-- (nullable) and update the comments_count trigger.
-- ============================================================

create table if not exists public.replies (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 280),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Hot path: render thread for a post in chronological order.
create index if not exists replies_by_post
  on public.replies (post_id, created_at)
  where deleted_at is null;

alter table public.replies enable row level security;

drop policy if exists "replies select live"  on public.replies;
drop policy if exists "replies insert own"   on public.replies;
drop policy if exists "replies update own"   on public.replies;
drop policy if exists "replies delete own"   on public.replies;

create policy "replies select live"
  on public.replies for select to authenticated
  using (
    deleted_at is null
    or auth.uid() = author_id
    or exists (select 1 from public.profiles_social
               where user_id = auth.uid() and is_admin)
  );

create policy "replies insert own"
  on public.replies for insert to authenticated
  with check (auth.uid() = author_id);

create policy "replies update own"
  on public.replies for update to authenticated
  using (auth.uid() = author_id) with check (auth.uid() = author_id);

create policy "replies delete own"
  on public.replies for delete to authenticated
  using (auth.uid() = author_id);

create or replace function public.replies_count_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set comments_count = comments_count + 1 where id = new.post_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.posts set comments_count = greatest(0, comments_count - 1) where id = old.post_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists replies_count_sync on public.replies;
create trigger replies_count_sync
  after insert or delete on public.replies
  for each row execute function public.replies_count_sync();

-- ============================================================
-- 6. follows
-- ============================================================
-- Directional graph. Composite PK enforces "you can only follow a
-- user once" idempotently. The check constraint blocks self-follow
-- at the database level (cheaper than UI validation).
-- ============================================================

create table if not exists public.follows (
  follower_id   uuid not null references auth.users(id) on delete cascade,
  following_id  uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

-- "Who do I follow" (used for the Following feed).
create index if not exists follows_by_follower
  on public.follows (follower_id, created_at desc);

-- "Who follows me" (used for the Profile -> followers list, future).
create index if not exists follows_by_following
  on public.follows (following_id, created_at desc);

alter table public.follows enable row level security;

drop policy if exists "follows select all"   on public.follows;
drop policy if exists "follows insert own"   on public.follows;
drop policy if exists "follows delete own"   on public.follows;

create policy "follows select all"
  on public.follows for select to authenticated using (true);

create policy "follows insert own"
  on public.follows for insert to authenticated
  with check (auth.uid() = follower_id);

create policy "follows delete own"
  on public.follows for delete to authenticated
  using (auth.uid() = follower_id);

-- ============================================================
-- 7. saved_posts
-- ============================================================
-- Private bookmarks. Unlike likes, only the owner reads them. RLS
-- enforces that.
-- ============================================================

create table if not exists public.saved_posts (
  user_id    uuid not null references auth.users(id) on delete cascade,
  post_id    uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists saved_posts_by_user
  on public.saved_posts (user_id, created_at desc);

alter table public.saved_posts enable row level security;

drop policy if exists "saved_posts select own"   on public.saved_posts;
drop policy if exists "saved_posts insert own"   on public.saved_posts;
drop policy if exists "saved_posts delete own"   on public.saved_posts;

create policy "saved_posts select own"
  on public.saved_posts for select to authenticated
  using (auth.uid() = user_id);

create policy "saved_posts insert own"
  on public.saved_posts for insert to authenticated
  with check (auth.uid() = user_id);

create policy "saved_posts delete own"
  on public.saved_posts for delete to authenticated
  using (auth.uid() = user_id);

-- ============================================================
-- 8. reports (moderation queue)
-- ============================================================
-- Anyone authenticated can file a report. Only admins can read the
-- queue or resolve reports. The 'action' field is set when an admin
-- resolves: dismiss | delete_post | ban_user.
-- ============================================================

create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts(id) on delete cascade,
  reporter_id  uuid not null references auth.users(id) on delete cascade,
  reason       text not null check (char_length(reason) between 1 and 500),
  status       text not null default 'pending' check (status in ('pending','resolved')),
  action       text check (action in ('dismiss','delete_post','ban_user')),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- Admin queue index — partial because resolved reports balloon over time.
create index if not exists reports_pending
  on public.reports (created_at desc)
  where status = 'pending';

alter table public.reports enable row level security;

drop policy if exists "reports insert any"     on public.reports;
drop policy if exists "reports select admin"   on public.reports;
drop policy if exists "reports update admin"   on public.reports;

create policy "reports insert any"
  on public.reports for insert to authenticated
  with check (auth.uid() = reporter_id);

create policy "reports select admin"
  on public.reports for select to authenticated
  using (
    auth.uid() = reporter_id
    or exists (select 1 from public.profiles_social
               where user_id = auth.uid() and is_admin)
  );

create policy "reports update admin"
  on public.reports for update to authenticated
  using (exists (select 1 from public.profiles_social
                 where user_id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles_social
                      where user_id = auth.uid() and is_admin));
