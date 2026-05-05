-- ============================================================
-- PROFILES — capture nombre + apellido from signup metadata
-- ============================================================
-- The original handle_new_user trigger (in schema.sql) only copied
-- id and phone from auth.users into public.profiles. With the
-- updated SupabaseAuth signup form (samas-0.0.22) we pass nombre
-- and apellido via supabase.auth.signUp({ options: { data: ... } }),
-- which lands in auth.users.raw_user_meta_data as a JSONB blob.
-- This migration replaces handle_new_user so it reads those fields
-- and stores them on the profiles row, keeping the 1:1 invariant
-- without needing the client to do a follow-up UPDATE.
--
-- HOW TO APPLY
--   psql "$SUPABASE_DB_URL" -f supabase/profile_meta_signup.sql
--   or paste this whole file into the Supabase SQL editor.
--
-- Idempotent — re-running is safe.
-- ============================================================

-- Replace the function. We use create or replace so the trigger
-- (on_auth_user_created) keeps pointing at the new body without
-- needing to drop and recreate the trigger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre   text;
  v_apellido text;
begin
  -- raw_user_meta_data is jsonb. The signup form passes a flat object:
  --   { nombre: "Manuel", apellido: "Goldsztein" }
  -- Empty strings get coalesced to NULL so we never write whitespace.
  v_nombre   := nullif(trim(coalesce(new.raw_user_meta_data->>'nombre',   '')), '');
  v_apellido := nullif(trim(coalesce(new.raw_user_meta_data->>'apellido', '')), '');

  insert into public.profiles (id, phone, nombre, apellido)
  values (new.id, new.phone, v_nombre, v_apellido)
  on conflict (id) do update
    set nombre   = coalesce(public.profiles.nombre,   excluded.nombre),
        apellido = coalesce(public.profiles.apellido, excluded.apellido);
  return new;
end;
$$;

-- The trigger itself doesn't change (still on insert on auth.users).
-- We keep this stub here so this migration is self-contained — if
-- somebody applies it on a fresh project that doesn't have the
-- original schema.sql trigger yet, it still works.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
