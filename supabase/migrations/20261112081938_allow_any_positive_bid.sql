-- Accept every positive monetary bid, including ties and amounts below the
-- opening price or current leader. Rankings still use each person's best bid.
-- Keep authenticated identity, event lifecycle and repeat-submission checks.

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
  v_latest_participant_bid_at timestamptz;
  v_bid public.bids%rowtype;
begin
  if v_user_id is null then
    raise exception 'Your session has expired. Please rejoin the auction.';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 9999999999.99
     or p_amount::text in ('NaN', 'Infinity', '-Infinity')
     or round(p_amount, 2) <> p_amount then
    raise exception 'Enter a valid positive bid with no more than two decimal places.';
  end if;

  select participant.* into v_participant
  from public.participants as participant
  where participant.auction_id = p_auction_id
    and participant.user_id = v_user_id;

  if not found then
    raise exception 'Join the auction before placing a bid.';
  end if;

  -- Serialize acceptance with event finalization and same-person submissions.
  -- There is no price comparison between competing participants.
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

comment on function public.place_bid(uuid, numeric) is
  'Stores every positive two-decimal bid during an active event; no opening-price, minimum-step or maximum-increase requirement. Rankings use the highest bid per participant.';
