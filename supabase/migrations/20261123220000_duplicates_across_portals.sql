-- Some portals give only the year of first registration (Autohero, most of Quoka, a part of
-- auto.de); first_registration is then January of that year. Duplicate detection compares such a
-- listing by year only, and the pages show only the year.
alter table listings add column first_registration_year_only boolean not null default false;

-- Listings stored before this column: for these portals a January may be a bare year. Every
-- listing is corrected on its next sighting, so a real January is wrong for a day at most.
update listings set first_registration_year_only = true
 where source_id in ('autohero', 'quoka', 'autode')
   and first_registration is not null
   and extract(month from first_registration) = 1;

-- Candidate pairs are looked up by make, model and registration, then by mileage. With the
-- mileage in the index, a lookup reads only the listings in the mileage window instead of every
-- listing of that model and month or year. It replaces the index without the mileage.
create index listings_active_vehicle_km_idx on listings (make_slug, model_slug, first_registration, mileage_km)
 where status = 'active';
drop index listings_active_vehicle_idx;
