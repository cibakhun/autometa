-- AutoMeta: initial schema.
-- Runs on plain Postgres (local, CI) and on Supabase.

create extension if not exists pg_trgm;

-- One row per marketplace, feed or other origin of listings.
create table sources (
  id          text primary key,              -- e.g. 'demo', 'mobile_de'
  name        text not null,                 -- shown to users, e.g. 'mobile.de'
  kind        text not null check (kind in ('api', 'feed', 'push', 'demo')),
  website_url text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Canonical make/model list every source is mapped onto.
create table makes (
  slug text primary key,                     -- 'volkswagen'
  name text not null                         -- 'Volkswagen'
);

create table models (
  make_slug text not null references makes (slug) on delete cascade,
  slug      text not null,                   -- 'golf'
  name      text not null,                   -- 'Golf'
  primary key (make_slug, slug)
);

-- Postal code centroids for the radius search.
create table postal_codes (
  zip  text primary key,
  city text not null,
  lat  double precision not null,
  lng  double precision not null
);

-- Latest raw payload per listing, kept so we can re-normalize without re-fetching.
create table raw_listings (
  source_id   text not null references sources (id) on delete cascade,
  external_id text not null,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (source_id, external_id)
);

-- One normalized offer per source. Only facts, no photos or description texts.
create table listings (
  id                 bigint generated always as identity primary key,
  source_id          text not null references sources (id) on delete cascade,
  external_id        text not null,
  url                text not null,
  title              text not null,
  make_slug          text references makes (slug),
  model_slug         text,
  make_raw           text not null,
  model_raw          text not null,
  variant            text,
  price_eur          integer not null check (price_eur >= 0),
  mileage_km         integer check (mileage_km >= 0),
  first_registration date,
  fuel               text check (fuel in ('petrol', 'diesel', 'electric', 'hybrid', 'plugin_hybrid', 'lpg', 'cng', 'hydrogen', 'other')),
  transmission       text check (transmission in ('manual', 'automatic')),
  power_kw           integer check (power_kw > 0),
  body_type          text check (body_type in ('small', 'sedan', 'estate', 'suv', 'van', 'coupe', 'convertible', 'other')),
  color              text,
  seller_type        text not null check (seller_type in ('dealer', 'private')),
  seller_name        text,                   -- dealers only, never private persons
  zip                text,
  city               text,
  lat                double precision,
  lng                double precision,
  status             text not null default 'active' check (status in ('active', 'gone')),
  missed_runs        integer not null default 0,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  unique (source_id, external_id),
  foreign key (make_slug, model_slug) references models (make_slug, slug)
);

create index listings_active_price_idx on listings (price_eur) where status = 'active';
create index listings_active_make_model_idx on listings (make_slug, model_slug) where status = 'active';
create index listings_active_first_seen_idx on listings (first_seen_at desc) where status = 'active';
create index listings_active_geo_idx on listings (lat, lng) where status = 'active';
create index listings_title_trgm_idx on listings using gin (title gin_trgm_ops);

-- Every import run, for monitoring freshness.
create table ingest_runs (
  id          bigint generated always as identity primary key,
  source_id   text not null references sources (id) on delete cascade,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  fetched     integer not null default 0,
  upserted    integer not null default 0,
  skipped     integer not null default 0,
  gone        integer not null default 0,
  error       text
);

-- Click-outs to the original listing. No IP addresses or user data.
create table clicks (
  id         bigint generated always as identity primary key,
  listing_id bigint not null references listings (id) on delete cascade,
  clicked_at timestamptz not null default now()
);

create index clicks_listing_idx on clicks (listing_id);
