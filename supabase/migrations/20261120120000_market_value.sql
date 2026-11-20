-- Phase 1 of the flip rating: damage hints, market value and price history.

-- Damage kinds the listing's title mentions (src/core/damage.ts), e.g. {engine,not_running}.
-- Empty means none; null means not checked yet (the start-up step fills those in).
alter table listings add column damage text[];

-- What comparable intact listings cost (src/ingest/market.ts): median and middle half of their
-- prices, how many there were, and after how many days such listings usually disappeared.
-- Null when there are too few comparable listings.
alter table listings add column market_price_eur integer;
alter table listings add column market_low_eur integer;
alter table listings add column market_high_eur integer;
alter table listings add column market_comps integer;
alter table listings add column market_days integer;

-- Every price a listing had, with when we first saw it. Filled by a trigger, so every way a
-- listing is written keeps the history.
create table listing_prices (
  listing_id bigint not null references listings (id) on delete cascade,
  price_eur  integer not null,
  seen_at    timestamptz not null,
  primary key (listing_id, seen_at)
);

create function record_listing_price() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.price_eur is distinct from old.price_eur then
    insert into listing_prices (listing_id, price_eur, seen_at)
    values (new.id, new.price_eur, case when tg_op = 'INSERT' then new.first_seen_at else now() end)
    on conflict (listing_id, seen_at) do update set price_eur = excluded.price_eur;
  end if;
  return null;
end;
$$;

create trigger listings_record_price
  after insert or update of price_eur on listings
  for each row execute function record_listing_price();

-- Today's prices are the first entries of the existing listings.
insert into listing_prices (listing_id, price_eur, seen_at)
select id, price_eur, first_seen_at from listings;
