-- Give every connected participant enough time to see the next lot before
-- bidding opens. The database timestamp remains the authoritative boundary.
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
      starts_at = clock_timestamp() + interval '15 seconds',
      ends_at = null
  where id = p_auction_id
  returning *;
end;
$$;

revoke all on function public.activate_auction(uuid)
  from public, anon, authenticated;
grant execute on function public.activate_auction(uuid)
  to service_role;
