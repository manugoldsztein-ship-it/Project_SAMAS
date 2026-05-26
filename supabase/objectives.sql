-- ============================================================
-- OBJECTIVES — user investment goals + AI-classified plans
-- (samas-0.4.12)
-- ============================================================
-- Replaces the legacy localStorage-only "samas_v2_ai_plan" persistence
-- with a real per-user table. One active objective per user (more
-- complex multi-goal tracking is a future patch).
--
-- The AI plan is stored as a structured jsonb so the renderer can
-- evolve without re-running the AI:
--   plan = {
--     strategy: "conservadora" | "moderada" | "agresiva",
--     allocation: [{ category: "CEDEAR", pctOfBook: 35 }, ...],
--     monthlyAporte: { amount, currency },
--     milestones: [{ atMonths, expectedValue, label }, ...],
--     narrative: "1-2 sentence Claude-written explanation"
--   }
--
-- HOW TO RUN
--   Supabase SQL editor → New query → paste → Run.
-- ============================================================

create table if not exists public.objectives (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- Free-text user goal description (e.g. "Comprar un departamento",
  -- "Jubilación", "Viaje a Japón"). Up to 200 chars.
  goal_text       text not null check (length(goal_text) between 1 and 200),
  -- Target amount + currency. Currency must match what the user
  -- thinks in — we don't auto-convert. Nullable target_amount lets
  -- the user say "I don't know how much, just tell me what to do."
  target_amount   numeric(18, 2) check (target_amount is null or target_amount > 0),
  target_currency text check (target_currency in ('ARS','USD')),
  -- Horizon in months (preferred over a date so we don't have to
  -- recalculate when "5 years from now" drifts).
  horizon_months  integer not null check (horizon_months between 1 and 600),
  -- AI-classified strategy.
  strategy        text check (strategy in ('conservadora','moderada','agresiva')),
  -- Full plan jsonb (allocation array, monthlyAporte, milestones,
  -- narrative). Schema evolves; the column is jsonb so we can add
  -- fields without migrations.
  plan            jsonb,
  -- Active flag — only one active per user. New objective archives
  -- the previous (handled by an after-insert trigger below).
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists objectives_user_active_idx
  on public.objectives (user_id)
  where active = true;

create index if not exists objectives_user_recent_idx
  on public.objectives (user_id, created_at desc);

alter table public.objectives enable row level security;

drop policy if exists "objectives select own" on public.objectives;
create policy "objectives select own"
  on public.objectives for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "objectives insert own" on public.objectives;
create policy "objectives insert own"
  on public.objectives for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "objectives update own" on public.objectives;
create policy "objectives update own"
  on public.objectives for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "objectives delete own" on public.objectives;
create policy "objectives delete own"
  on public.objectives for delete
  to authenticated
  using (auth.uid() = user_id);

-- After-insert trigger: archive any prior active objective for the
-- same user when a new active one is created. Keeps the "current
-- goal" lookup (where active=true) returning exactly one row.
create or replace function public.objectives_archive_prior()
returns trigger
language plpgsql
as $$
begin
  if NEW.active = true then
    update public.objectives
       set active = false, updated_at = now()
     where user_id = NEW.user_id
       and active = true
       and id <> NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists objectives_archive_prior_trg on public.objectives;
create trigger objectives_archive_prior_trg
  after insert on public.objectives
  for each row execute function public.objectives_archive_prior();

comment on table public.objectives is
  'User investment goals + AI-classified plans. One active per user; auto-archive on new insert.';
