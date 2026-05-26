-- ============================================================
-- STOP LOSSES + PRICE ALERTS — per-user risk rules
-- ============================================================
-- These are small keyed maps ("GGAL → stop at 7500", "AAPL →
-- notify when above 20000") that are always read/written whole.
-- Relational tables would be overkill — store them as JSONB on
-- profiles.
--
--   stop_losses:  { "GGAL": 7500, "YPF": 36000, ... }
--   price_alerts: { "AAPL": { "price": 20000, "direction": "above" }, ... }
--
-- RLS on profiles already restricts read/write to the owner so
-- no extra policies are needed.
-- ============================================================

alter table public.profiles
  add column if not exists stop_losses  jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists price_alerts jsonb not null default '{}'::jsonb;

comment on column public.profiles.stop_losses  is
  'Per-ticker stop-loss prices. Map: { ticker: price_in_user_currency }.';
comment on column public.profiles.price_alerts is
  'Per-ticker price alerts. Map: { ticker: { price, direction: "above"|"below" } }.';
