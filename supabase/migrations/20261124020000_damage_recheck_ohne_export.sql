-- Damage detection now reads "oh. Schäden" and "o Unfall" as "ohne" and no longer takes the
-- customs document "Export T1" of a dealer exporting a new car for a parts car. Only titles
-- with these words are marked unchecked; the start-up step (backfillDamage) checks them again
-- before the market values and repair estimates are computed.
update listings
   set damage = null
 where cardinality(damage) > 0
   -- Bounded like normalizeText: anything but a letter or digit, so "EXPORT_T1_READY" counts too.
   -- "o"/"oh" with or without the dot ("o Unfall", "oh.Schäden"), as the detector reads them.
   and (title ~* '(^|[^a-z0-9])export[^a-z0-9]*t[12]([^a-z0-9]|$)' or title ~* '(^|[^a-z0-9])oh?([^a-z0-9]|$)');
