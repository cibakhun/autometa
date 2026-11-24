-- Some portals give only the year of first registration (Autohero, most of Quoka, a part of
-- auto.de); first_registration is then January of that year. Duplicate detection compares such a
-- listing by year only, and the pages show only the year. With a constant default the column is
-- added without rewriting the table, so the exclusive lock lasts milliseconds.
alter table listings add column first_registration_year_only boolean not null default false;
