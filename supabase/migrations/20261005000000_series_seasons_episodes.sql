alter table public.movies
  add column if not exists content_type text not null default 'movie';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'movies_content_type_check'
      and conrelid = 'public.movies'::regclass
  ) then
    alter table public.movies
      add constraint movies_content_type_check
      check (content_type in ('movie', 'series'));
  end if;
end
$$;

alter table public.movies
  drop constraint if exists published_movies_require_video;

alter table public.movies
  add constraint published_movies_require_video
  check (
    not published
    or content_type = 'series'
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
      content_type = 'series'
      or (storage_provider = 'supabase' and video_path is not null)
      or (storage_provider = 'b2' and storage_key is not null)
    )
  );

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.movies(id) on delete cascade,
  season_number integer not null check (season_number > 0),
  release_year integer check (release_year is null or release_year between 1888 and 2200),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (series_id, season_number)
);

create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  episode_number integer not null check (episode_number > 0),
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text,
  duration_seconds integer not null check (duration_seconds > 0),
  storage_provider text not null default 'supabase'
    check (storage_provider in ('supabase', 'b2')),
  storage_key text,
  file_extension text,
  mime_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes > 0),
  allow_download boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (season_id, episode_number),
  constraint published_episodes_require_storage
    check (not published or storage_key is not null)
);

alter table public.seasons enable row level security;
alter table public.episodes enable row level security;

grant select on public.seasons, public.episodes to anon, authenticated;
grant insert, update, delete on public.seasons, public.episodes to authenticated;

drop policy if exists "Published seasons are visible to everyone" on public.seasons;
create policy "Published seasons are visible to everyone"
  on public.seasons for select
  to anon, authenticated
  using (
    published
    and exists (
      select 1
      from public.movies series
      where series.id = seasons.series_id
        and series.content_type = 'series'
        and series.published
    )
  );

drop policy if exists "Admins can manage seasons" on public.seasons;
create policy "Admins can manage seasons"
  on public.seasons for all
  to authenticated
  using (public.is_geniuz_admin())
  with check (public.is_geniuz_admin());

drop policy if exists "Published episodes are visible to everyone" on public.episodes;
create policy "Published episodes are visible to everyone"
  on public.episodes for select
  to anon, authenticated
  using (
    published
    and exists (
      select 1
      from public.seasons season
      join public.movies series on series.id = season.series_id
      where season.id = episodes.season_id
        and season.published
        and series.content_type = 'series'
        and series.published
    )
  );

drop policy if exists "Admins can manage episodes" on public.episodes;
create policy "Admins can manage episodes"
  on public.episodes for all
  to authenticated
  using (public.is_geniuz_admin())
  with check (public.is_geniuz_admin());
