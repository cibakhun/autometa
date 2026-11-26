-- Damage detection now also reads "beschädigt", "Motorstörung", "Getriebe Problem", "Injektor
-- def.", "Teileverkauf" and "Teileauto". Only intact titles with these words are marked unchecked; the
-- start-up step (backfillDamage) checks them again before the market values are computed.
update listings
   set damage = null
 where damage = '{}'
   and (title ~* 'besch(ä|ae|a)dig'
     or title ~* 'st(ö|oe|o)rung'
     or title ~* 'problem'
     or title ~* 'teile ?(verkauf|auto)'
     or title ~* '(^|[^a-z0-9])def([^a-z0-9]|$)');
