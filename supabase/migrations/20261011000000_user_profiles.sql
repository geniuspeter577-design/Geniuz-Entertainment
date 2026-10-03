create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Geniuz+ user' check (char_length(trim(display_name)) between 1 and 80),
  avatar_color text not null default '#72F06A' check (avatar_color ~ '^#[0-9A-Fa-f]{6}$'),
  public_id text not null unique check (public_id ~ '^[0-9]{8}$'),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select, update on public.profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

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
    insert into public.profiles (id, display_name, avatar_color, public_id)
    values (p_user_id, normalized_name, '#72F06A', candidate_id)
    on conflict do nothing;
    if found or exists (select 1 from public.profiles where id = p_user_id) then
      return;
    end if;
  end loop;
end;
$$;

revoke all on function public.create_profile_for_user(uuid, text) from public, anon, authenticated;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.create_profile_for_user(
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.handle_new_user_profile();

do $$
declare
  existing_user record;
begin
  for existing_user in select id, raw_user_meta_data, email from auth.users loop
    perform public.create_profile_for_user(
      existing_user.id,
      coalesce(existing_user.raw_user_meta_data ->> 'display_name', split_part(existing_user.email, '@', 1))
    );
  end loop;
end;
$$;
