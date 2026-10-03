alter table public.movies
  add column if not exists cover_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'title-images',
  'title-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Title images are readable by everyone" on storage.objects;
create policy "Title images are readable by everyone"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'title-images');

drop policy if exists "Admins can manage title images" on storage.objects;
create policy "Admins can manage title images"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'title-images' and public.is_geniuz_admin())
  with check (bucket_id = 'title-images' and public.is_geniuz_admin());
