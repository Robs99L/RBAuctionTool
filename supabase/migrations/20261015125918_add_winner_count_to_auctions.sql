-- Configure how many distinct highest bidders win each auction lot.

alter table public.auctions
  add column winner_count integer not null default 1
  constraint auctions_winner_count_valid check (winner_count between 1 and 1000);

comment on column public.auctions.winner_count is
  'Number of distinct highest bidders who win this auction lot.';
