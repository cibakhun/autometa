-- filtered: the import rules (src/core/plausibility.ts) leave the listing out (a wanted or swap
-- ad, a placeholder price), but it was stored before the rule existed. The start-up review
-- (src/ingest/review.ts) takes such listings out of the search. They were not sold and are still
-- online, so they count neither for how long cars stay listed (missed, checked) nor as stale.
-- The new check allows more than the old one, so the stored rows need no check under this lock;
-- the next file validates it while reads and writes go on.
alter table listings drop constraint listings_gone_reason_check;
alter table listings add constraint listings_gone_reason_check
  check (gone_reason in ('missed', 'checked', 'stale', 'filtered')) not valid;

-- Which version of the import rules the stored listings were last reviewed against.
create table listing_reviews (
  name        text primary key,
  version     integer not null,
  reviewed_at timestamptz not null default now()
);
