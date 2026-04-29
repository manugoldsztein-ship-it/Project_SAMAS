-- ============================================================
-- WATCHLISTS — patch on top of schema.sql to support v2 broker
-- features: per-list color tag (Pro, samas-0.0.47) and explicit
-- ticker ordering (reorderWatchlist arrows).
--
-- Idempotent — adds columns + indexes + trigger only if missing.
-- The base tables (watchlists, watchlist_tickers) and their RLS
-- policies were defined in schema.sql; this file extends them.
--
-- 0.0.78: companion to 0.0.76 (holdings + orders moved to
-- Supabase). After this lands, watchlists are durable across
-- reinstalls instead of vanishing with the WebView cache.
-- ============================================================

-- watchlists: add `color` (Pro tag) and `updated_at`.
alter table public.watchlists
  add column if not exists color      text,
  add column if not exists updated_at timestamptz not null default now();

-- watchlist_tickers: add `position` so reorder arrows persist.
-- Default 0 means new rows land at the top of the list; UI passes
-- explicit positions when the user drags / arrow-reorders.
alter table public.watchlist_tickers
  add column if not exists position integer not null default 0;

create index if not exists watchlist_tickers_order_idx
  on public.watchlist_tickers (watchlist_id, position);

-- updated_at trigger on watchlists (rename / color / reorder).
create or replace function public.touch_watchlists_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists watchlists_touch_updated_at on public.watchlists;
create trigger watchlists_touch_updated_at
  before update on public.watchlists
  for each row execute function public.touch_watchlists_updated_at();
