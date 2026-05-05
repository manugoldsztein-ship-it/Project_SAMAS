-- ============================================================
-- SOCIAL — CNV idóneo verification flag
-- ============================================================
-- Adds a single boolean column to profiles_social so a user who
-- is registered as an "idóneo en mercado de capitales" with the
-- CNV (Comisión Nacional de Valores, Argentina) can carry a
-- distinct verified badge in their profile. The check is
-- different from the university check — both can coexist on the
-- same user, both render their own chip, and the visuals in the
-- frontend are styled differently so a viewer can tell at a
-- glance whether someone is uni-verified, CNV-verified, or both.
--
-- HOW VERIFICATION WORKS
--   No automated check (the CNV publishes a registry but doesn't
--   expose an API). The flag is service-role-write only — flipped
--   by an admin via the Supabase SQL editor after manually
--   matching a user against the public CNV registry. RLS prevents
--   the user from setting it themselves, even on their own row.
--
-- HOW TO FLIP IT (one-off, admin-only)
--   update public.profiles_social
--      set cnv_idoneo = true
--    where handle = '@manugold';
--
-- HOW TO APPLY
--   psql "$SUPABASE_DB_URL" -f supabase/social_cnv_idoneo.sql
--   or paste the whole file into the Supabase SQL editor.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Column. -------------------------------------------------
alter table public.profiles_social
  add column if not exists cnv_idoneo boolean not null default false;

-- 2. Re-apply the update RLS policy so the user cannot flip
--    cnv_idoneo themselves (same shape as the locked verified /
--    is_admin / university_verified fields). Drop+recreate is the
--    only path since with-check expressions can't be ALTER'd.
drop policy if exists "profiles_social update own" on public.profiles_social;
create policy "profiles_social update own"
  on public.profiles_social for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and verified = (select verified from public.profiles_social where user_id = auth.uid())
    and is_admin = (select is_admin from public.profiles_social where user_id = auth.uid())
    and university_verified = (select university_verified from public.profiles_social where user_id = auth.uid())
    and cnv_idoneo = (select cnv_idoneo from public.profiles_social where user_id = auth.uid())
  );
