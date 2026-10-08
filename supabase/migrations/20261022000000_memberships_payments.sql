create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_kobo integer not null check (amount_kobo > 0),
  received_amount_kobo integer check (received_amount_kobo is null or received_amount_kobo >= 0),
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'refunded')),
  channel text,
  raw_event_id text unique,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_user_created_idx on public.payments(user_id, created_at desc);
create index if not exists payments_pending_created_idx on public.payments(created_at) where status = 'pending';

create table if not exists public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('active', 'grace', 'expired', 'refunded')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  grace_until timestamptz not null,
  source text not null check (source = 'paystack'),
  updated_at timestamptz not null default now()
);

create table if not exists public.revenue_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_id uuid not null references public.payments(id),
  entry_key text not null unique,
  entry_type text not null check (entry_type in ('membership_payment', 'refund')),
  amount_kobo bigint not null check (amount_kobo <> 0),
  created_at timestamptz not null default now()
);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments(id),
  reference text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id),
  amount_kobo integer not null check (amount_kobo > 0),
  status text not null check (status in ('pending', 'processed', 'failed')),
  provider_reference text,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.membership_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  reference text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  event_id text primary key,
  event_type text not null,
  reference text,
  result text not null default 'received',
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.memberships enable row level security;
alter table public.payments enable row level security;
alter table public.revenue_ledger enable row level security;
alter table public.refunds enable row level security;
alter table public.membership_audit_log enable row level security;
alter table public.webhook_events enable row level security;

revoke all on public.memberships, public.payments, public.revenue_ledger, public.refunds,
  public.membership_audit_log, public.webhook_events from anon, authenticated;
grant select on public.memberships, public.payments, public.revenue_ledger, public.refunds to authenticated;
grant all on public.memberships, public.payments, public.revenue_ledger, public.refunds,
  public.membership_audit_log, public.webhook_events to service_role;

drop policy if exists "Users can read their membership" on public.memberships;
create policy "Users can read their membership" on public.memberships
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Users can read their payments" on public.payments;
create policy "Users can read their payments" on public.payments
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Users can read their revenue entries" on public.revenue_ledger;
create policy "Users can read their revenue entries" on public.revenue_ledger
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Users can read their refunds" on public.refunds;
create policy "Users can read their refunds" on public.refunds
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.has_active_membership(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user_id
      and m.status in ('active', 'grace')
      and (m.current_period_end > now() or m.grace_until > now())
  );
$$;

comment on function public.has_active_membership(uuid) is
  'Checks paid membership through its period end and configured grace window.';
revoke all on function public.has_active_membership(uuid) from public, anon, authenticated;

create or replace function public.apply_paystack_event(
  p_event_id text,
  p_event_type text,
  p_reference text,
  p_verified_status text,
  p_verified_amount_kobo bigint,
  p_verified_currency text,
  p_channel text,
  p_payload jsonb,
  p_grace_days integer
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  payment_row public.payments%rowtype;
  period_start_value timestamptz;
  period_end_value timestamptz;
  inserted_count integer;
begin
  insert into public.webhook_events(event_id, event_type, reference, payload)
  values (p_event_id, p_event_type, p_reference, p_payload)
  on conflict (event_id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    return 'duplicate';
  end if;

  select * into payment_row
  from public.payments
  where reference = p_reference
  for update;
  if not found then
    update public.webhook_events set result = 'unmatched', processed_at = now() where event_id = p_event_id;
    return 'unmatched';
  end if;
  if payment_row.status = 'success' then
    update public.webhook_events set result = 'already_processed', processed_at = now() where event_id = p_event_id;
    return 'already_processed';
  end if;
  if p_event_type = 'charge.failed' or p_verified_status in ('failed', 'abandoned') then
    update public.payments set status = 'failed', raw_event_id = p_event_id, updated_at = now()
    where id = payment_row.id and status = 'pending';
    update public.webhook_events set result = 'failed', processed_at = now() where event_id = p_event_id;
    return 'failed';
  end if;
  if p_event_type not in ('charge.success', 'reconciliation') or p_verified_status <> 'success' then
    update public.webhook_events set result = 'pending', processed_at = now() where event_id = p_event_id;
    return 'pending';
  end if;
  if p_verified_currency <> 'NGN' or p_verified_amount_kobo <> payment_row.amount_kobo then
    update public.payments set status = 'failed', received_amount_kobo = p_verified_amount_kobo,
      raw_event_id = p_event_id, updated_at = now()
    where id = payment_row.id and status = 'pending';
    update public.webhook_events set result = 'wrong_amount', processed_at = now() where event_id = p_event_id;
    return 'wrong_amount';
  end if;

  select case
    when m.current_period_end > now() then m.current_period_end
    else now()
  end
  into period_start_value
  from public.memberships m
  where m.user_id = payment_row.user_id;
  if period_start_value is null then
    period_start_value := now();
  end if;
  period_end_value := period_start_value + interval '1 month';

  update public.payments set status = 'success', received_amount_kobo = p_verified_amount_kobo,
    raw_event_id = p_event_id, channel = p_channel, period_start = period_start_value,
    period_end = period_end_value, updated_at = now()
  where id = payment_row.id;

  insert into public.memberships(user_id, status, current_period_start, current_period_end, grace_until, source, updated_at)
  values (payment_row.user_id, 'active', period_start_value, period_end_value,
    period_end_value + make_interval(days => greatest(p_grace_days, 0)), 'paystack', now())
  on conflict (user_id) do update set status = 'active', current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end, grace_until = excluded.grace_until,
    source = 'paystack', updated_at = now();

  insert into public.revenue_ledger(user_id, payment_id, entry_key, entry_type, amount_kobo)
  values (payment_row.user_id, payment_row.id, 'payment:' || p_reference, 'membership_payment', payment_row.amount_kobo)
  on conflict (entry_key) do nothing;

  insert into public.notifications(user_id, type, title, body, content_id)
  values (payment_row.user_id, 'personal', 'Welcome, Member',
    'Your Geniuz+ membership is active until ' || to_char(period_end_value at time zone 'UTC', 'YYYY-MM-DD') || '.',
    'membership:welcome:' || p_reference);
  update public.webhook_events set result = 'activated', processed_at = now() where event_id = p_event_id;
  return 'activated';
end;
$$;

create unique index if not exists notifications_membership_reminder_unique
  on public.notifications(user_id, content_id)
  where content_id like 'membership:renewal:%';

create or replace function public.create_membership_renewal_reminders(p_days_before integer default 3)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  created_count integer;
begin
  insert into public.notifications(user_id, type, title, body, content_id)
  select m.user_id, 'personal', 'Membership renewal reminder',
    'Your Member access ends on ' || to_char(m.current_period_end at time zone 'UTC', 'YYYY-MM-DD') || '. Renew to keep your benefits.',
    'membership:renewal:' || m.user_id::text || ':' || to_char(m.current_period_end at time zone 'UTC', 'YYYY-MM-DD')
  from public.memberships m
  where m.status = 'active'
    and m.current_period_end > now()
    and m.current_period_end <= now() + make_interval(days => greatest(p_days_before, 0))
  on conflict (user_id, content_id) where content_id like 'membership:renewal:%' do nothing;
  get diagnostics created_count = row_count;
  return created_count;
end;
$$;

create or replace function public.record_membership_refund(
  p_reference text,
  p_admin_user_id uuid,
  p_provider_reference text,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  payment_row public.payments%rowtype;
begin
  select * into payment_row from public.payments where reference = p_reference for update;
  if not found or payment_row.status <> 'success' then
    return 'not_refundable';
  end if;
  if exists (select 1 from public.refunds where payment_id = payment_row.id) then
    return 'already_refunded';
  end if;
  update public.payments set status = 'refunded', updated_at = now() where id = payment_row.id;
  insert into public.refunds(payment_id, reference, user_id, admin_user_id, amount_kobo, status, provider_reference, reason)
  values (payment_row.id, p_reference, payment_row.user_id, p_admin_user_id, payment_row.amount_kobo,
    'processed', p_provider_reference, p_reason);
  insert into public.revenue_ledger(user_id, payment_id, entry_key, entry_type, amount_kobo)
  values (payment_row.user_id, payment_row.id, 'refund:' || p_reference, 'refund', -payment_row.amount_kobo);
  insert into public.membership_audit_log(admin_user_id, user_id, action, reference, details)
  values (p_admin_user_id, payment_row.user_id, 'refund', p_reference,
    jsonb_build_object('amountKobo', payment_row.amount_kobo, 'reason', p_reason));
  if payment_row.period_end is not null then
    update public.memberships set status = 'refunded', grace_until = now(),
      current_period_end = least(current_period_end, now()), updated_at = now()
    where user_id = payment_row.user_id and current_period_end = payment_row.period_end;
  end if;
  return 'refunded';
end;
$$;

revoke all on function public.apply_paystack_event(text, text, text, text, bigint, text, text, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.create_membership_renewal_reminders(integer) from public, anon, authenticated;
revoke all on function public.record_membership_refund(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_paystack_event(text, text, text, text, bigint, text, text, jsonb, integer) to service_role;
grant execute on function public.create_membership_renewal_reminders(integer) to service_role;
grant execute on function public.record_membership_refund(text, uuid, text, text) to service_role;
