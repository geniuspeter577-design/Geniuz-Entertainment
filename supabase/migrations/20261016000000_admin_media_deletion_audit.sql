create table if not exists public.admin_media_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  title_id uuid not null,
  title_name text,
  files_removed text[] not null default '{}',
  files_failed text[] not null default '{}',
  result text not null check (result in (
    'started',
    'title_lookup_failed',
    'asset_lookup_failed',
    'files_failed',
    'record_delete_failed',
    'success'
  )),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists admin_media_deletion_audit_created_at_idx
  on public.admin_media_deletion_audit (created_at desc);

alter table public.admin_media_deletion_audit enable row level security;
revoke all on public.admin_media_deletion_audit from anon, authenticated;
grant select, insert, update on public.admin_media_deletion_audit to authenticated;

drop policy if exists "Admins can read media deletion audit" on public.admin_media_deletion_audit;
create policy "Admins can read media deletion audit"
  on public.admin_media_deletion_audit for select
  to authenticated
  using (public.is_geniuz_admin());

drop policy if exists "Admins can insert media deletion audit" on public.admin_media_deletion_audit;
create policy "Admins can insert media deletion audit"
  on public.admin_media_deletion_audit for insert
  to authenticated
  with check (public.is_geniuz_admin() and actor_user_id = auth.uid());

drop policy if exists "Admins can update media deletion audit" on public.admin_media_deletion_audit;
create policy "Admins can update media deletion audit"
  on public.admin_media_deletion_audit for update
  to authenticated
  using (public.is_geniuz_admin())
  with check (public.is_geniuz_admin());