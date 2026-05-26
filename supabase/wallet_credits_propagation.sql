-- ============================================================
-- Propagate wallet_credits → accounts.balance + transactions
-- (samas-0.4.7 — aporte recurring fix)
-- ============================================================
-- Bug: the daily aporte cron (process-recurring-aportes) only
-- INSERTed into public.wallet_credits — an audit-trail table.
-- The user's `accounts.balance` was never increased and no row
-- appeared in `transactions`. So:
--   - Wallet hero card showed stale balance.
--   - Movimientos list never reflected the aporte.
--   - User experience: "monthly aporte does nothing".
--
-- Fix: add an AFTER INSERT trigger on wallet_credits that:
--   1. Upserts accounts row, balance += NEW.amount.
--   2. Inserts a transactions row (kind='deposit', signed amount).
--
-- Trade-off considered: do this in the cron's TypeScript code
-- instead. Rejected because:
--   - A trigger fires for ANY future inserter (manual top-ups,
--     bank-rail integrations, etc.) — single source of truth.
--   - Atomic per Postgres semantics; no partial-success window.
--
-- HOW TO RUN
--   Already applied via Management API. Idempotent — the
--   create-or-replace function + drop+create trigger pattern.
-- ============================================================

create or replace function public.wallet_credits_propagate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
begin
  -- Reference text shown in the Movimientos list. Differentiate
  -- aporte fires from manual top-ups so the user sees the source.
  v_ref := case NEW.source
            when 'aporte_recurring' then 'Aporte mensual'
            when 'manual' then 'Top-up manual'
            else NEW.source
          end;

  -- 1. Upsert accounts row, increment balance.
  insert into public.accounts (user_id, currency, balance, updated_at)
  values (NEW.user_id, NEW.currency, NEW.amount, now())
  on conflict (user_id, currency)
  do update set balance = accounts.balance + NEW.amount,
                updated_at = now();

  -- 2. Insert a transactions row so the credit appears in
  --    Movimientos. Signed amount: positive for inflow.
  insert into public.transactions
    (user_id, kind, amount, currency, reference, memo, created_at)
  values
    (NEW.user_id, 'deposit', NEW.amount, NEW.currency, v_ref,
     coalesce(NEW.note, null), NEW.credited_at);

  return NEW;
end;
$$;

drop trigger if exists wallet_credits_propagate_trg on public.wallet_credits;
create trigger wallet_credits_propagate_trg
  after insert on public.wallet_credits
  for each row execute function public.wallet_credits_propagate();

comment on function public.wallet_credits_propagate() is
  'Propagates an aporte / manual credit into accounts.balance + transactions. samas-0.4.7.';
