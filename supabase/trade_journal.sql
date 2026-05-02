-- ============================================================
-- trade_journal.sql (samas-0.4.29) — auto-tracked trade rationale
-- ============================================================
-- The Trade Journal feature builds on the existing thesis capture
-- (samas-0.3.3): every BUY records the user's tesis at entry. We
-- now persist a per-trade journal entry that links the original
-- tesis to the eventual outcome (sell at gain / sell at loss / still
-- holding) and enriches it with AI-generated post-trade reflection.
--
-- Why a separate table vs reusing public.theses + public.orders:
--   - public.theses is per-ticker (one active thesis per ticker),
--     not per-trade. A user buying NVDA twice has one thesis but
--     two journal entries.
--   - public.orders only has the side/qty/price; it doesn't carry
--     the tesis text or the post-trade narrative.
--   - Linking via trade_id keeps both sides clean.
--
-- The "outcome" field is filled in by the matching SELL of the same
-- ticker (or by a periodic "review" job for still-open positions).
-- For the prototype we'll surface this in the UI lazily — when the
-- user opens the Journal view, we compute outcomes on the fly from
-- the orders table. Persistence comes when the production wiring
-- needs partner reconciliation.
-- ============================================================

create table if not exists public.trade_journal (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- The triggering trade (BUY) — references public.orders.id when
  -- the order rail is real. For the prototype where orders is mock,
  -- we accept null and use the (ticker, occurred_at) tuple as the
  -- correlation key.
  order_id        uuid,
  ticker          text not null,
  side            text not null check (side in ('buy','sell')),
  qty             numeric(18,6) not null,
  price           numeric(18,4) not null,
  -- Tesis captured at trade time. Free-text, capped at 1000 chars
  -- by the client. Optional — if empty, the journal entry still
  -- exists as a record but won't get AI follow-up.
  thesis_at_entry text,
  -- Lessons / reflection generated post-close. Either user-typed
  -- or AI-suggested, capped at 600 chars. Filled when the user
  -- requests "reflexionar sobre este trade" from the Journal.
  reflection      text,
  -- Outcome label, computed lazily client-side or filled by a
  -- periodic review. Allowed values: 'open' (still holding),
  -- 'gain', 'loss', 'flat' (close to break-even, ±2%).
  outcome         text check (outcome in ('open','gain','loss','flat')),
  -- Realized P/L in USD-equivalent. Null while open.
  realized_usd    numeric(18,2),
  occurred_at     timestamptz not null default now(),
  closed_at       timestamptz
);

create index if not exists trade_journal_user_id_idx
  on public.trade_journal (user_id, occurred_at desc);
create index if not exists trade_journal_ticker_idx
  on public.trade_journal (user_id, ticker);

alter table public.trade_journal enable row level security;

drop policy if exists "trade_journal: user reads own" on public.trade_journal;
create policy "trade_journal: user reads own" on public.trade_journal
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "trade_journal: user inserts own" on public.trade_journal;
create policy "trade_journal: user inserts own" on public.trade_journal
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "trade_journal: user updates own" on public.trade_journal;
create policy "trade_journal: user updates own" on public.trade_journal
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "trade_journal: user deletes own" on public.trade_journal;
create policy "trade_journal: user deletes own" on public.trade_journal
  for delete to authenticated
  using (user_id = auth.uid());
