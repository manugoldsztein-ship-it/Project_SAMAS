-- ============================================================
-- THESES — investment thesis tracker (samas-0.3.3)
-- ============================================================
-- When the user buys an asset, they can optionally write a 1-2
-- sentence thesis ("why I'm buying $NVDA: AI infrastructure tailwind
-- + earnings beat last quarter"). Saved as a row here. Later, the
-- user can ask the AI to validate the thesis against current data
-- (price action, news, fundamentals) — IA returns a verdict + reason.
--
-- Status: 'active' = the user still holds the position and the
-- thesis is in play. 'closed' = position fully sold; thesis archived.
-- 'invalidated' = user marked it as broken/wrong (post-mortem).
--
-- One thesis per (user, ticker, status='active') — adding a new
-- thesis on the same ticker while an active one exists archives the
-- old one (handled by a trigger below).
-- ============================================================

create table if not exists public.theses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  ticker          text not null,
  thesis_text     text not null check (length(thesis_text) between 1 and 500),
  -- 'active' | 'closed' | 'invalidated'
  status          text not null default 'active' check (status in ('active','closed','invalidated')),
  -- Cached last-validation result. Populated by validate-thesis Edge
  -- Function so re-opening the AssetSheet doesn't re-run the LLM
  -- unless the user explicitly taps "Validar de nuevo".
  -- Verdict: 'holds' | 'weakened' | 'broken' | null
  last_verdict    text check (last_verdict in ('holds','weakened','broken')),
  last_reason     text,
  last_validated_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists theses_user_ticker_active_idx
  on public.theses (user_id, ticker)
  where status = 'active';

create index if not exists theses_user_recent_idx
  on public.theses (user_id, created_at desc);

alter table public.theses enable row level security;

drop policy if exists "theses select own" on public.theses;
create policy "theses select own"
  on public.theses for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "theses insert own" on public.theses;
create policy "theses insert own"
  on public.theses for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "theses update own" on public.theses;
create policy "theses update own"
  on public.theses for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "theses delete own" on public.theses;
create policy "theses delete own"
  on public.theses for delete
  to authenticated
  using (auth.uid() = user_id);

-- When inserting a new active thesis on a ticker, archive any
-- previous active thesis for the same (user, ticker). Keeps the
-- "current thesis" lookup clean — most-recent active wins.
create or replace function public.theses_archive_prior()
returns trigger
language plpgsql
as $$
begin
  if NEW.status = 'active' then
    update public.theses
       set status = 'closed', updated_at = now()
     where user_id = NEW.user_id
       and ticker  = NEW.ticker
       and status  = 'active'
       and id     <> NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists theses_archive_prior_trg on public.theses;
create trigger theses_archive_prior_trg
  after insert on public.theses
  for each row execute function public.theses_archive_prior();

comment on table public.theses is
  'User investment theses. One active per (user, ticker); previous active rows auto-archived on new insert.';
