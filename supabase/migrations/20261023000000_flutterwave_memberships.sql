-- Add Flutterwave as an allowed membership payment source.
alter table public.memberships
  drop constraint if exists memberships_source_check;

alter table public.memberships
  add constraint memberships_source_check
  check (source in ('paystack', 'flutterwave'));

create or replace function public.apply_flutterwave_event(
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
  if p_event_type = 'charge.failed' or p_verified_status in ('failed', 'abandoned', 'cancelled') then
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

  if payment_row.status <> 'pending' then
    update public.webhook_events set result = 'not_pending', processed_at = now() where event_id = p_event_id;
    return 'not_pending';
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
    period_end_value + make_interval(days => greatest(p_grace_days, 0)), 'flutterwave', now())
  on conflict (user_id) do update set status = 'active', current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end, grace_until = excluded.grace_until,
    source = 'flutterwave', updated_at = now();

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

revoke all on function public.apply_flutterwave_event(text, text, text, text, bigint, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.apply_flutterwave_event(text, text, text, text, bigint, text, text, jsonb, integer) to service_role;
