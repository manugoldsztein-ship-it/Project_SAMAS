-- ============================================================
-- SEEN TUTORIAL — track tutorial completion per user
-- ============================================================
-- Previously the "tutorial seen" flag lived in localStorage which
-- meant it was per-device — each new browser, each incognito
-- session, even a different login on the same device, would all
-- get the tutorial again. Moving to profiles makes it user-level.
-- ============================================================

alter table public.profiles
  add column if not exists seen_tutorial boolean not null default false;

comment on column public.profiles.seen_tutorial is
  'True once the user finished or skipped the onboarding tutorial. Read at login to decide whether to auto-show it.';
