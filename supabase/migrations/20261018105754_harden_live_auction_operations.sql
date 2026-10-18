-- Harden live-event invariants, replace client-side winner inference with a
-- database leaderboard, and record administrator changes for later review.

-- These compatibility RPCs were superseded by the contact-aware endpoints.
-- Leaving them executable lets authenticated anonymous users reserve names
-- without completing registration.
drop function if exists public.join_auction(uuid, text);
drop function if exists public.get_my_participant(uuid);
drop function if exists public.get_my_auction_identity();

create function private.protect_auction_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
     and not (
       (old.status = 'upcoming' and new.status = 'active')
       or (old.status = 'active' and new.status = 'ended')
     ) then
    raise exception 'Invalid auction status transition from % to %.', old.status, new.status;
  end if;

  if (old.status <> 'upcoming' or new.status <> 'upcoming')
     and (
       old.starting_price is distinct from new.starting_price
       or old.minimum_increment is distinct from new.minimum_increment
       or old.maximum_bid_difference is distinct from new.maximum_bid_difference
       or old.winner_count is distinct from new.winner_count
       or old.timer_duration_seconds is distinct from new.timer_duration_seconds
       or old.currency is distinct from new.currency
     ) then
    raise exception 'Auction rules cannot change after an event has started.';
  end if;

  if old.status = 'active'
     and (
       old.title is distinct from new.title
       or old.description is distinct from new.description
       or old.image_url is distinct from new.image_url
     ) then
    raise exception 'Auction details cannot change while an event is active.';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_auction_lifecycle()
  from public, anon, authenticated;

create trigger auctions_protect_lifecycle
before update on public.auctions
for each row execute function private.protect_auction_lifecycle();

create function private.prevent_late_participant_registration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status public.auction_status;
begin
  -- The row lock serializes registration with an administrator ending the lot.
  select auction.status into v_status
  from public.auctions as auction
  where auction.id = new.auction_id
  for key share;

  if v_status = 'ended' then
    raise exception 'Registration is closed because this auction has ended.';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_late_participant_registration()
  from public, anon, authenticated;

create trigger participants_prevent_registration_after_end
before insert on public.participants
for each row execute function private.prevent_late_participant_registration();

create table private.auction_audit_log (
  id bigint generated always as identity primary key,
  auction_id uuid,
  action text not null check (action in ('created', 'updated', 'started', 'ended', 'deleted')),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default clock_timestamp()
);

comment on table private.auction_audit_log is
  'Append-only database audit trail for auction configuration and lifecycle changes.';

create index auction_audit_log_auction_created_idx
  on private.auction_audit_log (auction_id, created_at desc);

alter table private.auction_audit_log enable row level security;
revoke all on private.auction_audit_log from public, anon, authenticated;
grant select, insert on private.auction_audit_log to service_role;
grant usage, select on sequence private.auction_audit_log_id_seq to service_role;

create function private.record_auction_audit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_action text;
  v_auction_id uuid;
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
    v_auction_id := new.id;
  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
    v_auction_id := old.id;
  elsif old.status <> new.status and new.status = 'active' then
    v_action := 'started';
    v_auction_id := new.id;
  elsif old.status <> new.status and new.status = 'ended' then
    v_action := 'ended';
    v_auction_id := new.id;
  else
    v_action := 'updated';
    v_auction_id := new.id;
  end if;

  insert into private.auction_audit_log (auction_id, action, old_data, new_data)
  values (
    v_auction_id,
    v_action,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function private.record_auction_audit()
  from public, anon, authenticated;

create trigger auctions_record_audit
after insert or update or delete on public.auctions
for each row execute function private.record_auction_audit();

create function public.reorder_auction(
  p_auction_id uuid,
  p_direction integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current_order bigint;
  v_neighbor_id uuid;
  v_neighbor_order bigint;
  v_temporary_order bigint;
begin
  if p_direction not in (-1, 1) then
    raise exception 'Auction direction must be -1 or 1.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.auction_queue_order', 0)
  );

  select auction.sort_order into v_current_order
  from public.auctions as auction
  where auction.id = p_auction_id
  for update;

  if not found then
    raise exception 'Auction event not found.';
  end if;

  if p_direction = -1 then
    select auction.id, auction.sort_order
    into v_neighbor_id, v_neighbor_order
    from public.auctions as auction
    where auction.sort_order < v_current_order
    order by auction.sort_order desc
    limit 1
    for update;
  else
    select auction.id, auction.sort_order
    into v_neighbor_id, v_neighbor_order
    from public.auctions as auction
    where auction.sort_order > v_current_order
    order by auction.sort_order
    limit 1
    for update;
  end if;

  if v_neighbor_id is null then
    return;
  end if;

  select coalesce(max(auction.sort_order), 0) + 1
  into v_temporary_order
  from public.auctions as auction;

  update public.auctions set sort_order = v_temporary_order
  where id = p_auction_id;
  update public.auctions set sort_order = v_current_order
  where id = v_neighbor_id;
  update public.auctions set sort_order = v_neighbor_order
  where id = p_auction_id;
end;
$$;

revoke all on function public.reorder_auction(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reorder_auction(uuid, integer)
  to service_role;

create function public.duplicate_auction(p_auction_id uuid)
returns setof public.auctions
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.auction_queue_order', 0)
  );

  if not exists (
    select 1 from public.auctions as auction where auction.id = p_auction_id
  ) then
    raise exception 'Auction event not found.';
  end if;

  return query
  insert into public.auctions (
    title,
    description,
    image_url,
    starting_price,
    minimum_increment,
    maximum_bid_difference,
    winner_count,
    timer_duration_seconds,
    currency,
    status
  )
  select
    left(source.title || ' (copy)', 120),
    source.description,
    source.image_url,
    source.starting_price,
    source.minimum_increment,
    source.maximum_bid_difference,
    source.winner_count,
    source.timer_duration_seconds,
    source.currency,
    'upcoming'::public.auction_status
  from public.auctions as source
  where source.id = p_auction_id
  returning *;
end;
$$;

revoke all on function public.duplicate_auction(uuid)
  from public, anon, authenticated;
grant execute on function public.duplicate_auction(uuid)
  to service_role;

create function public.delete_upcoming_auction(p_auction_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status public.auction_status;
begin
  select auction.status into v_status
  from public.auctions as auction
  where auction.id = p_auction_id
  for update;

  if not found then
    raise exception 'Auction event not found.';
  end if;

  if v_status <> 'upcoming' then
    raise exception 'Only an upcoming auction event can be deleted.';
  end if;

  if exists (
    select 1 from public.participants as participant
    where participant.auction_id = p_auction_id
  ) or exists (
    select 1 from public.bids as bid
    where bid.auction_id = p_auction_id
  ) then
    raise exception 'An auction with registrations or bids cannot be deleted.';
  end if;

  delete from public.auctions where id = p_auction_id;
end;
$$;

revoke all on function public.delete_upcoming_auction(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_upcoming_auction(uuid)
  to service_role;

create table private.admin_login_attempts (
  key_hash text primary key,
  window_started_at timestamptz not null default clock_timestamp(),
  failure_count integer not null default 0 check (failure_count >= 0),
  blocked_until timestamptz,
  last_attempt_at timestamptz not null default clock_timestamp()
);

alter table private.admin_login_attempts enable row level security;
revoke all on private.admin_login_attempts from public, anon, authenticated;
grant select, insert, update, delete on private.admin_login_attempts to service_role;

create function public.consume_admin_login_attempt(
  p_key_hash text,
  p_succeeded boolean
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt private.admin_login_attempts%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_key_hash is null or char_length(p_key_hash) <> 64 then
    raise exception 'A valid login rate-limit key is required.';
  end if;

  insert into private.admin_login_attempts (key_hash)
  values (p_key_hash)
  on conflict (key_hash) do nothing;

  select attempt.* into v_attempt
  from private.admin_login_attempts as attempt
  where attempt.key_hash = p_key_hash
  for update;

  if v_attempt.blocked_until is not null and v_attempt.blocked_until > v_now then
    return query
    select false, greatest(1, ceil(extract(epoch from (v_attempt.blocked_until - v_now)))::integer);
    return;
  end if;

  if p_succeeded then
    delete from private.admin_login_attempts where key_hash = p_key_hash;
    return query select true, 0;
    return;
  end if;

  if v_attempt.window_started_at <= v_now - interval '15 minutes' then
    v_attempt.window_started_at := v_now;
    v_attempt.failure_count := 0;
  end if;

  v_attempt.failure_count := v_attempt.failure_count + 1;
  v_attempt.blocked_until := case
    when v_attempt.failure_count >= 5 then v_now + interval '15 minutes'
    else null
  end;

  update private.admin_login_attempts
  set window_started_at = v_attempt.window_started_at,
      failure_count = v_attempt.failure_count,
      blocked_until = v_attempt.blocked_until,
      last_attempt_at = v_now
  where key_hash = p_key_hash;

  return query
  select
    v_attempt.blocked_until is null,
    case
      when v_attempt.blocked_until is null then 0
      else greatest(1, ceil(extract(epoch from (v_attempt.blocked_until - v_now)))::integer)
    end;
end;
$$;

revoke all on function public.consume_admin_login_attempt(text, boolean)
  from public, anon, authenticated;
grant execute on function public.consume_admin_login_attempt(text, boolean)
  to service_role;

create table private.auction_winner_payments (
  auction_id uuid not null,
  participant_id uuid not null,
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'waived')),
  paid_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (auction_id, participant_id),
  foreign key (auction_id, participant_id)
    references public.auction_winners (auction_id, participant_id)
    on delete cascade,
  check (
    (payment_status = 'paid' and paid_at is not null)
    or (payment_status <> 'paid' and paid_at is null)
  )
);

comment on table private.auction_winner_payments is
  'Administrator-managed payment reconciliation for finalized winners.';

alter table private.auction_winner_payments enable row level security;
revoke all on private.auction_winner_payments from public, anon, authenticated;
grant select, insert, update on private.auction_winner_payments to service_role;

create function public.set_auction_winner_payment(
  p_auction_id uuid,
  p_participant_id uuid,
  p_payment_status text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_payment_status not in ('pending', 'paid', 'waived') then
    raise exception 'Invalid payment status.';
  end if;

  if not exists (
    select 1
    from public.auction_winners as winner
    where winner.auction_id = p_auction_id
      and winner.participant_id = p_participant_id
  ) then
    raise exception 'Finalized auction winner not found.';
  end if;

  insert into private.auction_winner_payments (
    auction_id,
    participant_id,
    payment_status,
    paid_at
  )
  values (
    p_auction_id,
    p_participant_id,
    p_payment_status,
    case when p_payment_status = 'paid' then clock_timestamp() else null end
  )
  on conflict (auction_id, participant_id) do update
  set payment_status = excluded.payment_status,
      paid_at = excluded.paid_at,
      updated_at = clock_timestamp();
end;
$$;

revoke all on function public.set_auction_winner_payment(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_auction_winner_payment(uuid, uuid, text)
  to service_role;

create function public.get_auction_winner_report()
returns table (
  auction_id uuid,
  title text,
  sort_order bigint,
  winner_rank integer,
  participant_id uuid,
  username text,
  email text,
  winning_amount numeric,
  currency text,
  finalized_at timestamptz,
  payment_status text,
  paid_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    winner.auction_id,
    auction.title,
    auction.sort_order,
    winner.winner_rank,
    winner.participant_id,
    participant.username,
    contact.email,
    winner.winning_amount,
    auction.currency,
    winner.finalized_at,
    coalesce(payment.payment_status, 'pending'),
    payment.paid_at
  from public.auction_winners as winner
  join public.auctions as auction on auction.id = winner.auction_id
  join public.participants as participant on participant.id = winner.participant_id
  left join private.participant_contacts as contact
    on contact.participant_id = winner.participant_id
  left join private.auction_winner_payments as payment
    on payment.auction_id = winner.auction_id
   and payment.participant_id = winner.participant_id
  order by auction.sort_order, winner.winner_rank;
$$;

revoke all on function public.get_auction_winner_report()
  from public, anon, authenticated;
grant execute on function public.get_auction_winner_report()
  to service_role;

create or replace function public.get_auction_leaderboard(p_auction_id uuid)
returns table (
  bid_id uuid,
  participant_id uuid,
  username text,
  amount numeric,
  created_at timestamptz,
  bidder_rank integer,
  is_winner boolean,
  is_final boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with highest_by_participant as (
    select
      bid.id,
      bid.auction_id,
      bid.participant_id,
      bid.amount,
      bid.created_at,
      row_number() over (
        partition by bid.auction_id, bid.participant_id
        order by bid.amount desc, bid.created_at, bid.id
      ) as participant_rank
    from public.bids as bid
    where bid.auction_id = p_auction_id
  ),
  ranked as (
    select
      highest.id,
      highest.auction_id,
      highest.participant_id,
      highest.amount,
      highest.created_at,
      row_number() over (
        order by highest.amount desc, highest.created_at, highest.id
      ) as bidder_rank
    from highest_by_participant as highest
    where highest.participant_rank = 1
  )
  select
    ranked.id,
    ranked.participant_id,
    participant.username,
    ranked.amount,
    ranked.created_at,
    ranked.bidder_rank::integer,
    ranked.bidder_rank <= auction.winner_count,
    auction.status = 'ended'
  from ranked
  join public.auctions as auction on auction.id = ranked.auction_id
  join public.participants as participant on participant.id = ranked.participant_id
  order by ranked.bidder_rank;
$$;

revoke all on function public.get_auction_leaderboard(uuid)
  from public;
grant execute on function public.get_auction_leaderboard(uuid)
  to anon, authenticated;

create index if not exists bids_auction_participant_ranking_idx
  on public.bids (auction_id, participant_id, amount desc, created_at, id);

comment on function public.get_auction_leaderboard(uuid) is
  'Returns one highest bid per participant with deterministic rank and winner status.';

-- Reserve the next active event immediately, but delay bid acceptance long
-- enough for every connected client to show the same public start countdown.
create or replace function public.activate_auction(p_auction_id uuid)
returns setof public.auctions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status public.auction_status;
  v_active_auction_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.auction_status_change', 0)
  );

  select auction.status into v_status
  from public.auctions as auction
  where auction.id = p_auction_id
  for update;

  if not found then
    raise exception 'Auction event not found.';
  end if;

  if v_status <> 'upcoming' then
    raise exception 'Only an upcoming auction event can be started.';
  end if;

  select auction.id into v_active_auction_id
  from public.auctions as auction
  where auction.status = 'active'
  order by auction.sort_order, auction.id
  limit 1
  for update;

  if v_active_auction_id is not null then
    perform private.persist_auction_winners(v_active_auction_id);

    update public.auctions
    set status = 'ended',
        ends_at = coalesce(ends_at, now())
    where id = v_active_auction_id;
  end if;

  return query
  update public.auctions
  set status = 'active',
      starts_at = clock_timestamp() + interval '5 seconds',
      ends_at = null
  where id = p_auction_id
  returning *;
end;
$$;

revoke all on function public.activate_auction(uuid)
  from public, anon, authenticated;
grant execute on function public.activate_auction(uuid)
  to service_role;
