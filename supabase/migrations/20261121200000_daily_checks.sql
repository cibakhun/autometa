-- Daily checks: why a listing left the search, how many listings each run checked on their own
-- page, and per source how many active listings were seen or confirmed in the last 24 hours
-- (written after each import round, read by the notice above the search).

-- missed: absent from complete reads of its list; checked: its own page says it is taken down;
-- stale: neither seen nor confirmed for the source's staleAfterDays (not known to be sold).
-- gone_at: when it left. Both null for listings that left before this was recorded.
alter table listings
  add column gone_reason text check (gone_reason in ('missed', 'checked', 'stale')),
  add column gone_at timestamptz;

alter table ingest_runs add column checked integer not null default 0;

alter table sources
  add column active_listings integer,
  add column checked_24h integer,
  add column stats_at timestamptz;
