-- ============================================================
-- SOCIAL — university (claimed) + university_verified (auto)
-- ============================================================
-- Adds two columns to profiles_social so a user can claim they're
-- from an Argentine university and, if their signup email matches
-- one of that university's known domains, get an instant verified
-- badge. Pure-data feature: no edge function or external API call,
-- the email-domain check happens inside the handle_new_user trigger
-- the moment the auth row is inserted.
--
-- COLUMNS
--   university            text  — short key of the claimed uni
--                                 (e.g. 'uba', 'udesa', 'itba'). NULL
--                                 means the user didn't claim one.
--   university_verified   bool  — set to true only by the trigger
--                                 below when the email domain matches
--                                 the claimed uni's allowlist. The
--                                 RLS update policy further down
--                                 prevents the user from flipping
--                                 this themselves.
--
-- HOW VERIFICATION WORKS
--   At signup the client passes:
--     options: { data: { university: 'uba' } }
--   The trigger reads `auth.users.raw_user_meta_data->>'university'`,
--   looks up the AR_UNI_DOMAINS map below, and if the email domain
--   matches one of the allowed entries it sets university_verified
--   to true on the freshly-created profiles_social row (or upgrades
--   the existing one). If the user signed up with a personal email
--   (gmail.com) the badge stays unverified.
--
-- HOW TO APPLY
--   psql "$SUPABASE_DB_URL" -f supabase/social_university.sql
--   or paste the whole file into the Supabase SQL editor.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Columns ------------------------------------------------
alter table public.profiles_social
  add column if not exists university           text,
  add column if not exists university_verified  boolean not null default false;

-- 2. Tighten the existing update RLS policy so the user can claim a
--    different university but cannot flip university_verified on
--    their own. The verified flag is locked, just like `verified`
--    and `is_admin`. We drop+recreate to update the with-check.
drop policy if exists "profiles_social update own" on public.profiles_social;
create policy "profiles_social update own"
  on public.profiles_social for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and verified = (select verified from public.profiles_social where user_id = auth.uid())
    and is_admin = (select is_admin from public.profiles_social where user_id = auth.uid())
    and university_verified = (select university_verified from public.profiles_social where user_id = auth.uid())
  );

-- 3. AR university allowlist + lookup function -------------
-- Single function that maps a (university_key, email_domain) pair to
-- a boolean "verified?" decision. Centralizing it here means the
-- trigger and any future verification flow share one source of truth.
-- The list is intentionally short — adding a new uni is one ARRAY
-- entry, no schema change.
create or replace function public.is_university_email(
  p_uni text, p_email text
) returns boolean
language plpgsql
immutable
as $$
declare
  v_dom text;
begin
  if p_uni is null or p_email is null then return false; end if;
  -- Normalize the email's domain (case-insensitive, trimmed).
  v_dom := lower(split_part(trim(p_email), '@', 2));
  if v_dom = '' then return false; end if;

  -- The mapping. Add new universities here. Values are lowercase
  -- domains; subdomains count as a match (e.g. fcen.uba.ar matches
  -- the uba entry because of the suffix check below).
  return case lower(p_uni)
    when 'uba'      then v_dom in ('uba.ar') or v_dom like '%.uba.ar'
    when 'udesa'    then v_dom in ('udesa.edu.ar') or v_dom like '%.udesa.edu.ar'
    when 'itba'     then v_dom in ('itba.edu.ar') or v_dom like '%.itba.edu.ar'
    when 'utdt'     then v_dom in ('utdt.edu') or v_dom like '%.utdt.edu'
    when 'austral'  then v_dom in ('austral.edu.ar') or v_dom like '%.austral.edu.ar'
    when 'uca'      then v_dom in ('uca.edu.ar') or v_dom like '%.uca.edu.ar'
    when 'palermo'  then v_dom in ('palermo.edu') or v_dom like '%.palermo.edu'
    when 'ub'       then v_dom in ('ub.edu.ar') or v_dom like '%.ub.edu.ar'
    when 'utn'      then v_dom in ('utn.edu.ar') or v_dom like '%.utn.edu.ar'
    when 'unlp'     then v_dom in ('unlp.edu.ar') or v_dom like '%.unlp.edu.ar'
    when 'unc'      then v_dom in ('unc.edu.ar') or v_dom like '%.unc.edu.ar'
    when 'ucema'    then v_dom in ('ucema.edu.ar') or v_dom like '%.ucema.edu.ar'
    when 'siglo21'  then v_dom in ('ues21.edu.ar') or v_dom like '%.ues21.edu.ar'
    else false
  end;
end;
$$;

-- 4. Trigger that fires when profiles_social is auto-created --
-- profiles_social rows are created lazily from the client (see
-- ensureProfile / getMe in api/social.js). We can't piggyback on
-- handle_new_user because that one fires on auth.users insert and
-- profiles_social may not exist yet. Instead, BEFORE INSERT/UPDATE
-- on profiles_social itself: if the user is claiming a uni AND the
-- email matches, flip university_verified to true. Lookup goes via
-- auth.users since that's where the email lives.
create or replace function public.profiles_social_uni_check()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
begin
  -- Only run when a uni claim is present.
  if new.university is null or new.university = '' then
    new.university_verified := false;
    return new;
  end if;

  -- Pull the user's email from auth.users. If this lookup fails (e.g.
  -- service role context, deleted user) fall back to NOT verified.
  begin
    select email into v_email from auth.users where id = new.user_id;
  exception when others then
    v_email := null;
  end;

  new.university_verified := public.is_university_email(new.university, v_email);
  return new;
end;
$$;

drop trigger if exists profiles_social_uni_check_ins on public.profiles_social;
create trigger profiles_social_uni_check_ins
  before insert on public.profiles_social
  for each row execute function public.profiles_social_uni_check();

drop trigger if exists profiles_social_uni_check_upd on public.profiles_social;
create trigger profiles_social_uni_check_upd
  before update of university on public.profiles_social
  for each row execute function public.profiles_social_uni_check();

-- 5. Backfill — re-evaluate existing rows so anybody whose uni was
-- already set (or who's about to be set after this migration runs)
-- gets the correct verified flag without needing to update their
-- profile manually. Cheap: trigger sees one row at a time.
update public.profiles_social
   set university = university
 where university is not null;
