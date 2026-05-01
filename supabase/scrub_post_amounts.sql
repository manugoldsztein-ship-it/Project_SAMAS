-- ============================================================
-- SCRUB existing posts to remove leaked qty / price / totalUsd
-- (samas-0.3.7 — companion to 0.3.5 + 0.3.6 privacy fixes)
-- ============================================================
-- Pre-0.3.5: shared portfolio cards stored payload.totalUsd and
-- per-row payload.rows[].qty.
-- Pre-0.3.6: shared trade cards stored trade.qty and trade.price
-- on the posts row.
-- New posts no longer write those fields. Existing rows still
-- have them in the DB even though the renderer ignores them — so
-- anyone with API access (admin tooling, future migrations,
-- accidental UI re-render against the raw row) could read them.
--
-- This migration:
--   1. For posts.kind = 'portfolio': removes payload.totalUsd, and
--      strips payload.rows[].qty + payload.rows[].currency. Keeps
--      payload.rows[].ticker + payload.rows[].gainPct + payload.gainPct
--      + payload.capturedAt. Adds payload.rows[].pctOfBook = null
--      (the renderer falls back to '—' when null, which is the
--      already-handled legacy display path).
--   2. For posts.trade IS NOT NULL: rewrites the trade jsonb to
--      keep only { side, ticker }. Drops qty + price.
--
-- Idempotent. Safe to re-run. Only touches rows that still have
-- the leaky fields — already-scrubbed rows are no-ops.
--
-- HOW TO RUN
--   Supabase SQL editor → New query → paste → Run. Inspect output:
--   the SELECTs at the bottom report how many rows were touched.
-- ============================================================

-- 1. Portfolio payloads — strip totalUsd and per-row qty/currency
with affected as (
  select id from public.posts
   where kind = 'portfolio'
     and payload is not null
     and (payload ? 'totalUsd' or jsonb_path_exists(payload, '$.rows[*].qty'))
)
update public.posts p
set payload = (
  -- Remove top-level totalUsd, then map rows[] to the safe shape.
  (payload - 'totalUsd')
  || jsonb_build_object(
    'rows',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'ticker',    r->>'ticker',
            'gainPct',   coalesce((r->>'gainPct')::numeric, 0),
            'pctOfBook', case when r ? 'pctOfBook' then (r->>'pctOfBook')::numeric else null end
          )
        )
        from jsonb_array_elements(payload->'rows') r
      ),
      '[]'::jsonb
    )
  )
)
from affected
where p.id = affected.id;

-- 2. Trade payloads — keep only { side, ticker }
with affected as (
  select id from public.posts
   where trade is not null
     and (trade ? 'qty' or trade ? 'price')
)
update public.posts p
set trade = jsonb_build_object(
  'side',   trade->>'side',
  'ticker', trade->>'ticker'
)
from affected
where p.id = affected.id;

-- 3. Sanity report. Run these separately if you want a dry-run
--    feel: comment the UPDATEs above, run these, see the counts.
do $$
declare
  v_portfolio_dirty int;
  v_trade_dirty int;
begin
  select count(*) into v_portfolio_dirty
    from public.posts
   where kind = 'portfolio'
     and payload is not null
     and (payload ? 'totalUsd' or jsonb_path_exists(payload, '$.rows[*].qty'));
  select count(*) into v_trade_dirty
    from public.posts
   where trade is not null
     and (trade ? 'qty' or trade ? 'price');
  raise notice 'Post-scrub state: portfolio rows still leaky=%, trade rows still leaky=%', v_portfolio_dirty, v_trade_dirty;
end;
$$;
