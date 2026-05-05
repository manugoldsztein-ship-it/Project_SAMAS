-- ============================================================
-- Transactions → accounts.balance propagation (samas-0.4.13)
-- ============================================================
-- Bug Manuel hit: broker.placeOrder inserted into public.transactions
-- on every fill but never updated public.accounts.balance. So buys
-- didn't deduct cash and sells didn't credit cash. His ARS balance
-- stayed pinned at the demo-seed value (6244) while the ledger sum
-- diverged to -841,500.
--
-- Fix: a single AFTER INSERT trigger on transactions that propagates
-- every signed amount into accounts.balance via UPSERT. ANY caller
-- that inserts a transactions row now gets the balance updated for
-- free — placeOrder, deposit, withdraw, swap, wallet_credits, future
-- bank-rail webhooks, all of them.
--
-- Side effect: applyLedgerEntry in src/v2/api/wallet.js used to do
-- the balance update manually + then insert transactions. With this
-- trigger that would double-apply. The wallet.js refactor that
-- accompanies this migration drops the manual balance update and
-- relies on the trigger. Same for wallet_credits_propagate (was
-- doing both; now only inserts the transactions row).
--
-- This migration is idempotent — re-running is a no-op.
--
-- HOW TO RUN
--   Supabase SQL editor → New query → paste → Run. (Already applied
--   via Management API as part of 0.4.13.)
-- ============================================================

create or replace function public.transactions_to_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Upsert accounts row, increment balance by the transaction's
  -- signed amount. Inflows positive, outflows negative — so the
  -- arithmetic is identical for deposits, trade fills, swaps,
  -- aporte credits, and any future kind we add to the ledger.
  insert into public.accounts (user_id, currency, balance, updated_at)
  values (NEW.user_id, NEW.currency, NEW.amount, now())
  on conflict (user_id, currency)
  do update set
    balance = accounts.balance + NEW.amount,
    updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists transactions_to_balance_trg on public.transactions;
create trigger transactions_to_balance_trg
  after insert on public.transactions
  for each row execute function public.transactions_to_balance();

-- Update wallet_credits_propagate to NOT also update accounts —
-- the new transactions trigger will handle it. We just insert the
-- transactions row.
create or replace function public.wallet_credits_propagate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
begin
  v_ref := case NEW.source
            when 'aporte_recurring' then 'Aporte mensual'
            when 'manual' then 'Top-up manual'
            else NEW.source
          end;

  -- Only insert transactions. The transactions_to_balance trigger
  -- handles accounts.balance.
  insert into public.transactions
    (user_id, kind, amount, currency, reference, memo, created_at)
  values
    (NEW.user_id, 'deposit', NEW.amount, NEW.currency, v_ref,
     coalesce(NEW.note, null), NEW.credited_at);

  return NEW;
end;
$$;

comment on function public.transactions_to_balance() is
  'Propagates every transactions insert into accounts.balance. samas-0.4.13.';
