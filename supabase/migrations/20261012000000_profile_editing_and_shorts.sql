alter table public.profiles
  add column if not exists username text,
  add column if not exists bio text not null default '',
  add column if not exists avatar_url text,
  add constraint profiles_username_format_check
    check (username is null or username ~ '^[a-z][a-z0-9_]{2,23}$'),
  add constraint profiles_bio_length_check
    check (char_length(bio) <= 160);

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;

create or replace function public.is_username_available(requested_username text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and requested_username ~ '^[a-z][a-z0-9_]{2,23}$'
    and not exists (
      select 1
      from public.profiles
      where lower(username) = lower(requested_username)
        and id <> auth.uid()
    );
$$;

revoke all on function public.is_username_available(text) from public, anon;
grant execute on function public.is_username_available(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatars are publicly readable" on storage.objects;
create policy "Avatars are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and name = auth.uid()::text || '/avatar.jpg'
  );

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and name = auth.uid()::text || '/avatar.jpg'
  )
  with check (
    bucket_id = 'avatars'
    and name = auth.uid()::text || '/avatar.jpg'
  );

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and name = auth.uid()::text || '/avatar.jpg'
  );

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'completed', 'rejected'))
);

alter table public.account_deletion_requests enable row level security;
revoke all on table public.account_deletion_requests from anon, authenticated;
grant insert, select on table public.account_deletion_requests to authenticated;

drop policy if exists "Users can request deletion of their own account" on public.account_deletion_requests;
create policy "Users can request deletion of their own account"
  on public.account_deletion_requests for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can read their own deletion request" on public.account_deletion_requests;
create policy "Users can read their own deletion request"
  on public.account_deletion_requests for select
  to authenticated
  using (user_id = auth.uid());

alter table public.movies
  drop constraint if exists movies_content_type_check;

alter table public.movies
  add constraint movies_content_type_check
  check (content_type in ('movie', 'series', 'short'));

create index if not exists movies_content_type_created_at_idx
  on public.movies (content_type, created_at desc)
  where published;

create table if not exists public.content_categories (
  name text primary key check (char_length(trim(name)) between 1 and 40)
);

alter table public.content_categories enable row level security;
revoke all on table public.content_categories from anon, authenticated;
grant select on table public.content_categories to anon, authenticated;

drop policy if exists "Content categories are readable by everyone" on public.content_categories;
create policy "Content categories are readable by everyone"
  on public.content_categories for select
  to anon, authenticated
  using (true);

insert into public.content_categories (name)
values ('Anime'), ('Kids'), ('Shorts'), ('TV'), ('Nollywood'), ('Football')
on conflict (name) do nothing;
