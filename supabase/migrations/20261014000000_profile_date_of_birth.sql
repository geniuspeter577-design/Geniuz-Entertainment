alter table public.profiles
  add column if not exists date_of_birth date;

revoke update on table public.profiles from authenticated;
grant update (display_name, username, bio, avatar_url) on public.profiles to authenticated;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  raw_date_of_birth text;
  parsed_date_of_birth date;
begin
  perform public.create_profile_for_user(
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1)
    )
  );

  raw_date_of_birth := nullif(trim(new.raw_user_meta_data ->> 'date_of_birth'), '');
  if raw_date_of_birth is not null then
    begin
      parsed_date_of_birth := raw_date_of_birth::date;
    exception when others then
      raise exception 'Date of birth must be a valid YYYY-MM-DD date.';
    end;
    if parsed_date_of_birth > current_date or parsed_date_of_birth < date '1900-01-01' then
      raise exception 'Date of birth is outside the allowed range.';
    end if;
    update public.profiles
      set date_of_birth = parsed_date_of_birth
      where id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user_profile() from public, anon, authenticated;

drop function if exists public.complete_profile_date_of_birth(date);
create function public.complete_profile_date_of_birth(requested_date date)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;
  if requested_date is null or requested_date > current_date or requested_date < date '1900-01-01' then
    raise exception 'Date of birth is outside the allowed range.';
  end if;

  update public.profiles
    set date_of_birth = requested_date
    where id = auth.uid()
      and date_of_birth is null;

  if not found and not exists (
    select 1 from public.profiles
    where id = auth.uid() and date_of_birth = requested_date
  ) then
    raise exception 'Date of birth has already been set and cannot be changed.';
  end if;
end;
$$;

revoke all on function public.complete_profile_date_of_birth(date) from public, anon;
grant execute on function public.complete_profile_date_of_birth(date) to authenticated;
