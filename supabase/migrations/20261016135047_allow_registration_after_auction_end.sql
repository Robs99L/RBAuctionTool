-- Registration remains available independently of the bidding phase. Bids
-- themselves are still restricted to active auctions by public.place_bid.
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

  if not exists (
    select 1 from public.auctions a
    where a.id = p_auction_id
  ) then
    raise exception 'This auction is not available to join.';
  end if;

  select p.* into v_participant
  from public.participants p
  where p.auction_id = p_auction_id and p.user_id = v_user_id;

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
    begin
      insert into public.participants (auction_id, user_id, username)
      values (p_auction_id, v_user_id, v_username)
      returning * into v_participant;

      insert into private.participant_contacts (participant_id, email)
      values (v_participant.id, v_email);
    exception when unique_violation then
      raise exception 'That name is already in use for this auction.';
    end;
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
  'Registers an authenticated auction participant regardless of the current bidding phase.';
