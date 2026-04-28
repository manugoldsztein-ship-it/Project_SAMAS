-- ============================================================
-- SOCIAL MESSAGES — 1:1 direct messages
-- ============================================================
-- The Mensajes tab in the v2 social shell needs a backend. This
-- migration adds two tables (dm_threads, dm_messages), RLS scoped
-- to thread participants, indexes for the hot query paths, a
-- trigger that keeps last_message_at in sync, and the realtime
-- publication entries needed for live conversation updates.
--
-- DESIGN CHOICES
--   - 1:1 ONLY for now. No group chats. The thread row stores
--     (user_a, user_b) where user_a < user_b textually so the
--     UNIQUE constraint prevents duplicate threads regardless of
--     which side opened first.
--   - last_message_at is denormalized onto the thread so the
--     "my threads" query can ORDER BY it without joining
--     messages and aggregating. Trigger keeps it fresh.
--   - read tracking is per-message, not per-thread. dm_messages.
--     read_at is set when the OTHER party renders the message.
--     Frontend bulk-marks on conversation open.
--   - No notifications-table integration here yet; add later if
--     we want DM messages to also surface in the bell inbox.
--     Realtime-only for now keeps the UX simple.
--
-- HOW TO APPLY
--   psql "$SUPABASE_DB_URL" -f supabase/social_messages.sql
--   or paste into the Supabase SQL editor and Run.
--
-- Idempotent — re-running is safe.
-- ============================================================

-- ============================================================
-- 1. dm_threads
-- ============================================================
-- One row per pair of users. The check + unique constraint
-- guarantees:
--   - No self-DMs (user_a <> user_b)
--   - Sorted pair (user_a < user_b) so insert order doesn't
--     matter; "open thread with X" always lands on the same row
-- ============================================================

create table if not exists public.dm_threads (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references auth.users(id) on delete cascade,
  user_b          uuid not null references auth.users(id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);

-- "My threads" — both columns indexed independently so the
-- frontend can OR-filter without a sequential scan. Partial
-- because typical user has dozens of threads, not millions.
create index if not exists dm_threads_user_a_recent
  on public.dm_threads (user_a, last_message_at desc);
create index if not exists dm_threads_user_b_recent
  on public.dm_threads (user_b, last_message_at desc);

alter table public.dm_threads enable row level security;

drop policy if exists "dm_threads select participant" on public.dm_threads;
drop policy if exists "dm_threads insert participant" on public.dm_threads;
drop policy if exists "dm_threads update participant" on public.dm_threads;

-- Read: only thread participants.
create policy "dm_threads select participant"
  on public.dm_threads for select to authenticated
  using (auth.uid() in (user_a, user_b));

-- Insert: caller must be one of the two users on the row, and
-- the row must be valid (sorted, non-self). The CHECK constraint
-- catches the latter; the policy enforces the former.
create policy "dm_threads insert participant"
  on public.dm_threads for insert to authenticated
  with check (auth.uid() in (user_a, user_b));

-- Update: only the trigger needs to write last_message_at, and
-- it runs as security definer so it doesn't go through this
-- policy. We still allow participants to update because future
-- features (rename / archive / mute) might need it.
create policy "dm_threads update participant"
  on public.dm_threads for update to authenticated
  using (auth.uid() in (user_a, user_b))
  with check (auth.uid() in (user_a, user_b));

-- ============================================================
-- 2. dm_messages
-- ============================================================
-- Body is checked 1..2000 chars (more generous than posts since
-- DMs often paste links / longer thoughts). read_at is null
-- until the recipient opens the conversation; the trigger that
-- bumps thread.last_message_at runs on every insert regardless.
-- ============================================================

create table if not exists public.dm_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.dm_threads(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

-- Hot path: render conversation view in chronological order.
create index if not exists dm_messages_by_thread
  on public.dm_messages (thread_id, created_at);

-- Unread count per recipient — partial index keeps it small.
-- The frontend computes "unread for me" with a query like
-- SELECT count(*) WHERE thread_id IN (my threads) AND read_at IS NULL
--   AND author_id <> auth.uid()
create index if not exists dm_messages_unread
  on public.dm_messages (thread_id)
  where read_at is null;

alter table public.dm_messages enable row level security;

drop policy if exists "dm_messages select participant" on public.dm_messages;
drop policy if exists "dm_messages insert author" on public.dm_messages;
drop policy if exists "dm_messages update read" on public.dm_messages;

-- Read: caller must be one of the two thread participants.
-- The subquery looks up the thread row; RLS on dm_threads has
-- already established that the caller can see it, so this is
-- consistent.
create policy "dm_messages select participant"
  on public.dm_messages for select to authenticated
  using (
    exists (
      select 1 from public.dm_threads t
      where t.id = dm_messages.thread_id
        and auth.uid() in (t.user_a, t.user_b)
    )
  );

-- Insert: caller is the author AND a participant in the thread.
-- This blocks impersonation (someone setting author_id to a
-- different user) and prevents writes to threads they aren't in.
create policy "dm_messages insert author"
  on public.dm_messages for insert to authenticated
  with check (
    auth.uid() = author_id
    and exists (
      select 1 from public.dm_threads t
      where t.id = thread_id
        and auth.uid() in (t.user_a, t.user_b)
    )
  );

-- Update: only the recipient can mark a message read. We allow
-- participants to UPDATE but the WITH CHECK clamps so they can
-- only flip read_at on messages NOT authored by them — i.e., a
-- recipient can mark messages addressed to them as read, but
-- can't mark their OWN messages as "read" to fake an ack.
create policy "dm_messages update read"
  on public.dm_messages for update to authenticated
  using (
    author_id <> auth.uid()
    and exists (
      select 1 from public.dm_threads t
      where t.id = dm_messages.thread_id
        and auth.uid() in (t.user_a, t.user_b)
    )
  )
  with check (
    author_id <> auth.uid()
  );

-- ============================================================
-- 3. last_message_at sync trigger
-- ============================================================
-- Bumps the parent thread's last_message_at on every insert so
-- the "my threads" list naturally orders by recent activity.
-- security definer because the participant's RLS update policy
-- isn't broad enough to update a peer's row directly (it
-- requires the caller to be a participant, which is true here).
-- ============================================================

create or replace function public.dm_thread_bump() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dm_threads
     set last_message_at = new.created_at
   where id = new.thread_id;
  return new;
end $$;

drop trigger if exists dm_thread_bump on public.dm_messages;
create trigger dm_thread_bump
  after insert on public.dm_messages
  for each row execute function public.dm_thread_bump();

-- ============================================================
-- 4. realtime publication
-- ============================================================
-- Opt both tables into supabase_realtime so the conversation
-- view can subscribe to INSERTs on dm_messages and the threads
-- list can subscribe to UPDATEs (last_message_at bumps) and
-- INSERTs (new threads with someone). Idempotent via
-- duplicate_object catch.
-- ============================================================

do $$
begin
  begin
    alter publication supabase_realtime add table public.dm_messages;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.dm_threads;
  exception when duplicate_object then null;
  end;
end $$;
