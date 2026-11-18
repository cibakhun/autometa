-- The HU fallback from the first registration now trusts only plausible young cars
-- (src/core/inspection.ts): at least 3,000 EUR and at most 10,000 km per month since the
-- first registration. Clear the dates the first backfill gave to rims, consoles, lease
-- takeovers and mistyped registrations; the next import run keeps them cleared.
update listings
set hu_until = null, hu_basis = null
where hu_basis = 'registration'
  and (
    price_eur < 3000
    or mileage_km > greatest(
      ((extract(year from current_date) - extract(year from first_registration)) * 12
        + extract(month from current_date) - extract(month from first_registration))::int,
      1
    ) * 10000
  );
