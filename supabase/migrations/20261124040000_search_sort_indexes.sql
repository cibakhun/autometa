-- The search's sort orders as indexes over the active listings, each with the id as the final
-- tie-break like the ORDER BY in src/search/query.ts. The search then reads a page of results in
-- index order and stops after it, instead of sorting every matching listing.
--
-- Building them blocks writes to listings (not reads), about a second per index for 850,000
-- listings. The replaced indexes are dropped at the end, so their exclusive locks are held only
-- for a moment before the commit.
create index listings_active_newest_idx on listings (first_seen_at desc, id desc) where status = 'active';
create index listings_active_price_id_idx on listings (price_eur, id) where status = 'active';
create index listings_active_km_idx on listings (mileage_km, id) where status = 'active';
create index listings_active_year_idx on listings (first_registration desc nulls last, id desc) where status = 'active';
-- "Am weitesten unter Marktwert": the same expression as the sort.
create index listings_active_below_market_idx on listings ((market_price_eur - price_eur) desc nulls last, id desc)
 where status = 'active';
-- Serves both the sort "Zuletzt im Preis gesenkt" and the filter "Preis gesenkt".
create index listings_active_price_drop_sort_idx on listings (price_dropped_at desc nulls last, id desc) where status = 'active';

drop index listings_active_first_seen_idx;
drop index listings_active_price_idx;
drop index listings_active_price_drop_idx;
