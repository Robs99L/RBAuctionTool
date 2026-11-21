-- Rejoin by the same self-reported name and email, as requested. There is no
-- email verification: knowledge of both details is sufficient to transfer
-- access. Keep the participant ID so bids, ranks and finalized winners survive.
create or replace function public.join_auction_with_contact(
  p_auction_id uuid,
  p_username text,
  p_email text
)
returns table (
  id uuid,
  auction_id uuid,
  username text,
  email text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_username text := trim(p_username);
  v_email text := lower(trim(p_email));
  v_participant public.participants%rowtype;
  v_existing_email text;
begin
  if v_user_id is null then
    raise exception 'You must have an authenticated session to join.';
  end if;

  if v_username is null or char_length(v_username) < 1 or char_length(v_username) > 120 then
    raise exception 'Name must be between 1 and 120 characters.';
  end if;
  if v_email is null
     or char_length(v_email) < 3
     or char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.';
  end if;

  -- Use the same lock order as bid acceptance: auction, then participant.
  -- This serializes rejoining with bids, registrations and finalization.
  perform 1 from public.auctions a where a.id = p_auction_id for update;
  if not found then
    raise exception 'This auction is not available to join.';
  end if;

  select p.* into v_participant
  from public.participants p
  where p.auction_id = p_auction_id and p.user_id = v_user_id
  for update;

  if found then
    if lower(v_participant.username) <> lower(v_username) then
      raise exception 'This session has already joined as %.', v_participant.username;
    end if;

    select pc.email into v_existing_email
    from private.participant_contacts pc
    where pc.participant_id = v_participant.id;

    if found then
      if v_existing_email <> v_email then
        raise exception 'This session has already joined with a different email address.';
      end if;
    else
      insert into private.participant_contacts (participant_id, email)
      values (v_participant.id, v_email);
    end if;
  else
    select p.* into v_participant
    from public.participants p
    where p.auction_id = p_auction_id and lower(p.username) = lower(v_username)
    for update;

    if found then
      select pc.email into v_existing_email
      from private.participant_contacts pc
      where pc.participant_id = v_participant.id;

      -- Do not disclose the stored email or claim legacy rows without contacts.
      if not found or v_existing_email <> v_email then
        raise exception 'That name is already in use for this auction.';
      end if;

      update public.participants p
      set user_id = v_user_id
      where p.id = v_participant.id
      returning p.* into v_participant;
    else
      insert into public.participants (auction_id, user_id, username)
      values (p_auction_id, v_user_id, v_username)
      returning * into v_participant;

      insert into private.participant_contacts (participant_id, email)
      values (v_participant.id, v_email);
    end if;
  end if;

  return query
  select v_participant.id, v_participant.auction_id,
         v_participant.username, v_email, v_participant.created_at;
end;
$$;

revoke all on function public.join_auction_with_contact(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.join_auction_with_contact(uuid, text, text)
  to authenticated;

comment on function public.join_auction_with_contact(uuid, text, text) is
  'Joins or transfers an existing registration to the current Auth session when name and private email match; no email verification; participant IDs and bids are preserved.';

-- Check the session owner after obtaining the auction lock, so a previous
-- session waiting to bid cannot use a participant transferred by a rejoin.
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

  -- Serialize acceptance with event finalization and same-person submissions.
  -- There is no price comparison between competing participants.
  select auction.* into v_auction
  from public.auctions as auction
  where auction.id = p_auction_id
  for update;

  if not found then
    raise exception 'Auction not found.';
  end if;

  select participant.* into v_participant
  from public.participants as participant
  where participant.auction_id = p_auction_id
    and participant.user_id = v_user_id;

  if not found then
    raise exception 'Join the auction before placing a bid.';
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

