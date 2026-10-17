-- Persist the final winning bid for every winning participant. This snapshot is
-- written in the same transaction that ends an event, so accepted bids and the
-- final result cannot drift apart.

create table public.auction_winners (
  auction_id uuid not null
    references public.auctions(id) on delete cascade,
  winner_rank integer not null
    constraint auction_winners_rank_positive check (winner_rank > 0),
  participant_id uuid not null
    references public.participants(id) on delete restrict,
  bid_id uuid not null
    references public.bids(id) on delete restrict,
  winning_amount numeric(12, 2) not null
    constraint auction_winners_amount_positive check (winning_amount > 0),
  finalized_at timestamptz not null default now(),
  primary key (auction_id, winner_rank),
  constraint auction_winners_participant_unique
    unique (auction_id, participant_id),
  constraint auction_winners_bid_unique unique (bid_id)
);

comment on table public.auction_winners is
  'Immutable winner snapshot created when an auction event ends.';
comment on column public.auction_winners.winning_amount is
  'Winning bid amount copied at finalization time for reporting and auditability.';

-- The primary key covers auction_id and the bid_id constraint has its own
-- index. This additional index covers the remaining foreign key.
create index auction_winners_participant_id_idx
  on public.auction_winners (participant_id);

alter table public.auction_winners enable row level security;
revoke all on table public.auction_winners from anon, authenticated;
grant select, insert, update, delete on table public.auction_winners to service_role;

create function private.persist_auction_winners(p_auction_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_winner_count integer;
begin
  -- This lock serializes finalization with public.place_bid, which locks the
  -- same auction row before accepting a bid.
  select auction.winner_count into v_winner_count
  from public.auctions as auction
  where auction.id = p_auction_id
  for update;

  if not found then
    raise exception 'Auction event not found.';
  end if;

  delete from public.auction_winners
  where auction_id = p_auction_id;

  insert into public.auction_winners (
    auction_id,
    winner_rank,
    participant_id,
    bid_id,
    winning_amount
  )
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
  ranked_winners as (
    select
      highest.id,
      highest.auction_id,
      highest.participant_id,
      highest.amount,
      row_number() over (
        order by highest.amount desc, highest.created_at, highest.id
      ) as winner_rank
    from highest_by_participant as highest
    where highest.participant_rank = 1
  )
  select
    ranked.auction_id,
    ranked.winner_rank::integer,
    ranked.participant_id,
    ranked.id,
    ranked.amount
  from ranked_winners as ranked
  where ranked.winner_rank <= v_winner_count
  order by ranked.winner_rank;
end;
$$;

revoke all on function private.persist_auction_winners(uuid)
  from public, anon, authenticated;
grant execute on function private.persist_auction_winners(uuid)
  to service_role;

-- Existing ended events receive the same deterministic snapshot during the
-- migration. Events without bids correctly receive no winner rows.
do $$
declare
  v_auction_id uuid;
begin
  for v_auction_id in
    select auction.id
    from public.auctions as auction
    where auction.status = 'ended'
    order by auction.id
  loop
    perform private.persist_auction_winners(v_auction_id);
  end loop;
end;
$$;

create function public.end_auction(p_auction_id uuid)
returns setof public.auctions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status public.auction_status;
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

  -- A repeated administrator request is safe and does not recalculate an
  -- already finalized result.
  if v_status = 'ended' then
    return query
    select auction.*
    from public.auctions as auction
    where auction.id = p_auction_id;
    return;
  end if;

  if v_status <> 'active' then
    raise exception 'Only an active auction event can be ended.';
  end if;

  perform private.persist_auction_winners(p_auction_id);

  return query
  update public.auctions
  set status = 'ended',
      ends_at = now()
  where id = p_auction_id
  returning *;
end;
$$;

revoke all on function public.end_auction(uuid)
  from public, anon, authenticated;
grant execute on function public.end_auction(uuid)
  to service_role;

-- Starting the next event also finalizes the currently active event before it
-- is marked ended. Both administrator actions share one transaction lock.
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
      starts_at = now(),
      ends_at = null
  where id = p_auction_id
  returning *;
end;
$$;

revoke all on function public.activate_auction(uuid)
  from public, anon, authenticated;
grant execute on function public.activate_auction(uuid)
  to service_role;

-- Ended events use their persisted result for donation reporting. Active and
-- upcoming events keep their live preview based on the current bids.
create or replace function public.get_auction_donation_totals()
returns table (
  auction_id uuid,
  title text,
  currency text,
  sort_order bigint,
  bid_count bigint,
  total_bid_amount numeric
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
      bid.amount,
      bid.created_at,
      row_number() over (
        partition by bid.auction_id, bid.participant_id
        order by bid.amount desc, bid.created_at, bid.id
      ) as participant_rank
    from public.bids as bid
  ),
  ranked_live_winners as (
    select
      highest.id,
      highest.auction_id,
      highest.amount,
      row_number() over (
        partition by highest.auction_id
        order by highest.amount desc, highest.created_at, highest.id
      ) as winner_rank
    from highest_by_participant as highest
    where highest.participant_rank = 1
  ),
  reportable_winners as (
    select
      snapshot.auction_id,
      snapshot.bid_id,
      snapshot.winning_amount as amount
    from public.auction_winners as snapshot
    join public.auctions as auction on auction.id = snapshot.auction_id
    where auction.status = 'ended'

    union all

    select
      live.auction_id,
      live.id,
      live.amount
    from ranked_live_winners as live
    join public.auctions as auction on auction.id = live.auction_id
    where auction.status <> 'ended'
      and live.winner_rank <= auction.winner_count
  )
  select
    auction.id,
    auction.title,
    auction.currency,
    auction.sort_order,
    count(winner.bid_id),
    coalesce(sum(winner.amount), 0::numeric)
  from public.auctions as auction
  left join reportable_winners as winner on winner.auction_id = auction.id
  group by auction.id, auction.title, auction.currency, auction.sort_order
  order by auction.sort_order, auction.id;
$$;

comment on function public.get_auction_donation_totals() is
  'Returns persisted winner totals for ended events and live winner previews for all other events.';
