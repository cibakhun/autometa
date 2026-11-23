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
