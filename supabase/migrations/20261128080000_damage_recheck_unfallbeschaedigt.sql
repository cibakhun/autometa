-- Damage detection now also reads harm spelt as one word with the place ("Unfallbeschädigt",
-- "Frontbeschädigung", "hagelbeschädigt") and "ae" for "ä" ("beschaedigt", "Schaeden", "Maengel",
-- "Stoerung"). Only intact titles with these words are marked unchecked; the start-up step
-- (backfillDamage) checks them again before the market values are computed.
update listings
   set damage = null
 where damage = '{}'
   and (title ~* '(unfall|front|heck|seiten|total|karosserie|blech|hagel|wasser|flut)(besch|gesch)(ä|Ä|a)dig'
     or title ~* '(beschaedig|geschaedig|schaeden|maengel|stoerung)');
