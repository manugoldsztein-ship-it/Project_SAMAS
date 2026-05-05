-- ============================================================
-- SESSION MANAGEMENT — RPC helpers
-- ============================================================
-- Two helpers that let a logged-in user inspect and revoke their
-- own auth sessions across devices, without exposing the auth
-- schema directly through PostgREST.
--
-- list_my_sessions()       — returns all rows from auth.sessions
--                            for the current auth.uid()
-- revoke_my_session(id)    — deletes a specific session row
--                            (only if it belongs to the current user)
--
-- Both run as SECURITY DEFINER so they can read/write the auth
-- schema (which is owned by the supabase_auth_admin role and
-- otherwise inaccessible to authenticated users). The WHERE
-- user_id = auth.uid() clause inside the body is what keeps users
-- limited to their own sessions — they can't peek at other users.
-- ============================================================

create or replace function public.list_my_sessions()
returns table (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  user_agent text,
  ip inet,
  is_current boolean
)
language sql
security definer
set search_path = public, auth
as $$
  -- Pull every session for the current user. The 'is_current' flag
  -- compares each row's id to the session id baked into the caller's
  -- JWT (request.jwt.claims.session_id), so the UI can highlight the
  -- session the user is currently using and disable revoke for it.
  select
    s.id,
    s.created_at,
    s.updated_at,
    s.user_agent,
    s.ip,
    s.id::text = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'session_id', '') as is_current
  from auth.sessions s
  where s.user_id = auth.uid()
  order by s.updated_at desc;
$$;

revoke all on function public.list_my_sessions() from public, anon;
grant execute on function public.list_my_sessions() to authenticated;

create or replace function public.revoke_my_session(session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Refuse to revoke the session the user is calling FROM —
  -- otherwise they'd lock themselves out mid-request. UI also
  -- guards this but defense in depth.
  if session_id::text = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'session_id', '') then
    raise exception 'cannot revoke the current session';
  end if;
  delete from auth.sessions
   where id = session_id
     and user_id = auth.uid();
end;
$$;

revoke all on function public.revoke_my_session(uuid) from public, anon;
grant execute on function public.revoke_my_session(uuid) to authenticated;

comment on function public.list_my_sessions() is
  'Returns the current user''s active auth sessions (id, created/updated, UA, IP, is_current flag).';
comment on function public.revoke_my_session(uuid) is
  'Revoke a specific session for the current user. Refuses to revoke the calling session.';
