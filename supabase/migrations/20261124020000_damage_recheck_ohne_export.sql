-- Damage detection now reads "oh. Schäden" and "o. Unfall" as "ohne" and no longer takes the
-- customs document "Export T1" of a dealer exporting a new car for a parts car. Only titles
-- with these words are marked unchecked; the start-up step (backfillDamage) checks them again
-- before the market values and repair estimates are computed.
update listings
   set damage = null
 where cardinality(damage) > 0
   and (title ~* '\mexport[^a-z0-9]*t[12]\M' or title ~* '\mo(h)?\.');
