import type { Pool } from "pg";
import { DEFAULT_FLIP_SETTINGS, parseFlipSettings, type FlipSettings } from "@/core/flip";
import { findMake, findModel } from "@/core/taxonomy";
import { BODY_TYPE_LABELS, FUEL_LABELS, SELLER_TYPE_LABELS, TRANSMISSION_LABELS } from "@/core/types";
import { formatNumber } from "@/lib/format";
import { CONDITION_LABELS, filtersToQuery, parseFilters, SORT_LABELS, type SearchFilters } from "@/search/filters";
import { countListings, resolveZip } from "@/search/query";

/**
 * Saved searches ("Suchaufträge"): the query string of the search page, kept per profile. The
 * list shows how many vehicles are new or cheaper since it was last opened; the alert job
 * (src/alerts/run.ts) pushes them as they come in.
 */

export const MAX_SAVED_SEARCHES = 50;
export const MAX_NAME_LENGTH = 80;

export class TooManySearchesError extends Error {}

/**
 * The query string a search is saved under: its filters and sort, without page and "seit", and
 * lists (fuel, body, source) in a fixed order, so the same search is saved only once.
 */
export function normalizeSearchQuery(raw: string | URLSearchParams): string {
  const params = typeof raw === "string" ? new URLSearchParams(raw.replace(/^\?/, "")) : raw;
  const filters = parseFilters(params);
  const sorted = <T extends string>(values: readonly T[]) => [...new Set(values)].sort();
  return filtersToQuery(
    { ...filters, fuel: sorted(filters.fuel), body: sorted(filters.body), source: sorted(filters.source) },
    { page: 1, seit: undefined },
  ).replace(/^\?/, "");
}

const nf = (value: number) => formatNumber(value);
const range = (min: number | undefined, max: number | undefined, unit: string, format = nf) => {
  if (min !== undefined && max !== undefined) return min === max ? `${format(min)}${unit}` : `${format(min)}–${format(max)}${unit}`;
  if (min !== undefined) return `ab ${format(min)}${unit}`;
  if (max !== undefined) return `bis ${format(max)}${unit}`;
  return null;
};

/** A short name from the filters: "VW Golf · bis 3.000 € · defekt · 50 km um 10115". */
export function describeSearch(filters: SearchFilters, sourceNames: Record<string, string> = {}): string {
  const make = filters.make ? (findMake(filters.make)?.name ?? filters.make) : null;
  const model = filters.make && filters.model ? (findModel(filters.make, filters.model)?.name ?? filters.model) : null;
  const flipList = filters.zustand === "defekt" && (filters.sort === "flip" || filters.sort === "margin");
  const parts = [
    flipList ? "Flip-Liste" : null,
    [make, model].filter(Boolean).join(" ") || null,
    filters.q ? `„${filters.q}“` : null,
    filters.priceMax === 0 && filters.priceMin === undefined ? "zu verschenken" : range(filters.priceMin, filters.priceMax, " €"),
    filters.kmMax !== undefined ? `bis ${nf(filters.kmMax)} km` : null,
    range(filters.yearMin, filters.yearMax, "", String),
    filters.psMin !== undefined ? `ab ${filters.psMin} PS` : null,
    filters.fuel.length > 0 ? filters.fuel.map((fuel) => FUEL_LABELS[fuel]).join("/") : null,
    filters.body.length > 0 ? filters.body.map((body) => BODY_TYPE_LABELS[body]).join("/") : null,
    filters.transmission ? TRANSMISSION_LABELS[filters.transmission] : null,
    filters.seller ? SELLER_TYPE_LABELS[filters.seller] : null,
    filters.hu ? (filters.hu === "neu" ? "TÜV neu" : `TÜV mind. ${filters.hu} Monate`) : null,
    filters.zustand && !flipList ? CONDITION_LABELS[filters.zustand].split(" (")[0] : null,
    filters.schwierigkeit !== undefined ? `Schwierigkeit bis ${filters.schwierigkeit}` : null,
    filters.margeMin !== undefined ? `Marge ab ${nf(filters.margeMin)} €` : null,
    filters.source.length > 0 ? `nur ${filters.source.map((id) => sourceNames[id] ?? id).join("/")}` : null,
    filters.zip ? `${filters.radius} km um ${filters.zip}` : null,
  ].filter(Boolean);
  const name = parts.length > 0 ? parts.join(" · ") : "Alle Angebote";
  return name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name;
}

/** The sort, when it is not the default, for the list of saved searches. */
export const describeSort = (filters: SearchFilters) => (filters.sort === "newest" ? null : SORT_LABELS[filters.sort]);

export async function sourceNames(pool: Pool): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ id: string; name: string }>("select id, name from sources");
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}

/**
 * New flip settings saved in this browser: the profile's saved searches count and report with
 * them from now on, so a search opened from its card shows what its pushes report.
 */
export async function updateSearchSettings(pool: Pool, profileId: number, settings: FlipSettings): Promise<void> {
  await pool.query("update saved_searches set flip_settings = $2 where profile_id = $1", [profileId, JSON.stringify(settings)]);
}

/**
 * Saves a search for the profile, or updates the flip settings of the same saved search.
 * Returns its id and name and whether it is new.
 */
export async function saveSearch(
  pool: Pool,
  profileId: number,
  rawQuery: string,
  settings: FlipSettings,
): Promise<{ id: number; name: string; created: boolean }> {
  const query = normalizeSearchQuery(rawQuery);
  const existing = await findSavedSearch(pool, profileId, query);
  if (existing) {
    await pool.query("update saved_searches set flip_settings = $2 where id = $1", [existing.id, JSON.stringify(settings)]);
    return { ...existing, created: false };
  }
  const { rows: count } = await pool.query<{ n: number }>("select count(*)::int as n from saved_searches where profile_id = $1", [profileId]);
  if (count[0].n >= MAX_SAVED_SEARCHES) throw new TooManySearchesError(`Höchstens ${MAX_SAVED_SEARCHES} Suchaufträge.`);
  const name = describeSearch(parseFilters(new URLSearchParams(query)), await sourceNames(pool));
  const { rows } = await pool.query<{ id: string; name: string; created: boolean }>(
    `insert into saved_searches (profile_id, name, query, flip_settings) values ($1, $2, $3, $4)
     on conflict (profile_id, query) do update set flip_settings = excluded.flip_settings
     returning id, name, (xmax = 0) as created`,
    [profileId, name, query, JSON.stringify(settings)],
  );
  return { id: Number(rows[0].id), name: rows[0].name, created: rows[0].created };
}

export async function findSavedSearch(pool: Pool, profileId: number | null, query: string): Promise<{ id: number; name: string } | null> {
  if (profileId === null) return null;
  const { rows } = await pool.query<{ id: string; name: string }>(
    "select id, name from saved_searches where profile_id = $1 and query = $2",
    [profileId, normalizeSearchQuery(query)],
  );
  return rows[0] ? { id: Number(rows[0].id), name: rows[0].name } : null;
}

export interface SavedSearch {
  id: number;
  name: string;
  /** The search page's query string, without "?". */
  query: string;
  filters: SearchFilters;
  description: string;
  notify: boolean;
  createdAt: string;
  seenAt: string;
  lastAlertAt: string | null;
  lastAlertCount: number | null;
  /** Matching vehicles now, and how many of them are new or cheaper since seenAt. */
  total: number;
  fresh: number;
}

/** The profile's saved searches with live counts, newest first. */
export async function listSavedSearches(pool: Pool, profileId: number): Promise<SavedSearch[]> {
  const [{ rows }, names] = await Promise.all([
    pool.query(
      `select id, name, query, flip_settings, notify, created_at, seen_at, last_alert_at, last_alert_count
         from saved_searches where profile_id = $1 order by created_at desc, id desc`,
      [profileId],
    ),
    sourceNames(pool),
  ]);
  return Promise.all(
    rows.map(async (row): Promise<SavedSearch> => {
      const filters = parseFilters(new URLSearchParams(row.query));
      const settings = parseFlipSettings(row.flip_settings ?? DEFAULT_FLIP_SETTINGS);
      const origin = filters.zip ? await resolveZip(pool, filters.zip) : null;
      const seenAt = new Date(row.seen_at).toISOString();
      const [total, fresh] = await Promise.all([
        countListings(pool, filters, origin, settings),
        countListings(pool, { ...filters, seit: seenAt }, origin, settings),
      ]);
      return {
        id: Number(row.id),
        name: row.name,
        query: row.query,
        filters,
        description: describeSearch(filters, names),
        notify: row.notify,
        createdAt: new Date(row.created_at).toISOString(),
        seenAt,
        lastAlertAt: row.last_alert_at ? new Date(row.last_alert_at).toISOString() : null,
        lastAlertCount: row.last_alert_count,
        total,
        fresh,
      };
    }),
  );
}

export async function renameSearch(pool: Pool, profileId: number, id: number, name: string): Promise<void> {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  if (!clean) return;
  await pool.query("update saved_searches set name = $3 where id = $1 and profile_id = $2", [id, profileId, clean]);
}

/** Pushes on or off; switched on, only what comes in from now on is reported. */
export async function setSearchNotify(pool: Pool, profileId: number, id: number, notify: boolean): Promise<void> {
  await pool.query(
    `update saved_searches set notify = $3, alerts_from = case when $3 and not notify then now() else alerts_from end
      where id = $1 and profile_id = $2`,
    [id, profileId, notify],
  );
}

export async function deleteSearch(pool: Pool, profileId: number, id: number): Promise<void> {
  await pool.query("delete from saved_searches where id = $1 and profile_id = $2", [id, profileId]);
}

/**
 * Opens what a saved search found since it was last opened (or since `from`, if earlier, for the
 * link in a push) and marks it as seen. Returns the search page URL, or null for someone else's search.
 */
export async function openNewOfSearch(pool: Pool, profileId: number, id: number, from?: string | null): Promise<string | null> {
  const { rows } = await pool.query<{ query: string; seen_at: Date }>(
    `update saved_searches s set seen_at = now()
       from (select id, seen_at from saved_searches where id = $1 and profile_id = $2 for update) old
      where s.id = old.id
      returning s.query, old.seen_at`,
    [id, profileId],
  );
  if (!rows[0]) return null;
  let since = new Date(rows[0].seen_at);
  const fromDate = from ? new Date(from) : null;
  if (fromDate && !Number.isNaN(fromDate.getTime()) && fromDate < since) since = fromDate;
  const params = new URLSearchParams(rows[0].query);
  params.set("seit", since.toISOString());
  return `/?${params}`;
}
