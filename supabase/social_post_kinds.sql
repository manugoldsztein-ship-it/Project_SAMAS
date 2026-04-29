-- ============================================================
-- POST KINDS — make portfolio shares a first-class post type.
--
-- Why: pre-0.0.79 portfolio shares were just text pasted into a
-- post body. Two problems for the Cohen pitch:
--   1. The user could edit the numbers before publishing —
--      effectively faking gains. Bad trust signal.
--   2. They looked identical to a regular text post — no visual
--      differentiation, no dedicated tab to browse them.
--
-- Fix: add kind + payload to posts. kind='portfolio' renders as a
-- structured card (read-only, generated client-side at compose
-- time from the live broker API), and feeds expose a Portfolios
-- sub-tab that filters on kind='portfolio'.
--
-- payload jsonb shape for kind='portfolio' (0.0.79):
--   {
--     "totalUsd": 12345,
--     "capturedAt": "2026-04-29T18:45:00Z",
--     "rows": [
--       { "ticker": "AAPL", "qty": 60, "gainPct": 7.2, "currency": "USD" },
--       ...
--     ]
--   }
-- ============================================================

alter table public.posts
  add column if not exists kind    text    not null default 'text',
  add column if not exists payload jsonb;

-- Whitelist allowed kinds so a typo in the client can't smuggle
-- garbage into the feed. Drop-then-recreate so re-running the
-- migration after a kind list change is idempotent.
alter table public.posts drop constraint if exists posts_kind_check;
alter table public.posts
  add constraint posts_kind_check
  check (kind in ('text', 'portfolio'));

-- Partial index for the Portfolios sub-tab feed query (kind filter
-- + recency order). Skipping kind='text' rows means the index stays
-- small even as the posts table grows.
create index if not exists posts_kind_portfolio_idx
  on public.posts (created_at desc)
  where kind = 'portfolio' and deleted_at is null;

-- Loosen the body check: portfolio posts can publish with empty
-- body (the card IS the post). Text posts still require ≥1 char.
-- Both are capped at 280.
alter table public.posts drop constraint if exists posts_body_check;
alter table public.posts
  add constraint posts_body_check
  check (
    (kind = 'portfolio' and char_length(body) <= 280) or
    (kind <> 'portfolio' and char_length(body) between 1 and 280)
  );
