-- ============================================================
-- ARTICLES — cache for news fetched by the fetch-news Edge Function
-- ============================================================
-- News items pulled from Finnhub (global tickers) and Argentine RSS
-- feeds (ARG tickers). Cached server-side so:
--   - the API budget for Finnhub stays low (60 req/min free tier),
--   - one user's lookup serves every other user,
--   - the client gets fast reads even on cold cache.
--
-- Privacy: news links are public information from public sources, so
-- the table is read-only to every authenticated user (no per-user
-- gating). Writes are restricted to the service_role key, which only
-- lives inside the Edge Function.
--
-- Dedup: (ticker, url) is unique. The same article that mentions
-- multiple tickers will be inserted once per ticker — that's fine,
-- it lets the per-ticker query stay simple and cheap.
-- ============================================================

create table if not exists public.articles (
  id            uuid primary key default gen_random_uuid(),
  ticker        text not null,
  title         text not null,
  summary       text,
  url           text not null,
  source        text,
  image_url     text,
  published_at  timestamptz not null,
  fetched_at    timestamptz not null default now(),
  unique (ticker, url)
);

create index if not exists articles_ticker_pub
  on public.articles (ticker, published_at desc);

-- "Stale lookup" index — used by the Edge Function to decide whether
-- to refetch (any row for ticker fetched within 15min => use cache).
create index if not exists articles_ticker_fetched
  on public.articles (ticker, fetched_at desc);

alter table public.articles enable row level security;

-- Read: any authenticated user can read all articles.
drop policy if exists "articles read" on public.articles;
create policy "articles read"
  on public.articles
  for select
  to authenticated
  using (true);

-- Write: nobody at the policy layer. The Edge Function uses the
-- service_role key which bypasses RLS entirely, so no INSERT / UPDATE
-- / DELETE policy is needed for normal users.

comment on table public.articles is
  'Cache of news articles pulled by the fetch-news Edge Function. Read-only for authenticated users; writes only via service_role.';
comment on column public.articles.ticker is
  'Ticker the article is associated with. Cross-ticker articles are inserted once per ticker.';
comment on column public.articles.fetched_at is
  'When the row was upserted by the Edge Function. Used for cache freshness (15min TTL).';
