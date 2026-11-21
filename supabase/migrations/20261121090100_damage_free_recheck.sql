-- A "frei" after a damage word now counts only within its phrase: "Rost, frei ab sofort" is rust.
-- Only titles with "frei" as a word of its own can change; the start-up step (backfillDamage)
-- checks them again before market values and repair estimates are computed.
update listings set damage = null where title ~* '\mfrei\M';
