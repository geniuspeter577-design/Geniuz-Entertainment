create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete cascade,
  type text not null check (type in ('broadcast', 'personal', 'system')),
  title text not null,
  body text not null,
  content_id text null,
  created_at timestamptz not null default now(),
  read_at timestamptz null
);

alter table public.notifications enable row level security;

create policy "anonymous users can read broadcast notifications"
  on public.notifications
  for select
  using (user_id is null);

create policy "signed in users can read their own or broadcast notifications"
  on public.notifications
  for select
  using (
    user_id is null
    or user_id = auth.uid()
  );

create policy "admins can insert broadcast notifications"
  on public.notifications
  for insert
  with check (
    user_id is null
    and type = 'broadcast'
    and exists (
      select 1
      from auth.users
      where auth.users.id = auth.uid()
        and jsonb_extract_path_text(auth.users.raw_user_meta_data, 'role') = 'admin'
    )
  );

create policy "users can update only their own read state"
  on public.notifications
  for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and read_at is not null
  );
