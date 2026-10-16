-- Store an independently configurable display-timer duration for each lot.
-- Reaching zero remains informational and never ends bidding automatically.

alter table public.auctions
  add column timer_duration_seconds integer not null default 120;

alter table public.auctions
  add constraint auctions_timer_duration_seconds_valid
  check (timer_duration_seconds between 30 and 86400);

comment on column public.auctions.timer_duration_seconds is
  'Configured display timer duration in seconds. Reaching zero does not end bidding.';
