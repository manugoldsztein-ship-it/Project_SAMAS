-- ============================================================
-- USER PREFERENCES + EXTRAS — move remaining localStorage state to SQL
-- ============================================================
-- After holdings/orders/balance/watchlists/plans/risk-rules/PIN/2FA
-- already moved to Supabase, the following user-specific bits were
-- still device-local in localStorage. We move them here so the user
-- gets the same experience across devices, browsers, and incognito
-- sessions.
--
--   recurring_aporte  — programmed monthly contribution
--                       Shape: { "amount": <number>, "lastApplied": "<ISO date>" }
--                       NULL  = not configured.
--
--   portfolio_history — synthetic daily portfolio-value snapshots
--                       used to render the hero sparkline. Array of
--                       { "date": "YYYY-MM-DD", "value": <number> }.
--                       NULL  = not seeded yet (App.jsx seeds on first load).
--
--   lang              — UI language ('es', 'en', etc.). Defaults 'es'.
--   show_usd          — toggle to show USD-equivalent values. Defaults false.
--   ui_dark           — dark vs light mode. Defaults true.
--   view_mode         — 'mobile' or 'desktop' layout. Defaults 'mobile'.
--
-- All preferences live as columns on profiles. JSONB only for the two
-- structured fields (recurring_aporte, portfolio_history) that are
-- always read/written whole. Scalars are typed columns.
--
-- RLS on profiles already gates read/write to the owner so no extra
-- policies are needed.
-- ============================================================

alter table public.profiles
  add column if not exists recurring_aporte  jsonb;

alter table public.profiles
  add column if not exists portfolio_history jsonb;

alter table public.profiles
  add column if not exists lang              text    not null default 'es';

alter table public.profiles
  add column if not exists show_usd          boolean not null default false;

alter table public.profiles
  add column if not exists ui_dark           boolean not null default true;

alter table public.profiles
  add column if not exists view_mode         text    not null default 'mobile';

comment on column public.profiles.recurring_aporte is
  'Programmed monthly auto-contribution. { amount: number, lastApplied: ISO date } or NULL.';
comment on column public.profiles.portfolio_history is
  'Daily portfolio-value snapshots for the hero sparkline. Array of { date, value }. NULL = not seeded.';
comment on column public.profiles.lang is
  'UI language code (es, en, pt, ...). Default ''es''.';
comment on column public.profiles.show_usd is
  'Whether the UI shows USD-equivalent values. Default false.';
comment on column public.profiles.ui_dark is
  'Dark theme toggle. Default true.';
comment on column public.profiles.view_mode is
  'Layout view mode: ''mobile'' or ''desktop''. Default ''mobile''.';
