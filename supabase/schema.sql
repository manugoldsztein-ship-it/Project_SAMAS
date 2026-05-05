-- ============================================================
-- SAMAS — Initial schema
-- ============================================================
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor
-- → New query → paste → Run). It's idempotent-ish: re-running it
-- will fail on the CREATE TABLE statements, but that's fine — the
-- schema only needs to be applied once.
--
-- Row Level Security (RLS) is enabled on every table and the
-- policies below restrict each user to only seeing / mutating
-- their own rows. `auth.uid()` is set automatically by Supabase
-- from the JWT attached to the request.
-- ============================================================

-- --------------------------------------------------
-- PROFILES — 1:1 with auth.users, holds KYC-ish data
-- --------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text,
  apellido    text,
  dni         text,
  pais        text default 'AR',
  phone       text,
  phone_verified boolean default false,
  tier        text default 'demo' check (tier in ('demo','verificado','operativo')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up.
-- This keeps the 1:1 invariant without needing the client to do an
-- extra INSERT after signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, phone)
  values (new.id, new.phone)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------
-- ACCOUNTS — cash balance per user per currency
-- --------------------------------------------------
create table public.accounts (
  user_id    uuid not null references auth.users(id) on delete cascade,
  currency   text not null check (currency in ('ARS','USD')),
  balance    numeric(18,2) not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, currency)
);

alter table public.accounts enable row level security;

create policy "Users read own accounts"
  on public.accounts for select
  using (auth.uid() = user_id);

create policy "Users upsert own accounts"
  on public.accounts for insert
  with check (auth.uid() = user_id);

create policy "Users update own accounts"
  on public.accounts for update
  using (auth.uid() = user_id);

-- --------------------------------------------------
-- HOLDINGS — current positions
-- --------------------------------------------------
create table public.holdings (
  user_id   uuid not null references auth.users(id) on delete cascade,
  ticker    text not null,
  qty       numeric(18,6) not null default 0,
  avg_cost  numeric(18,4) not null default 0,
  currency  text not null check (currency in ('ARS','USD')),
  updated_at timestamptz default now(),
  primary key (user_id, ticker)
);

alter table public.holdings enable row level security;

create policy "Users read own holdings"
  on public.holdings for select
  using (auth.uid() = user_id);

create policy "Users upsert own holdings"
  on public.holdings for insert
  with check (auth.uid() = user_id);

create policy "Users update own holdings"
  on public.holdings for update
  using (auth.uid() = user_id);

create policy "Users delete own holdings"
  on public.holdings for delete
  using (auth.uid() = user_id);

create index holdings_user_idx on public.holdings(user_id);

-- --------------------------------------------------
-- ORDERS — historical buy/sell orders
-- --------------------------------------------------
create table public.orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  ticker      text not null,
  side        text not null check (side in ('buy','sell')),
  qty         numeric(18,6) not null,
  price       numeric(18,4) not null,
  currency    text not null check (currency in ('ARS','USD')),
  status      text not null default 'executed' check (status in ('pending','executed','cancelled','rejected')),
  broker_ref  text,             -- future: Cohen's order ID
  fees        numeric(18,2) default 0,
  created_at  timestamptz default now(),
  executed_at timestamptz
);

alter table public.orders enable row level security;

create policy "Users read own orders"
  on public.orders for select
  using (auth.uid() = user_id);

create policy "Users insert own orders"
  on public.orders for insert
  with check (auth.uid() = user_id);

-- Orders are append-only from the client; updates (status changes)
-- will come from the server-side broker sync worker once Cohen is
-- integrated, so no UPDATE/DELETE policy here.

create index orders_user_created_idx on public.orders(user_id, created_at desc);

-- --------------------------------------------------
-- TRANSACTIONS — cash ledger (deposits, withdrawals, dividends, fees)
-- --------------------------------------------------
create table public.transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('deposit','withdrawal','dividend','fee','adjustment')),
  amount     numeric(18,2) not null,          -- positive for inflow, negative for outflow
  currency   text not null check (currency in ('ARS','USD')),
  reference  text,                             -- deposit reference, ticker for dividends, etc.
  memo       text,
  created_at timestamptz default now()
);

alter table public.transactions enable row level security;

create policy "Users read own transactions"
  on public.transactions for select
  using (auth.uid() = user_id);

create policy "Users insert own transactions"
  on public.transactions for insert
  with check (auth.uid() = user_id);

create index transactions_user_created_idx on public.transactions(user_id, created_at desc);

-- --------------------------------------------------
-- WATCHLISTS + WATCHLIST_TICKERS (many-to-many)
-- --------------------------------------------------
create table public.watchlists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  position   integer default 0,
  created_at timestamptz default now()
);

alter table public.watchlists enable row level security;

create policy "Users manage own watchlists"
  on public.watchlists for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index watchlists_user_idx on public.watchlists(user_id, position);

create table public.watchlist_tickers (
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  ticker       text not null,
  added_at     timestamptz default now(),
  primary key (watchlist_id, ticker)
);

alter table public.watchlist_tickers enable row level security;

-- Delegate to parent watchlist ownership — user can manage tickers
-- only in watchlists they own.
create policy "Users manage tickers in own watchlists"
  on public.watchlist_tickers for all
  using (
    exists (
      select 1 from public.watchlists w
      where w.id = watchlist_id and w.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.watchlists w
      where w.id = watchlist_id and w.user_id = auth.uid()
    )
  );

-- --------------------------------------------------
-- PLANS — saved wizard plans (strategy, allocation, difficulty, rationale)
-- --------------------------------------------------
create table public.plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  payload    jsonb not null,                   -- full plan object from the wizard
  created_at timestamptz default now()
);

alter table public.plans enable row level security;

create policy "Users manage own plans"
  on public.plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index plans_user_created_idx on public.plans(user_id, created_at desc);

-- --------------------------------------------------
-- BROKER_LINKS — for future Cohen API integration
-- --------------------------------------------------
-- Stores OAuth tokens per user. Do NOT read/write this table from
-- the client — these tokens are sensitive. The RLS policy here
-- refuses all client access; only the server (Edge Function with
-- service_role key) can touch it.
create table public.broker_links (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  broker        text not null default 'cohen',
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  connected_at  timestamptz default now(),
  revoked_at    timestamptz
);

alter table public.broker_links enable row level security;

-- Deliberately NO policies: RLS on + zero policies = every row is
-- invisible to client queries. Only the service_role bypasses RLS.

-- --------------------------------------------------
-- Helpful view: portfolio summary (cash + holdings valued at avg_cost)
-- Optional — the app can compute this client-side too. Kept here as
-- an example of how to expose derived data with RLS respected.
-- --------------------------------------------------
create or replace view public.portfolio_summary
with (security_invoker = true)
as
select
  a.user_id,
  a.currency,
  a.balance as cash,
  coalesce(sum(h.qty * h.avg_cost), 0) as invested_at_cost
from public.accounts a
left join public.holdings h
  on h.user_id = a.user_id and h.currency = a.currency
group by a.user_id, a.currency, a.balance;

-- ============================================================
-- DONE
-- ============================================================
-- Next steps in the Supabase dashboard:
--   1. Authentication → Providers → Email: make sure "Enable email
--      confirmations" is ON.
--   2. Authentication → Providers → Phone: enable and paste Twilio
--      credentials (Account SID, Auth Token, Message Service SID or
--      From number).
--   3. Authentication → URL Configuration: add your dev URL
--      (http://localhost:5173) and future prod URL to the redirect
--      allow-list so email confirmation links work.
-- ============================================================
