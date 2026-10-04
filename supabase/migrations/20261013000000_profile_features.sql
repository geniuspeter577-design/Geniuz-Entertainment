alter table public.profiles
  add column if not exists username text,
  add column if not exists bio text not null default '',
  add column if not exists avatar_url text;

update public.profiles
set username = 'user_' || public_id
where username is null;

alter table public.profiles
  alter column username set default ('user_' || substr(gen_random_uuid()::text, 1, 8)),
  alter column username set not null;

alter table public.profiles
  drop constraint if exists profiles_username_check;

alter table public.profiles
  add constraint profiles_username_check
  check (username = lower(username) and username ~ '^[a-z][a-z0-9_]{2,23}$');

alter table public.profiles
  drop constraint if exists profiles_bio_length_check;

alter table public.profiles
  add constraint profiles_bio_length_check
  check (char_length(bio) <= 160);

create or replace function public.create_profile_for_user(p_user_id uuid, p_display_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate_id text;
  normalized_name text;
begin
  if exists (select 1 from public.profiles where id = p_user_id) then
    return;
  end if;

  normalized_name := left(coalesce(nullif(trim(p_display_name), ''), 'Geniuz+ user'), 80);
  loop
    candidate_id := lpad(floor(random() * 100000000)::bigint::text, 8, '0');
    insert into public.profiles (id, display_name, avatar_color, public_id, username)
    values (p_user_id, normalized_name, '#72F06A', candidate_id, 'user_' || candidate_id)
    on conflict do nothing;
    if found or exists (select 1 from public.profiles where id = p_user_id) then
      return;
    end if;
  end loop;
end;
$$;

revoke all on function public.create_profile_for_user(uuid, text) from public, anon, authenticated;

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
    where lower(username) = lower(trim(requested_username))
      and id <> auth.uid()
  );
$$;

revoke all on function public.is_username_available(text) from public, anon;
grant execute on function public.is_username_available(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg'])
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatar images are public" on storage.objects;
create policy "Avatar images are public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "Users manage their own avatar images" on storage.objects;
create policy "Users manage their own avatar images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users update their own avatar images" on storage.objects;
create policy "Users update their own avatar images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete their own avatar images" on storage.objects;
create policy "Users delete their own avatar images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'completed', 'canceled'))
);

create unique index if not exists account_deletion_requests_pending_user_idx
  on public.account_deletion_requests (user_id)
  where status = 'pending';

alter table public.account_deletion_requests enable row level security;
revoke all on table public.account_deletion_requests from anon, authenticated;
grant select, insert on public.account_deletion_requests to authenticated;

drop policy if exists "Users create their own account deletion requests" on public.account_deletion_requests;
create policy "Users create their own account deletion requests"
  on public.account_deletion_requests for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users read their own account deletion requests" on public.account_deletion_requests;
create policy "Users read their own account deletion requests"
  on public.account_deletion_requests for select
  to authenticated
  using (user_id = auth.uid());
