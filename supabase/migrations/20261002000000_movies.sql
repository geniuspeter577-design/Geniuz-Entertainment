create or replace function public.is_geniuz_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role' = 'admin', false);
$$;

grant execute on function public.is_geniuz_admin() to anon, authenticated;

create table if not exists public.movies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text,
  release_year integer check (release_year is null or release_year between 1888 and 2200),
  genres text[] not null default '{}',
  poster_url text,
  runtime_minutes integer check (runtime_minutes is null or runtime_minutes between 1 and 1000),
  content_rating text,
  video_path text unique,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  constraint published_movies_require_video check (not published or video_path is not null)
);

alter table public.movies enable row level security;

grant select on public.movies to anon, authenticated;
grant insert, update, delete on public.movies to authenticated;

drop policy if exists "Published movies are visible to everyone" on public.movies;
create policy "Published movies are visible to everyone"
  on public.movies for select
  to anon, authenticated
  using (published and video_path is not null);

drop policy if exists "Admins can manage movies" on public.movies;
create policy "Admins can manage movies"
  on public.movies for all
  to authenticated
  using (public.is_geniuz_admin())
  with check (public.is_geniuz_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('movie-assets', 'movie-assets', false, 5368709120, array['video/mp4'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Published movie files can be streamed" on storage.objects;
create policy "Published movie files can be streamed"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'movie-assets'
    and exists (
      select 1
      from public.movies
      where movies.video_path = storage.objects.name
        and movies.published
    )
  );

drop policy if exists "Admins can manage movie files" on storage.objects;
create policy "Admins can manage movie files"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'movie-assets' and public.is_geniuz_admin())
  with check (bucket_id = 'movie-assets' and public.is_geniuz_admin());
