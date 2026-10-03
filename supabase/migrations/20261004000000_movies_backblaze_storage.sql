alter table public.movies
  add column if not exists storage_provider text not null default 'supabase',
  add column if not exists storage_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'movies_storage_provider_check'
      and conrelid = 'public.movies'::regclass
  ) then
    alter table public.movies
      add constraint movies_storage_provider_check
      check (storage_provider in ('supabase', 'b2'));
  end if;
end
$$;

alter table public.movies
  drop constraint if exists published_movies_require_video;

alter table public.movies
  add constraint published_movies_require_video
  check (
    not published
    or (storage_provider = 'supabase' and video_path is not null)
    or (storage_provider = 'b2' and storage_key is not null)
  );

drop policy if exists "Published movies are visible to everyone" on public.movies;
create policy "Published movies are visible to everyone"
  on public.movies for select
  to anon, authenticated
  using (
    published
    and (
      (storage_provider = 'supabase' and video_path is not null)
      or (storage_provider = 'b2' and storage_key is not null)
    )
  );
