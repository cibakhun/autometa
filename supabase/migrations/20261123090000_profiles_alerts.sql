-- Saved searches, a watch list and push notifications, without accounts.
--
-- A profile is a person's lists; each browser that uses it holds its own random token in a cookie
-- (only the SHA-256 hash is stored here). A second device joins a profile with a short code.

create table profiles (
  id           bigint generated always as identity primary key,
  -- No pushes between 22:00 and 7:00 German time; what comes in at night arrives at 7:00.
  quiet_nights boolean not null default true,
  created_at   timestamptz not null default now()
);

create table profile_devices (
  id           bigint generated always as identity primary key,
  token_hash   bytea not null unique,
  profile_id   bigint not null references profiles (id) on delete cascade,
  -- Browser and system, shortened, so a person can tell their devices apart. Nothing else.
  label        text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index profile_devices_profile_idx on profile_devices (profile_id);

-- Codes to use a profile on another device: valid for 30 minutes, used once.
create table profile_link_codes (
  code_hash  bytea primary key,
  profile_id bigint not null references profiles (id) on delete cascade,
  expires_at timestamptz not null
);

-- The watch list. notified_* hold what the last push said (or the state when saved), so each
-- price drop and the listing going offline are reported once.
create table favorites (
  profile_id         bigint not null references profiles (id) on delete cascade,
  listing_id         bigint not null references listings (id) on delete cascade,
  saved_price_eur    integer not null,
  notified_price_eur integer not null,
  notified_gone      boolean not null default false,
  created_at         timestamptz not null default now(),
  primary key (profile_id, listing_id)
);

create index favorites_listing_idx on favorites (listing_id);

-- A saved search is the query string of the search page (without page), plus the flip settings
-- it was saved with, because the margin filter and the flip sorts depend on them.
create table saved_searches (
  id             bigint generated always as identity primary key,
  profile_id     bigint not null references profiles (id) on delete cascade,
  name           text not null,
  query          text not null,
  flip_settings  jsonb not null,
  notify         boolean not null default true,
  created_at     timestamptz not null default now(),
  -- When its new listings were last opened; "neu" on the list counts from here.
  seen_at        timestamptz not null default now(),
  -- Pushes report only listings new or cheaper after this (set when saving, switching
  -- notifications on, or adding the profile's first device for pushes).
  alerts_from    timestamptz not null default now(),
  last_alert_at  timestamptz,
  last_alert_count integer,
  unique (profile_id, query)
);

-- Listings a saved search already reported, so the next push names only new ones. Kept for a few
-- days, longer than the window a push looks back.
create table saved_search_hits (
  search_id  bigint not null references saved_searches (id) on delete cascade,
  listing_id bigint not null references listings (id) on delete cascade,
  alerted_at timestamptz not null default now(),
  primary key (search_id, listing_id)
);

create index saved_search_hits_alerted_idx on saved_search_hits (alerted_at);

-- Browsers that receive pushes (Web Push: the push service's endpoint and the browser's keys).
create table push_subscriptions (
  id           bigint generated always as identity primary key,
  profile_id   bigint not null references profiles (id) on delete cascade,
  -- The device that subscribed; removing the device ends its pushes.
  device_id    bigint references profile_devices (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz,
  failures     integer not null default 0
);

create index push_subscriptions_profile_idx on push_subscriptions (profile_id);

-- Keys the app makes for itself once, e.g. the VAPID key pair for Web Push.
create table app_keys (
  name       text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);

-- When the price last went down and what it was before, for "Preis gesenkt" and price-drop alerts.
-- Cleared again when the price goes up.
alter table listings
  add column price_dropped_at timestamptz,
  add column price_before_drop_eur integer;

create function track_price_drop() returns trigger language plpgsql as $$
begin
  if new.price_eur < old.price_eur then
    new.price_dropped_at := clock_timestamp();
    new.price_before_drop_eur := old.price_eur;
  elsif new.price_eur > old.price_eur then
    new.price_dropped_at := null;
    new.price_before_drop_eur := null;
  end if;
  return new;
end;
$$;

create trigger listings_track_price_drop
  before update of price_eur on listings
  for each row execute function track_price_drop();

-- Listings whose last price change in the history was a drop.
update listings l
   set price_dropped_at = p.seen_at, price_before_drop_eur = p.previous_eur
  from (
    select listing_id, seen_at, price_eur,
           lag(price_eur) over (partition by listing_id order by seen_at) as previous_eur,
           row_number() over (partition by listing_id order by seen_at desc) as newest
      from listing_prices
  ) p
 where p.listing_id = l.id and p.newest = 1 and p.previous_eur > p.price_eur and l.price_eur = p.price_eur;

create index listings_active_price_drop_idx on listings (price_dropped_at) where status = 'active' and price_dropped_at is not null;
