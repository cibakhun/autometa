-- The HU fallback from the first registration now trusts only plausible young cars
-- (src/core/inspection.ts): registered no later than the month the listing was seen, at least
-- 3,000 EUR and at most 10,000 km per month since the first registration. Clear the dates the
-- first backfill gave to rims, consoles, lease takeovers and mistyped registrations. A later
-- import leaves the date empty only while the listing still fails these checks (a registration
-- typed as next May qualifies once next May comes). Like the detector, this judges each row by
-- the month it was last seen.
update listings
set hu_until = null, hu_basis = null
where hu_basis = 'registration'
  and (
    price_eur < 3000
    or first_registration > date_trunc('month', last_seen_at at time zone 'UTC')::date
    or mileage_km > greatest(
      ((extract(year from last_seen_at at time zone 'UTC') - extract(year from first_registration)) * 12
        + extract(month from last_seen_at at time zone 'UTC') - extract(month from first_registration))::int,
      1
    ) * 10000
  );
