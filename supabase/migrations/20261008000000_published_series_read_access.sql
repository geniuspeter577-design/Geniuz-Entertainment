drop policy if exists "Published movies are visible to everyone" on public.movies;
create policy "Published movies are visible to everyone"
  on public.movies for select
  to anon, authenticated
  using (
    published
    and (
      content_type = 'series'
      or (storage_provider = 'supabase' and video_path is not null)
      or (storage_provider = 'b2' and storage_key is not null)
    )
  );
