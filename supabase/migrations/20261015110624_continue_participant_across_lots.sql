-- Let an authenticated browser recover its auction-wide display identity.
-- The participant row itself remains scoped to a lot so bids and participant
-- counts keep their existing per-lot semantics.
create or replace function public.get_my_auction_identity()
returns table (
  username text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.username
  from public.participants as p
  where p.user_id = (select auth.uid())
  order by p.created_at desc, p.id
  limit 1;
$$;

comment on function public.get_my_auction_identity() is
  'Returns the authenticated participant display name most recently used in this auction queue.';

revoke all on function public.get_my_auction_identity() from public, anon, authenticated;
grant execute on function public.get_my_auction_identity() to authenticated;
