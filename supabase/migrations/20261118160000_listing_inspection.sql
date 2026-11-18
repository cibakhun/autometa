-- HU/TÜV validity, read from the listing's title ("TÜV 05/2027", "TÜV neu", "HU abgelaufen") or,
-- for cars younger than three years, implied by the first registration (first HU after 36
-- months). See src/core/inspection.ts.
alter table listings add column hu_until date;   -- first day of the last valid month
alter table listings add column hu_basis text check (hu_basis in ('stated', 'relative', 'registration', 'expired'));
create index listings_active_hu_idx on listings (hu_until) where status = 'active';

-- Cars younger than three years get their first-HU date right away; title-based dates follow with
-- the next import that sees the listing.
update listings
   set hu_until = (first_registration + interval '36 months')::date, hu_basis = 'registration'
 where first_registration is not null
   and first_registration + interval '36 months' >= date_trunc('month', current_date);
