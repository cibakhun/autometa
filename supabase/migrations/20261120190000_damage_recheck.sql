-- Damage detection now ignores "rost frei"/"unfall frei" and keeps a negation inside its own
-- phrase ("ohne TÜV Motorschaden" is engine damage). Listings imported again get the new
-- result on their next sighting; marking all as unchecked lets the start-up step
-- (backfillDamage) check the rest, before the market values are computed.
update listings set damage = null;
