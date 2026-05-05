-- ============================================================
-- NOTIFICATIONS — in-app inbox of past pings
-- ============================================================
-- Every time something happens that the user might want to revisit
-- — a price alert fired, an aporte landed, a news ticker matched,
-- someone mentioned them on Social — we drop a row here. The
-- frontend renders this as the bell-icon inbox.
--
-- Why a separate table from wallet_credits / price_alerts:
--   - Different shapes (some have URLs, some have ticker, some have
--     deep-link refs).
--   - Marking "read" is per-user state; the source rows are the
--     immutable event of record.
--   - Batch operations (mark all read) are clean against this table.
--
-- The cron functions (check-price-alerts, process-recurring-aportes)
-- write rows here in addition to their primary side effect. Push
-- notifications are sent from those same flows, so the inbox row
-- and the push are siblings.
-- ============================================================

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- 'price_alert' | 'aporte' | 'news' | 'mention' | 'system'
  -- Stored as text instead of an enum so adding new kinds doesn't
  -- need a migration. Frontend maps unknown kinds to the 'system'
  -- icon for forward compatibility.
  kind        text not null,
  title       text not null,
  body        text,
  -- Free-form payload for deep-linking. Examples:
  --   { "ticker": "AAPL", "alertId": "..." }
  --   { "aporteId": "...", "amount": 10000, "currency": "ARS" }
  --   { "url": "https://..." }
  data        jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Hot path index for the inbox query (most-recent first).
create index if not exists notifications_user_recent
  on public.notifications (user_id, created_at desc);

-- Unread-count index. Partial index because most rows are read very
-- shortly after creation; keeping the index small makes the count(*)
-- query a near-no-op even at millions of rows.
create index if not exists notifications_unread
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "notifications select own" on public.notifications;
create policy "notifications select own"
  on public.notifications
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Users can mark their own rows read (UPDATE) and delete them (clear
-- inbox). They cannot insert directly — only the service-role-using
-- Edge Functions create rows.
drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own"
  on public.notifications
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own"
  on public.notifications
  for delete
  to authenticated
  using (auth.uid() = user_id);

comment on table public.notifications is
  'In-app inbox. Cron / Edge Functions write rows; users read, mark-read, and delete.';
comment on column public.notifications.kind is
  'price_alert | aporte | news | mention | system. Free-form text so new kinds do not need a migration.';
comment on column public.notifications.read_at is
  'Set when the user marks the row read. Null = unread, surfaced in the bell badge count.';
