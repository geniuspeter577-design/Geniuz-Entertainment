create or replace function public.require_active_transfer_membership()
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if not public.has_active_membership(auth.uid()) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  return true;
end;
$$;

comment on function public.require_active_transfer_membership() is
  'TODO(plans): has_active_membership() must read the real paid membership data when the plans task is built.';

revoke all on function public.require_active_transfer_membership() from public, anon, authenticated;
grant execute on function public.require_active_transfer_membership() to authenticated;

drop policy if exists "Users can view their transfer sessions" on public.transfer_sessions;
create policy "Members can view their transfer sessions"
  on public.transfer_sessions for select
  to authenticated
  using (
    (receiver_user_id = (select auth.uid()) or sender_user_id = (select auth.uid()))
    and public.require_active_transfer_membership()
  );

drop policy if exists "Users can create their own receive sessions" on public.transfer_sessions;
create policy "Members can create their own receive sessions"
  on public.transfer_sessions for insert
  to authenticated
  with check (
    receiver_user_id = (select auth.uid())
    and sender_user_id is null
    and status = 'waiting'
    and file_size_bytes is null
    and sender_permit_hash is null
    and public.require_active_transfer_membership()
  );
