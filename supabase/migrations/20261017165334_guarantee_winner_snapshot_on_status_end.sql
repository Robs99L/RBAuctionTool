-- Keep winner persistence as a database invariant. It also covers older
-- application versions or administrative SQL that updates the status directly.

create function private.persist_winners_on_auction_end()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.persist_auction_winners(new.id);
  return new;
end;
$$;

revoke all on function private.persist_winners_on_auction_end()
  from public, anon, authenticated;

create trigger auctions_persist_winners_before_end
before update of status on public.auctions
for each row
when (old.status is distinct from new.status and new.status = 'ended')
execute function private.persist_winners_on_auction_end();

comment on function private.persist_winners_on_auction_end() is
  'Creates the immutable winner snapshot before an auction event changes to ended.';
