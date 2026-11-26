-- Schnäppchen (src/core/deal.ts): how far a listing's market value can be trusted, and how many
-- percent below it an intact listing is offered when that comparison holds. Both are written
-- with the market values (src/ingest/market.ts), so the first start after this migration fills
-- them for every active listing.
--
-- market_confidence: 'high', 'medium' or 'low' (few comparable listings or a wide price range);
-- null without a market value.
-- deal_pct: percent below the market value (negative: above); null when damage is named, the
-- market value is unsure, or the price is too far below it to be a real offer.
alter table listings add column market_confidence text
  constraint listings_market_confidence_check check (market_confidence in ('high', 'medium', 'low'));
alter table listings add column deal_pct integer;

-- "Bestes Schnäppchen" sorts by deal_pct; the old order by the gap in euros goes.
create index listings_active_deal_idx on listings (deal_pct desc nulls last, id desc) where status = 'active';
drop index listings_active_below_market_idx;
