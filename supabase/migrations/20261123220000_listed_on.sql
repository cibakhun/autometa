-- The day the portal itself says a listing was put online, where its own page shows it
-- (Kleinanzeigen, read during the daily check). Null when unknown; then the listing's age is only
-- known from first_seen_at, the first time AutoMeta saw it.
alter table listings add column listed_on date;
