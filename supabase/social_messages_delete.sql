-- ============================================================
-- DM thread + message DELETE policies (samas-0.3.9)
-- ============================================================
-- Pre-0.3.9 dm_threads + dm_messages had SELECT / INSERT / UPDATE
-- policies but NO DELETE policy — meaning users couldn't delete
-- their own conversations. The Settings 'Cancelá cuando quieras'
-- promise + the new "Borrar conversación" button in
-- ConversationView need this to be backed by RLS.
--
-- Semantics:
--   - dm_threads: any participant can delete the thread. The FK
--     cascade on dm_messages.thread_id removes every message.
--   - dm_messages: an author can delete their own message (in
--     case they want to retract a single line without nuking the
--     whole conversation). Recipients cannot delete the peer's
--     messages — that would let one side rewrite history.
--
-- HOW TO RUN
--   Supabase SQL editor → New query → paste → Run.
-- ============================================================

-- 1. Delete thread (any participant)
drop policy if exists "dm_threads delete participant" on public.dm_threads;
create policy "dm_threads delete participant"
  on public.dm_threads for delete
  to authenticated
  using (auth.uid() in (user_a, user_b));

-- 2. Delete own message (author only)
drop policy if exists "dm_messages delete own" on public.dm_messages;
create policy "dm_messages delete own"
  on public.dm_messages for delete
  to authenticated
  using (auth.uid() = author_id);

comment on policy "dm_threads delete participant" on public.dm_threads is
  'Any of the two participants can delete the entire conversation. Cascade removes messages.';
comment on policy "dm_messages delete own" on public.dm_messages is
  'Authors can retract individual messages. Peers cannot delete each other''s.';
