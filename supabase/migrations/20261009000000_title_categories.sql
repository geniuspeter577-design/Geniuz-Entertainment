alter table public.movies
  add column if not exists categories text[] not null default '{}'::text[];

create index if not exists movies_categories_gin_idx
  on public.movies using gin (categories);
