-- Let the current leader increase their own highest bid by any positive
-- currency amount. Other participants must still meet the configured step.
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
  v_minimum numeric(12, 2);
  v_bid public.bids%rowtype;
begin
  if v_user_id is null then
    raise exception 'Your session has expired. Please rejoin the auction.';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 9999999999.99
     or round(p_amount, 2) <> p_amount then
    raise exception 'Enter a valid bid with no more than two decimal places.';
  end if;

  select a.* into v_auction
  from public.auctions a
  where a.id = p_auction_id
  for update;

  if not found then
    raise exception 'Auction not found.';
  end if;

  if v_auction.status <> 'active'
     or (v_auction.starts_at is not null and v_auction.starts_at > now())
     or (v_auction.ends_at is not null and v_auction.ends_at <= now()) then
    raise exception 'This auction is not accepting bids.';
  end if;

  select p.* into v_participant
  from public.participants p
  where p.auction_id = p_auction_id and p.user_id = v_user_id;

  if not found then
    raise exception 'Join the auction before placing a bid.';
  end if;

  select b.amount, b.participant_id
  into v_highest, v_highest_participant_id
  from public.bids b
  where b.auction_id = p_auction_id
  order by b.amount desc, b.created_at asc, b.id asc
  limit 1;

  if v_highest is null then
    v_minimum := v_auction.starting_price + v_auction.minimum_increment;
  elsif v_highest_participant_id = v_participant.id then
    v_minimum := v_highest + 0.01;
  else
    v_minimum := v_highest + v_auction.minimum_increment;
  end if;

  if p_amount < v_minimum then
    raise exception 'The minimum bid is % %.', v_minimum, v_auction.currency;
  end if;

  insert into public.bids (auction_id, participant_id, amount)
  values (p_auction_id, v_participant.id, p_amount)
  returning * into v_bid;

  return query
  select v_bid.id, v_bid.amount, v_bid.created_at, v_participant.username;
end;
$$;
