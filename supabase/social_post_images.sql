-- ============================================================
-- SOCIAL — image attachments on posts
-- ============================================================
-- Adds posts.image_url + a public Storage bucket post-images +
-- the RLS policies that let an authenticated user upload to a
-- folder named after their own user_id (so one user can't
-- overwrite another user's images) and let everybody read.
--
-- WHY public-read?
--   Social posts are public by design (RLS on `posts` is anon
--   readable when authenticated). Mirroring that posture for the
--   image bucket means we don't need to pre-sign URLs on every
--   feed render — a URL that lasts as long as the post is what
--   we want. If we ever need to take an image down, the api
--   deletes the storage object alongside the soft-deleted post.
--
-- HOW TO APPLY
--   psql "$SUPABASE_DB_URL" -f supabase/social_post_images.sql
--   or paste the whole file into the Supabase SQL editor.
--
--   Storage policies on `storage.objects` need to be created via
--   SQL because the Supabase Dashboard policy editor can't
--   express the foldername-based check below.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. Posts column ----------------------------------------------
alter table public.posts
  add column if not exists image_url text;

-- 2. Bucket ----------------------------------------------------
-- storage.buckets is the system-managed table where the Supabase
-- Storage service-side machinery looks up bucket configuration.
-- Setting public=true means objects served via the public URL
-- (https://<project>.supabase.co/storage/v1/object/public/...) are
-- accessible without auth, which is what we want for feed images.
insert into storage.buckets (id, name, public)
  values ('post-images', 'post-images', true)
  on conflict (id) do update set public = excluded.public;

-- 3. RLS on storage.objects -----------------------------------
-- Drop+recreate so re-running this file lands clean. The bucket
-- itself uses RLS too, but since we set public=true above, the
-- read policy below is somewhat redundant — kept explicit so the
-- bucket's surface is fully visible from this one file.

drop policy if exists "post-images public read" on storage.objects;
create policy "post-images public read"
  on storage.objects for select
  to public
  using (bucket_id = 'post-images');

-- Inserts must be authenticated AND go into a folder whose name
-- is the user's auth.uid(). storage.foldername() returns the path
-- as a text array — we check the first segment matches the user.
-- Filename convention used by the client:
--   post-images/<user_id>/<uuid>.<ext>
drop policy if exists "post-images authenticated insert" on storage.objects;
create policy "post-images authenticated insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Update is rare for image objects (no in-place edits in the v2
-- UI) but allow it for the same owner so future "rename" flows
-- don't break.
drop policy if exists "post-images authenticated update" on storage.objects;
create policy "post-images authenticated update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner can delete their own image. We also delete from the
-- client when the user deletes their post (best-effort), but
-- this lets a future cleanup script reach into the bucket.
drop policy if exists "post-images authenticated delete" on storage.objects;
create policy "post-images authenticated delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
