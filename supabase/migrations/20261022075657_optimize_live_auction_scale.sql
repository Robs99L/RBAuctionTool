-- Keep the authoritative bid transaction short under burst load and expose a
-- single, transactionally consistent dashboard snapshot for initial loads and
-- reconnect recovery. Realtime INSERT payloads handle steady-state updates.

create index if not exists bids_auction_highest_idx
  on public.bids (auction_id, amount desc, created_at, id)
  include (participant_id);

create index if not exists bids_auction_participant_latest_idx
  on public.bids (auction_id, participant_id, created_at desc, id desc);

create or replace function public.place_bid(
  p_auction_id uuid,
  p_amount numeric
)
returns table (
  bid_id uuid,
  amount numeric,
  created_at timestamptz,
  username text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_auction public.auctions%rowtype;
  v_participant public.participants%rowtype;
  v_highest numeric(12, 2);
  v_highest_participant_id uuid;
  v_latest_participant_bid_at timestamptz;
  v_reference_amount numeric;
  v_minimum numeric;
  v_maximum numeric;
  v_bid public.bids%rowtype;
begin
  if v_user_id is null then
    raise exception 'Your session has expired. Please rejoin the auction.';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 9999999999.99
     or round(p_amount, 2) <> p_amount then
    raise exception 'Enter a valid bid with no more than two decimal places.';
  end if;

  -- Participant identity is immutable. Resolve it before taking the shared
  -- auction hot-row lock so the serialized section stays as short as possible.
  select participant.* into v_participant
  from public.participants as participant
  where participant.auction_id = p_auction_id
    and participant.user_id = v_user_id;

  if not found then
    raise exception 'Join the auction before placing a bid.';
  end if;

  -- This lock remains the authoritative ordering boundary for competing bids.
  select auction.* into v_auction
  from public.auctions as auction
  where auction.id = p_auction_id
  for update;

  if not found then
    raise exception 'Auction not found.';
  end if;

  if v_auction.status <> 'active'
     or (v_auction.starts_at is not null and v_auction.starts_at > now())
     or (v_auction.ends_at is not null and v_auction.ends_at <= now()) then
    raise exception 'This auction is not accepting bids.';
  end if;

  -- The browser already disables repeat submission. This database boundary
  -- also protects Realtime and the bid table from scripted accepted-bid spam.
  select bid.created_at into v_latest_participant_bid_at
  from public.bids as bid
  where bid.auction_id = p_auction_id
    and bid.participant_id = v_participant.id
  order by bid.created_at desc, bid.id desc
  limit 1;

  if v_latest_participant_bid_at is not null
     and clock_timestamp() < v_latest_participant_bid_at + interval '300 milliseconds' then
    raise exception 'Please wait a moment before placing another bid.';
  end if;

  select bid.amount, bid.participant_id
  into v_highest, v_highest_participant_id
  from public.bids as bid
  where bid.auction_id = p_auction_id
  order by bid.amount desc, bid.created_at, bid.id
  limit 1;

  v_reference_amount := coalesce(v_highest, v_auction.starting_price);

  if v_highest is null then
    v_minimum := v_reference_amount + v_auction.minimum_increment;
  elsif v_highest_participant_id = v_participant.id then
    v_minimum := v_reference_amount + 0.01;
  else
    v_minimum := v_reference_amount + v_auction.minimum_increment;
  end if;

  if v_auction.maximum_bid_difference is not null then
    v_maximum := v_reference_amount + v_auction.maximum_bid_difference;
  end if;

  if p_amount < v_minimum then
    raise exception 'The minimum bid is % %.', v_minimum, v_auction.currency;
  end if;

  if v_maximum is not null and p_amount > v_maximum then
    raise exception 'The maximum bid is % %.', v_maximum, v_auction.currency;
  end if;

  insert into public.bids (auction_id, participant_id, amount)
  values (p_auction_id, v_participant.id, p_amount)
  returning * into v_bid;

  return query
  select v_bid.id, v_bid.amount, v_bid.created_at, v_participant.username;
end;
$$;

revoke all on function public.place_bid(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.place_bid(uuid, numeric)
  to authenticated;

create or replace function public.get_auction_dashboard(p_auction_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with selected_auction as (
    select auction.*
    from public.auctions as auction
    where auction.id = p_auction_id
  ),
  recent_bids as (
    select
      bid.id,
      bid.auction_id,
      bid.participant_id,
      bid.amount,
      bid.created_at,
      participant.username
    from public.bids as bid
    join public.participants as participant on participant.id = bid.participant_id
    where bid.auction_id = p_auction_id
    order by bid.created_at desc, bid.id desc
    limit 30
  )
  select pg_catalog.jsonb_build_object(
    'auction', (
      select pg_catalog.to_jsonb(auction_row)
      from selected_auction as auction_row
    ),
    'participant_count', (
      select pg_catalog.count(*)
      from public.participants as participant
      where participant.auction_id = p_auction_id
    ),
    'participants', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', participant.id,
          'username', participant.username
        )
        order by participant.created_at, participant.id
      )
      from public.participants as participant
      where participant.auction_id = p_auction_id
    ), '[]'::jsonb),
    'bids', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(recent_bid)
        order by recent_bid.created_at desc, recent_bid.id desc
      )
      from recent_bids as recent_bid
    ), '[]'::jsonb),
    'leaderboard', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(leaderboard_entry)
        order by leaderboard_entry.bidder_rank
      )
      from public.get_auction_leaderboard(p_auction_id) as leaderboard_entry
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_auction_dashboard(uuid)
  from public;
grant execute on function public.get_auction_dashboard(uuid)
  to anon, authenticated;

comment on function public.get_auction_dashboard(uuid) is
  'Returns one consistent public auction snapshot for initial load and Realtime reconnect recovery.';

create or replace function public.get_auction_admin_bids(p_auction_id uuid)
returns table (
  id uuid,
  participant_id uuid,
  amount numeric,
  created_at timestamptz,
  username text,
  email text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select bid.id,
         bid.participant_id,
         bid.amount,
         bid.created_at,
         participant.username,
         contact.email
  from public.bids as bid
  join public.participants as participant on participant.id = bid.participant_id
  left join private.participant_contacts as contact
    on contact.participant_id = participant.id
  where bid.auction_id = p_auction_id
  order by bid.created_at desc, bid.id desc
  limit 500;
$$;

revoke all on function public.get_auction_admin_bids(uuid)
  from public, anon, authenticated;
grant execute on function public.get_auction_admin_bids(uuid)
  to service_role;

comment on function public.get_auction_admin_bids(uuid) is
  'Returns the latest 500 accepted bids for the selected admin dashboard event.';
