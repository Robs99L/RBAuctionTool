-- Optional preview data. Run only when you want a sample upcoming auction.
insert into public.auctions (
  title,
  description,
  image_url,
  starting_price,
  minimum_increment,
  currency,
  status
) values (
  'Hand-thrown stoneware vase',
  'A one-of-a-kind studio piece with a satin glaze, signed and dated by the artist.',
  'https://images.unsplash.com/photo-1610701596007-11502861dcfa?auto=format&fit=crop&w=1400&q=85',
  80,
  5,
  'EUR',
  'upcoming'
);
