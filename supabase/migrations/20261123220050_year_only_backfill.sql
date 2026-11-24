-- Listings stored before first_registration_year_only: for these portals a January may be a bare
-- year. Every listing is corrected on its next sighting, so a real January is wrong for a day at
-- most. A file of its own, so the column change before it is committed first: this update takes
-- only row locks (1 to 5 s for 24,000 rows with all indexes of listings), reads go on.
update listings set first_registration_year_only = true
 where source_id in ('autohero', 'quoka', 'autode')
   and first_registration is not null
   and extract(month from first_registration) = 1;
