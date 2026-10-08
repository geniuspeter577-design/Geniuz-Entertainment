create table if not exists public.subtitle_tracks (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid references public.movies(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete cascade,
  language_label text not null check (char_length(trim(language_label)) between 1 and 64),
  format text not null check (format in ('srt', 'vtt')),
  storage_path text not null unique
    check (storage_path !~ '(^/|(^|/)\.\.?(/|$))' and position('..' in storage_path) = 0),
  created_at timestamptz not null default now(),
  constraint subtitle_tracks_one_content_target
    check ((movie_id is not null) <> (episode_id is not null))
);

create index if not exists subtitle_tracks_movie_id_idx
  on public.subtitle_tracks(movie_id)
  where movie_id is not null;

create index if not exists subtitle_tracks_episode_id_idx
  on public.subtitle_tracks(episode_id)
  where episode_id is not null;

alter table public.subtitle_tracks enable row level security;

grant select on public.subtitle_tracks to anon, authenticated;
grant insert, update, delete on public.subtitle_tracks to authenticated;

drop policy if exists "Published subtitles are visible to everyone" on public.subtitle_tracks;
create policy "Published subtitles are visible to everyone"
  on public.subtitle_tracks for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.movies movie
      where movie.id = subtitle_tracks.movie_id
        and movie.published
        and movie.content_type in ('movie', 'short')
    )
    or exists (
      select 1
      from public.episodes episode
      join public.seasons season on season.id = episode.season_id
      join public.movies series on series.id = season.series_id
      where episode.id = subtitle_tracks.episode_id
        and episode.published
        and season.published
        and series.content_type = 'series'
        and series.published
    )
  );

drop policy if exists "Admins can manage subtitle tracks" on public.subtitle_tracks;
create policy "Admins can manage subtitle tracks"
  on public.subtitle_tracks for all
  to authenticated
  using (public.is_geniuz_admin())
  with check (public.is_geniuz_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'subtitle-files',
  'subtitle-files',
  false,
  2097152,
  array['text/vtt', 'application/x-subrip', 'text/plain']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Published subtitle files can be signed" on storage.objects;
create policy "Published subtitle files can be signed"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'subtitle-files'
    and exists (
      select 1
      from public.subtitle_tracks track
      where track.storage_path = storage.objects.name
        and (
          exists (
            select 1
            from public.movies movie
            where movie.id = track.movie_id
              and movie.published
              and movie.content_type in ('movie', 'short')
          )
          or exists (
            select 1
            from public.episodes episode
            join public.seasons season on season.id = episode.season_id
            join public.movies series on series.id = season.series_id
            where episode.id = track.episode_id
              and episode.published
              and season.published
              and series.content_type = 'series'
              and series.published
          )
        )
    )
  );

drop policy if exists "Admins can manage subtitle files" on storage.objects;
create policy "Admins can manage subtitle files"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'subtitle-files' and public.is_geniuz_admin())
  with check (bucket_id = 'subtitle-files' and public.is_geniuz_admin());
