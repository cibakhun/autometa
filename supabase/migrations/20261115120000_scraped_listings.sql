-- Real listings from scraped portals.

-- Some portals do not say whether a seller is a dealer or a private person on their result
-- lists. Unknown is better than a wrong guess.
alter table listings alter column seller_type drop not null;

-- The part of a portal's inventory (for example "Volkswagen, 5.000-5.999 EUR") in which a
-- listing was last seen. When a scraper reads such a part completely, listings of that part
-- it did not see count as missed, exactly like listings missing from a full snapshot.
alter table listings add column segment text;
create index listings_active_segment_idx on listings (source_id, segment) where status = 'active';

-- Listings of the same vehicle on several portals share a cluster id (the smallest listing id
-- of the group). Null means the listing has no known duplicate.
alter table listings add column cluster_id bigint;
create index listings_cluster_idx on listings (cluster_id) where cluster_id is not null;
-- Candidate pairs for duplicate detection are looked up by these facts.
create index listings_active_vehicle_idx on listings (make_slug, model_slug, first_registration) where status = 'active';
create index listings_active_source_idx on listings (source_id) where status = 'active';

-- Crawl plan and progress per portal: which parts of the inventory exist and when each was last
-- read completely. Adapters split a part that is too large to read through its result pages.
create table crawl_segments (
  source_id         text not null references sources (id) on delete cascade,
  key               text not null,
  params            jsonb not null,
  retired           boolean not null default false,  -- replaced by smaller parts
  last_total        integer,                         -- result count the portal reported
  last_started_at   timestamptz,
  last_completed_at timestamptz,
  primary key (source_id, key)
);
