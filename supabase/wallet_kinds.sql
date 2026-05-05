-- ============================================================
-- TRANSACTIONS — extend kind whitelist for the wallet migration.
--
-- 0.0.80 turns wallet balance + transactions into Supabase-backed
-- state. The original CHECK only allowed deposit/withdrawal/
-- dividend/fee/adjustment, but:
--   - broker.js (since 0.0.76) inserts trade_buy / trade_sell rows
--     for every fill — silently failing because the kind wasn't in
--     the whitelist (the insert was wrapped without an `if (error)
--     throw`, hiding the rejection).
--   - wallet.js needs swap rows for ARS↔USD conversions.
--
-- Drop + recreate so re-running this migration after a kind list
-- change is idempotent.
-- ============================================================

alter table public.transactions
  drop constraint if exists transactions_kind_check;

alter table public.transactions
  add constraint transactions_kind_check
  check (kind in (
    'deposit', 'withdrawal',     -- cash in/out via partner rails
    'trade_buy', 'trade_sell',   -- broker fills (signed amount = cash impact)
    'swap',                      -- ARS↔USD conversion (one row per leg-pair)
    'dividend', 'fee', 'adjustment'
  ));
