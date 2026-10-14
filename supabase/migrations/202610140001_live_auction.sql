-- Live auction MVP schema. Apply with `supabase db push` or in the SQL editor.

create extension if not exists pgcrypto;

create type public.auction_status as enum ('upcoming', 'active', 'ended');

create table public.auctions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  image_url text check (image_url is null or char_length(image_url) <= 2000),
  starting_price numeric(12, 2) not null check (starting_price >= 0),
  minimum_increment numeric(12, 2) not null default 1 check (minimum_increment > 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  status public.auction_status not null default 'upcoming',
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null check (
    username = trim(username)
    and char_length(username) between 1 and 32
  ),
  created_at timestamptz not null default now(),
  unique (auction_id, user_id)
);

create unique index participants_auction_username_unique
  on public.participants (auction_id, lower(username));

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default clock_timestamp()
);

create index bids_auction_latest_idx
  on public.bids (auction_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger auctions_set_updated_at
before update on public.auctions
for each row execute function public.set_updated_at();

-- A participant is bound to the authenticated anonymous user. The browser never
-- chooses its own participant ID, and duplicate usernames are enforced in SQL.
create or replace function public.join_auction(
  p_auction_id uuid,
  p_username text
)
returns table (
  id uuid,
  auction_id uuid,
  username text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_username text := trim(p_username);
  v_participant public.participants%rowtype;
begin
  if v_user_id is null then
    raise exception 'You must have an authenticated session to join.';
  end if;

  if v_username is null or char_length(v_username) < 1 or char_length(v_username) > 32 then
    raise exception 'Username must be between 1 and 32 characters.';
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
  else
    begin
      insert into public.participants (auction_id, user_id, username)
      values (p_auction_id, v_user_id, v_username)
      returning * into v_participant;
    exception when unique_violation then
      raise exception 'That username is already in use for this auction.';
    end;
  end if;

  return query
  select v_participant.id, v_participant.auction_id,
         v_participant.username, v_participant.created_at;
end;
$$;

-- Locking the auction row serializes competing submissions for one auction.
-- Every validation and the insert happen inside the same transaction.
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

  select max(b.amount) into v_highest
  from public.bids b
  where b.auction_id = p_auction_id;

  v_minimum := coalesce(v_highest, v_auction.starting_price)
               + v_auction.minimum_increment;

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

create or replace function public.get_my_participant(p_auction_id uuid)
returns table (
  id uuid,
  auction_id uuid,
  username text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.auction_id, p.username, p.created_at
  from public.participants p
  where p.auction_id = p_auction_id and p.user_id = auth.uid()
  limit 1;
$$;

alter table public.auctions enable row level security;
alter table public.participants enable row level security;
alter table public.bids enable row level security;

create policy "Auctions are publicly readable"
  on public.auctions for select to anon, authenticated using (true);

create policy "Participant display names are publicly readable"
  on public.participants for select to anon, authenticated using (true);

create policy "Accepted bids are publicly readable"
  on public.bids for select to anon, authenticated using (true);

-- Only safe reads and the two validated RPCs are available to browser roles.
revoke all on public.auctions from anon, authenticated;
revoke all on public.participants from anon, authenticated;
revoke all on public.bids from anon, authenticated;
grant select on public.auctions to anon, authenticated;
grant select (id, auction_id, username, created_at) on public.participants to anon, authenticated;
grant select on public.bids to anon, authenticated;

revoke all on function public.join_auction(uuid, text) from public, anon;
revoke all on function public.place_bid(uuid, numeric) from public, anon;
revoke all on function public.get_my_participant(uuid) from public, anon;
grant execute on function public.join_auction(uuid, text) to authenticated;
grant execute on function public.place_bid(uuid, numeric) to authenticated;
grant execute on function public.get_my_participant(uuid) to authenticated;

-- Add tables to Realtime once. Duplicate-object handling makes repeatable setup safe.
do $$
begin
  alter publication supabase_realtime add table public.auctions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.bids;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.participants;
exception when duplicate_object then null;
end $$;
