-- Pages exactly as a portal sent them to our bot, kept for diagnosis: they show how a portal
-- builds its pages, so adapters can be written and fixed without guessing. Only the newest few
-- are kept (see src/ingest/samples.ts). Visible on /admin/quellen when ADMIN_TOKEN is set.
create table scrape_samples (
  id           bigint generated always as identity primary key,
  source_id    text,                       -- the adapter's source, null for a test fetch by hand
  url          text not null,
  status       integer not null,
  reason       text not null,              -- 'probe', 'probe-script', 'format-error'
  body         text not null,
  truncated    boolean not null default false,
  captured_at  timestamptz not null default now()
);
create index scrape_samples_captured_idx on scrape_samples (captured_at desc);
