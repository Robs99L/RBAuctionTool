-- Donation totals contain only one highest bid per winning participant.
-- The winner ranking matches the application: amount descending, then the
-- earliest bid and stable ID for deterministic ties.

create index bids_auction_participant_ranking_idx
  on public.bids (
    auction_id,
    participant_id,
    amount desc,
    created_at,
    id
  );

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
      b.id,
      b.auction_id,
      b.participant_id,
      b.amount,
      b.created_at,
      row_number() over (
        partition by b.auction_id, b.participant_id
        order by b.amount desc, b.created_at, b.id
      ) as participant_rank
    from public.bids b
  ),
  ranked_winners as (
    select
      h.id,
      h.auction_id,
      h.amount,
      row_number() over (
        partition by h.auction_id
        order by h.amount desc, h.created_at, h.id
      ) as winner_rank
    from highest_by_participant h
    where h.participant_rank = 1
  )
  select
    a.id,
    a.title,
    a.currency,
    a.sort_order,
    count(w.id),
    coalesce(sum(w.amount), 0::numeric)
  from public.auctions a
  left join ranked_winners w
    on w.auction_id = a.id
   and w.winner_rank <= a.winner_count
  group by a.id, a.title, a.currency, a.sort_order
  order by a.sort_order, a.id;
$$;

comment on function public.get_auction_donation_totals() is
  'Returns the sum and count of one highest bid per winning participant for each auction lot.';
