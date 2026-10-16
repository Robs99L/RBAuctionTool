-- Store participant email addresses outside the exposed public schema. Bids
-- remain linked to contact details through bids.participant_id.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

alter table public.participants
  drop constraint if exists participants_username_check;

alter table public.participants
  add constraint participants_username_valid
  check (
    username = trim(username)
    and char_length(username) between 1 and 120
  );

comment on column public.participants.username is
  'Participant full name shown publicly with accepted bids.';

create table private.participant_contacts (
  participant_id uuid primary key
    references public.participants(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  constraint participant_contacts_email_valid check (
    email = lower(trim(email))
    and char_length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);

alter table private.participant_contacts enable row level security;
revoke all on private.participant_contacts from public, anon, authenticated;
grant select on private.participant_contacts to service_role;

create function private.require_bidder_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from private.participant_contacts pc
    where pc.participant_id = new.participant_id
  ) then
    raise exception 'Complete registration with your name and email before bidding.';
  end if;

  return new;
end;
$$;

revoke all on function private.require_bidder_contact() from public, anon, authenticated;

create trigger bids_require_participant_contact
before insert on public.bids
for each row execute function private.require_bidder_contact();

create function public.join_auction_with_contact(
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
    where a.id = p_auction_id and a.status <> 'ended'
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

create function public.get_my_participant_with_contact(p_auction_id uuid)
returns table (
  id uuid,
  auction_id uuid,
  username text,
  email text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.auction_id, p.username, pc.email, p.created_at
  from public.participants p
  left join private.participant_contacts pc on pc.participant_id = p.id
  where p.auction_id = p_auction_id and p.user_id = (select auth.uid())
  limit 1;
$$;

create function public.get_my_auction_identity_with_contact()
returns table (
  username text,
  email text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.username, pc.email
  from public.participants p
  join private.participant_contacts pc on pc.participant_id = p.id
  where p.user_id = (select auth.uid())
  order by p.created_at desc, p.id
  limit 1;
$$;

comment on function public.get_my_auction_identity_with_contact() is
  'Returns the authenticated participant name and private email most recently used in this auction queue.';

revoke all on function public.join_auction_with_contact(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_my_participant_with_contact(uuid) from public, anon, authenticated;
revoke all on function public.get_my_auction_identity_with_contact() from public, anon, authenticated;
grant execute on function public.join_auction_with_contact(uuid, text, text) to authenticated;
grant execute on function public.get_my_participant_with_contact(uuid) to authenticated;
grant execute on function public.get_my_auction_identity_with_contact() to authenticated;

-- Admin-only bid details include the private email through a controlled RPC.
create function public.get_auction_admin_bids(p_auction_id uuid)
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
  select b.id, b.participant_id, b.amount, b.created_at, p.username, pc.email
  from public.bids b
  join public.participants p on p.id = b.participant_id
  left join private.participant_contacts pc on pc.participant_id = p.id
  where b.auction_id = p_auction_id
  order by b.created_at desc, b.id;
$$;

-- Every accepted bid contributes to the donation total, including multiple
-- bids by the same participant.
create function public.get_auction_donation_totals()
returns table (
  auction_id uuid,
  title text,
  currency text,
  sort_order integer,
  bid_count bigint,
  total_bid_amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.title, a.currency, a.sort_order,
         count(b.id), coalesce(sum(b.amount), 0::numeric)
  from public.auctions a
  left join public.bids b on b.auction_id = a.id
  group by a.id, a.title, a.currency, a.sort_order
  order by a.sort_order, a.id;
$$;

revoke all on function public.get_auction_admin_bids(uuid) from public, anon, authenticated;
revoke all on function public.get_auction_donation_totals() from public, anon, authenticated;
grant execute on function public.get_auction_admin_bids(uuid) to service_role;
grant execute on function public.get_auction_donation_totals() to service_role;
