alter table public.movies
  add column if not exists file_extension text,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint,
  add column if not exists allow_download boolean not null default false;

update storage.buckets
set public = false,
    file_size_limit = 1073741824,
    allowed_mime_types = array[
      'video/mp4',
      'video/quicktime',
      'video/x-matroska',
      'video/webm',
      'video/x-msvideo',
      'video/x-m4v',
      'video/3gpp',
      'video/mp2t',
      'video/x-flv',
      'video/x-ms-wmv',
      'application/octet-stream'
    ]
where id = 'movie-assets';
