alter table public.movies
  add column conversion_status text not null default 'ready'
  constraint movies_conversion_status_check
  check (conversion_status in ('uploaded', 'converting', 'ready', 'failed'));