-- ============================================================
-- UI MODE — beginner vs pro interface
-- ============================================================
-- Each user picks one of two UI modes:
--   - "principiante": more guided, simpler vocabulary, educational
--     tooltips always visible, advanced surfaces hidden (shock test,
--     rebalanceo, what-if) and simplified order tickets.
--   - "profesional": full feature set, dense data, technical labels,
--     keyboard shortcuts, monospace numbers.
--
-- null means "not chosen yet" → the app shows the welcome picker
-- on the next entry. Once picked, stored in profile. Changeable
-- later from Settings.
-- ============================================================

alter table public.profiles
  add column if not exists ui_mode text
    check (ui_mode in ('principiante','profesional'));

-- Optional: comment so future-you remembers what this column is for.
comment on column public.profiles.ui_mode is
  'User-selected UI complexity: principiante (guided, educational) or profesional (dense, technical). null = not yet chosen.';
