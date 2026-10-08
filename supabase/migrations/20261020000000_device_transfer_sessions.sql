create table if not exists public.transfer_sessions (
  id uuid primary key default gen_random_uuid(),
  receiver_user_id uuid not null references auth.users(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  session_token_hash text not null check (session_token_hash ~ '^[a-f0-9]{64}$'),
  sender_permit_hash text check (
    sender_permit_hash is null or sender_permit_hash ~ '^[a-f0-9]{64}$'
  ),
  status text not null default 'waiting'
    check (status in ('waiting', 'transferring', 'completed', 'expired', 'canceled')),
  content_id uuid,
  item_type text check (item_type is null or item_type in ('movie', 'series')),
  parent_series_id uuid,
  file_name text,
  title text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes between 1 and 1073741824),
  file_sha256 text check (file_sha256 is null or file_sha256 ~ '^[a-f0-9]{64}$'),
  next_chunk integer not null default 0 check (next_chunk >= 0),
  received_bytes bigint not null default 0 check (received_bytes >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  completed_at timestamptz,
  constraint transfer_sessions_manifest_complete check (
    (
      sender_user_id is null
      and sender_permit_hash is null
      and content_id is null
      and item_type is null
      and parent_series_id is null
      and file_name is null
      and title is null
      and file_size_bytes is null
      and file_sha256 is null
    )
    or (
      sender_user_id is not null
      and sender_permit_hash is not null
      and content_id is not null
      and item_type is not null
      and file_name is not null
      and title is not null
      and file_size_bytes is not null
      and file_sha256 is not null
    )
  )
);

create index if not exists transfer_sessions_receiver_status_idx
  on public.transfer_sessions(receiver_user_id, status, expires_at);

alter table public.transfer_sessions enable row level security;

grant select, insert on public.transfer_sessions to authenticated;

drop policy if exists "Users can view their transfer sessions" on public.transfer_sessions;
create policy "Users can view their transfer sessions"
  on public.transfer_sessions for select
  to authenticated
  using (receiver_user_id = (select auth.uid()) or sender_user_id = (select auth.uid()));

drop policy if exists "Users can create their own receive sessions" on public.transfer_sessions;
create policy "Users can create their own receive sessions"
  on public.transfer_sessions for insert
  to authenticated
  with check (
    receiver_user_id = (select auth.uid())
    and sender_user_id is null
    and status = 'waiting'
    and file_size_bytes is null
    and sender_permit_hash is null
  );

create or replace function public.has_active_membership(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select false;
$$;

comment on function public.has_active_membership(uuid) is
  'Fail-closed transfer entitlement gate; replace with the real membership lookup in the membership task.';

revoke all on function public.has_active_membership(uuid) from public, anon, authenticated;

create or replace function public.authorize_device_transfer(
  p_session_id uuid,
  p_session_token_hash text,
  p_sender_permit_hash text,
  p_content_id uuid,
  p_item_type text,
  p_parent_series_id uuid,
  p_file_name text,
  p_title text,
  p_file_size_bytes bigint,
  p_file_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  transfer public.transfer_sessions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if not public.has_active_membership(auth.uid()) then
    raise exception 'MEMBERSHIP_REQUIRED';
  end if;
  if p_session_token_hash !~ '^[a-f0-9]{64}$'
    or p_sender_permit_hash !~ '^[a-f0-9]{64}$'
    or p_file_sha256 !~ '^[a-f0-9]{64}$'
    or p_item_type not in ('movie', 'series')
    or p_file_size_bytes not between 1 and 1073741824
    or p_file_name !~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$'
    or char_length(trim(p_title)) not between 1 and 200 then
    raise exception 'INVALID_TRANSFER_MANIFEST';
  end if;

  select *
    into transfer
    from public.transfer_sessions
    where id = p_session_id
    for update;

  if not found
    or transfer.session_token_hash <> p_session_token_hash
    or transfer.expires_at <= now()
    or transfer.receiver_user_id = auth.uid()
    or transfer.status not in ('waiting', 'transferring')
    or (transfer.sender_user_id is not null and transfer.sender_user_id <> auth.uid())
    or (
      transfer.status = 'transferring'
      and (
        transfer.content_id <> p_content_id
        or transfer.item_type <> p_item_type
        or transfer.parent_series_id is distinct from p_parent_series_id
        or transfer.file_name <> p_file_name
        or transfer.file_size_bytes <> p_file_size_bytes
        or transfer.file_sha256 <> p_file_sha256
      )
    ) then
    raise exception 'TRANSFER_SESSION_UNAVAILABLE';
  end if;

  update public.transfer_sessions
    set sender_user_id = auth.uid(),
        sender_permit_hash = p_sender_permit_hash,
        status = 'transferring',
        content_id = p_content_id,
        item_type = p_item_type,
        parent_series_id = p_parent_series_id,
        file_name = p_file_name,
        title = trim(p_title),
        file_size_bytes = p_file_size_bytes,
        file_sha256 = p_file_sha256
    where id = p_session_id;

  return jsonb_build_object(
    'sessionId', p_session_id,
    'receivedBytes', transfer.received_bytes,
    'fileSizeBytes', p_file_size_bytes,
    'fileSha256', p_file_sha256
  );
end;
$$;

create or replace function public.verify_device_transfer(
  p_session_id uuid,
  p_sender_permit_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  transfer public.transfer_sessions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select *
    into transfer
    from public.transfer_sessions
    where id = p_session_id
      and receiver_user_id = auth.uid()
      and sender_permit_hash = p_sender_permit_hash
      and status = 'transferring'
      and expires_at > now();

  if not found then
    raise exception 'TRANSFER_PERMIT_INVALID';
  end if;

  return jsonb_build_object(
    'sessionId', transfer.id,
    'contentId', transfer.content_id,
    'itemType', transfer.item_type,
    'parentSeriesId', transfer.parent_series_id,
    'fileName', transfer.file_name,
    'title', transfer.title,
    'fileSizeBytes', transfer.file_size_bytes,
    'fileSha256', transfer.file_sha256,
    'nextChunk', transfer.next_chunk,
    'receivedBytes', transfer.received_bytes
  );
end;
$$;

create or replace function public.update_device_transfer_progress(
  p_session_id uuid,
  p_next_chunk integer,
  p_received_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  transfer public.transfer_sessions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select *
    into transfer
    from public.transfer_sessions
    where id = p_session_id
      and receiver_user_id = auth.uid()
      and status = 'transferring'
      and expires_at > now()
    for update;

  if not found
    or p_next_chunk < transfer.next_chunk
    or p_received_bytes < transfer.received_bytes
    or p_received_bytes > transfer.file_size_bytes then
    raise exception 'TRANSFER_PROGRESS_INVALID';
  end if;

  update public.transfer_sessions
    set next_chunk = p_next_chunk,
        received_bytes = p_received_bytes
    where id = p_session_id;
end;
$$;

create or replace function public.complete_device_transfer(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  update public.transfer_sessions
    set status = 'completed',
        completed_at = now()
    where id = p_session_id
      and receiver_user_id = auth.uid()
      and status = 'transferring'
      and received_bytes = file_size_bytes;
  if not found then
    raise exception 'TRANSFER_INCOMPLETE';
  end if;
end;
$$;

revoke all on function public.authorize_device_transfer(uuid, text, text, uuid, text, uuid, text, text, bigint, text)
  from public, anon;
revoke all on function public.verify_device_transfer(uuid, text) from public, anon;
revoke all on function public.update_device_transfer_progress(uuid, integer, bigint) from public, anon;
revoke all on function public.complete_device_transfer(uuid) from public, anon;

grant execute on function public.authorize_device_transfer(uuid, text, text, uuid, text, uuid, text, text, bigint, text)
  to authenticated;
grant execute on function public.verify_device_transfer(uuid, text) to authenticated;
grant execute on function public.update_device_transfer_progress(uuid, integer, bigint) to authenticated;
grant execute on function public.complete_device_transfer(uuid) to authenticated;
