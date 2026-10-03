alter table public.movies
  add column if not exists trailer_storage_key text,
  add column if not exists trailer_size_bytes bigint
    check (trailer_size_bytes is null or trailer_size_bytes between 1 and 314572800),
  add column if not exists trailer_duration_seconds integer
    check (trailer_duration_seconds is null or trailer_duration_seconds > 0),
  add column if not exists trailer_content_type text;
