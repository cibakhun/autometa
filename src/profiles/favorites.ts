import type { Pool } from "pg";
import { DEFAULT_FLIP_SETTINGS, type FlipSettings } from "@/core/flip";
import { getOffers, summaryColumns, summaryFromRow, type ListingSummary } from "@/search/query";

/** The watch list ("Merkliste"): listings a person keeps an eye on, with their price when saved. */

export const MAX_FAVORITES = 500;

export class TooManyError extends Error {}

/** Adds or removes a listing; returns whether it is on the list afterwards. */
export async function setFavorite(pool: Pool, profileId: number, listingId: number, saved: boolean): Promise<boolean> {
  if (!saved) {
    await pool.query("delete from favorites where profile_id = $1 and listing_id = $2", [profileId, listingId]);
    return false;
  }
  const { rows: count } = await pool.query<{ n: number }>("select count(*)::int as n from favorites where profile_id = $1", [profileId]);
  if (count[0].n >= MAX_FAVORITES) throw new TooManyError(`Die Merkliste fasst höchstens ${MAX_FAVORITES} Autos.`);
  const { rowCount } = await pool.query(
    `insert into favorites (profile_id, listing_id, saved_price_eur, notified_price_eur, notified_gone)
     select $1, l.id, l.price_eur, l.price_eur, l.status = 'gone' from listings l where l.id = $2
     on conflict (profile_id, listing_id) do nothing`,
    [profileId, listingId],
  );
  if (rowCount) return true;
  const { rows } = await pool.query("select 1 from favorites where profile_id = $1 and listing_id = $2", [profileId, listingId]);
  return rows.length > 0;
}

/** Which of these listings are on the profile's list. */
export async function favoriteIds(pool: Pool, profileId: number | null, listingIds: number[]): Promise<Set<number>> {
  if (profileId === null || listingIds.length === 0) return new Set();
  const { rows } = await pool.query<{ listing_id: string }>(
    "select listing_id from favorites where profile_id = $1 and listing_id = any($2::int8[])",
    [profileId, listingIds],
  );
  return new Set(rows.map((row) => Number(row.listing_id)));
}

export interface WatchedListing extends ListingSummary {
  status: "active" | "gone";
  goneReason: "missed" | "checked" | "stale" | null;
  goneAt: string | null;
  savedPriceEur: number;
  savedAt: string;
}

/** The profile's list: listings still online first, most recently saved first. */
export async function getFavorites(pool: Pool, profileId: number, settings: FlipSettings = DEFAULT_FLIP_SETTINGS): Promise<WatchedListing[]> {
  const { rows } = await pool.query(
    `select ${summaryColumns()}, l.status, l.gone_reason, l.gone_at, f.saved_price_eur, f.created_at as saved_at
       from favorites f
       join listings l on l.id = f.listing_id
       join sources s on s.id = l.source_id
      where f.profile_id = $1
      order by (l.status = 'active') desc, f.created_at desc, l.id desc`,
    [profileId],
  );
  const offers = await getOffers(
    pool,
    rows.filter((row) => row.cluster_id !== null).map((row) => Number(row.cluster_id)),
  );
  return rows.map((row) => ({
    ...summaryFromRow(row, offers, settings),
    status: row.status,
    goneReason: row.status === "gone" ? (row.gone_reason ?? null) : null,
    goneAt: row.gone_at ? new Date(row.gone_at).toISOString() : null,
    savedPriceEur: row.saved_price_eur,
    savedAt: new Date(row.saved_at).toISOString(),
  }));
}

export async function countFavorites(pool: Pool, profileId: number | null): Promise<number> {
  if (profileId === null) return 0;
  const { rows } = await pool.query<{ n: number }>("select count(*)::int as n from favorites where profile_id = $1", [profileId]);
  return rows[0].n;
}
