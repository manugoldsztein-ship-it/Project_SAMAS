-- ============================================================
-- SAMAS — Copy Trade (samas-0.4.90)
-- ============================================================
-- One table: copy_relationships. Tracks "user A copies user B's
-- trades at X% allocation". UNIQUE(copier_id, leader_id) prevents
-- duplicate relationships; deactivation sets is_active=false +
-- stopped_at instead of deleting so we keep the history audit-able.
--
-- Why a percent (10..100) rather than a fixed cash allocation:
--   - Mirrors etoro / cocos style.
--   - Cleaner story for Cohen: "X% of every trade the leader makes
--     fires in the copier's account, sized by their portfolio."
--   - Avoids stranded leftover cash from fixed-amount allocations.
--
-- Why no actual trade mirroring trigger yet:
--   - Real fills go through Cohen's order API (or whichever broker
--     we wire). We don't want to write fake fills into
--     public.transactions and confuse the rest of the app.
--   - The table is the contract: when broker integration lands,
--     an Edge Function reads from this table on every new leader
--     trade and fans out proportional orders.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.copy_relationships (
  id              uuid primary key default gen_random_uuid(),
  copier_id       uuid not null references auth.users(id) on delete cascade,
  leader_id       uuid not null references auth.users(id) on delete cascade,
  allocation_pct  smallint not null check (allocation_pct between 1 and 100),
  is_active       boolean not null default true,
  started_at      timestamptz not null default now(),
  stopped_at      timestamptz,
  check (copier_id <> leader_id),
  unique (copier_id, leader_id)
);

create index if not exists copy_rel_copier_active_idx
  on public.copy_relationships (copier_id) where is_active;

create index if not exists copy_rel_leader_active_idx
  on public.copy_relationships (leader_id) where is_active;

alter table public.copy_relationships enable row level security;

-- Copier owns their own rows: insert / select / update / delete.
drop policy if exists copy_rel_copier_select on public.copy_relationships;
create policy copy_rel_copier_select on public.copy_relationships
  for select using (auth.uid() = copier_id);

drop policy if exists copy_rel_copier_insert on public.copy_relationships;
create policy copy_rel_copier_insert on public.copy_relationships
  for insert with check (auth.uid() = copier_id);

drop policy if exists copy_rel_copier_update on public.copy_relationships;
create policy copy_rel_copier_update on public.copy_relationships
  for update using (auth.uid() = copier_id) with check (auth.uid() = copier_id);

drop policy if exists copy_rel_copier_delete on public.copy_relationships;
create policy copy_rel_copier_delete on public.copy_relationships
  for delete using (auth.uid() = copier_id);

-- Leader can SEE who's copying them (read-only, no mutate).
drop policy if exists copy_rel_leader_select on public.copy_relationships;
create policy copy_rel_leader_select on public.copy_relationships
  for select using (auth.uid() = leader_id);
