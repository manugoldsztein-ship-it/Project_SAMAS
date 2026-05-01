-- ============================================================
-- SAMAS Plus — cancel RPC (0.2.9)
-- ============================================================
-- Companion to activate_plus(). Flips is_plus = false and clears
-- plus_activated_at. Today: prototype tap-to-cancel. Production:
-- replaced with Apple StoreKit cancellation handling (cancel
-- happens in Settings → Subscriptions on iOS, app gets a
-- DID-CHANGE-RENEWAL-STATUS notification via App Store Server API
-- and we update the flag).
--
-- HOW TO RUN
--   Supabase SQL editor → New query → paste → Run.
-- ============================================================

create or replace function public.cancel_plus()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;
  update public.profiles_social
     set is_plus = false, plus_activated_at = null
   where id = v_user_id;
  return json_build_object('is_plus', false);
end;
$$;

grant execute on function public.cancel_plus() to authenticated;

comment on function public.cancel_plus() is
  'Flips is_plus = false. Prototype — production handles via Apple StoreKit cancellation webhook.';
