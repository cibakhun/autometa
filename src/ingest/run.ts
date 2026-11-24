import type { Pool, PoolClient } from "pg";
import { detectDamage, type DamageKind } from "@/core/damage";
import { detectInspection, type Inspection } from "@/core/inspection";
import { cleanCity } from "@/core/places";
import type { NormalizedListing } from "@/core/types";
import type { CheckResult, RawListing, SourceAdapter } from "./adapter";
import { BlockedError } from "./http/fetcher";

const BATCH_SIZE = 500;
/** A listing missing from this many full reads (of the source or of its segment) in a row counts as sold. */
export const MISSED_RUNS_UNTIL_GONE = 2;
/** Listings neither seen nor checked for this many hours are due for a check on their own page, where the adapter can. */
export const CHECK_AFTER_HOURS = 20;
/** More than one run can check; the longest unchecked come first. */
const MAX_DUE = 5000;
const CHECK_BATCH = 50;

export interface IngestResult {
  runId: number;
  fetched: number;
  upserted: number;
  skipped: number;
  gone: number;
  /** Listings checked on their own page. */
  checked: number;
}

/** Another import of the same source is still running. */
export class IngestBusyError extends Error {
  constructor(readonly sourceId: string) {
    super(`An import of "${sourceId}" is already running`);
    this.name = "IngestBusyError";
  }
}

const LISTING_COLUMNS = [
  "source_id",
  "external_id",
  "url",
  "title",
  "make_slug",
  "model_slug",
  "make_raw",
  "model_raw",
  "variant",
  "price_eur",
  "mileage_km",
  "first_registration",
  "first_registration_year_only",
  "fuel",
  "transmission",
  "power_kw",
  "body_type",
  "color",
  "seller_type",
  "seller_name",
  "zip",
  "city",
  "lat",
  "lng",
  "image_url",
  "hu_until",
  "hu_basis",
  "damage",
  "segment",
] as const;

/** Columns that are not simply overwritten by a new sighting. */
const UPDATE_RULES: Partial<Record<(typeof LISTING_COLUMNS)[number], string>> = {
  // A sighting without a photo keeps the one seen before.
  image_url: "image_url = coalesce(excluded.image_url, listings.image_url)",
  // "TÜV neu" counts from the first sighting, not from every later one.
  hu_until: `hu_until = case when excluded.hu_basis = 'relative' and listings.hu_basis = 'relative'
                             then least(excluded.hu_until, listings.hu_until) else excluded.hu_until end`,
};

interface PendingListing {
  listing: NormalizedListing;
  segment: string | null;
  /** HU/TÜV validity derived from the title and first registration when the listing was seen. */
  inspection: Inspection | null;
  /** Damage kinds the title mentions. */
  damage: DamageKind[];
}

function listingValues({ listing: l, segment, inspection, damage }: PendingListing): unknown[] {
  return [
    l.sourceId,
    l.externalId,
    l.url,
    l.title,
    l.makeSlug,
    l.modelSlug,
    l.makeRaw,
    l.modelRaw,
    l.variant,
    l.priceEur,
    l.mileageKm,
    l.firstRegistration,
    l.firstRegistration !== null && l.firstRegistrationYearOnly === true,
    l.fuel,
    l.transmission,
    l.powerKw,
    l.bodyType,
    l.color,
    l.sellerType,
    l.sellerType === "dealer" ? l.sellerName : null,
    l.zip,
    l.city,
    l.lat,
    l.lng,
    l.imageUrl ?? null,
    inspection?.until ?? null,
    inspection?.basis ?? null,
    damage,
    segment,
  ];
}

function placeholders(rowCount: number, columnCount: number): string {
  const rows: string[] = [];
  for (let r = 0; r < rowCount; r += 1) {
    const cells: string[] = [];
    for (let c = 0; c < columnCount; c += 1) cells.push(`$${r * columnCount + c + 1}`);
    rows.push(`(${cells.join(", ")})`);
  }
  return rows.join(",\n");
}

/** Keeps the last occurrence per external id: Postgres rejects one upsert touching a row twice. */
function lastPerId<T>(items: T[], id: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [id(item), item])).values()];
}

/**
 * Like lastPerId, but a sighting without a segment keeps the segment of an earlier sighting in the
 * same batch, as long as price and make (the facts segments are cut by) did not change in between.
 * The upsert applies the same rule against the stored row.
 */
function mergePending(pending: PendingListing[]): PendingListing[] {
  const byId = new Map<string, PendingListing>();
  for (const item of pending) {
    const previous = byId.get(item.listing.externalId);
    const carried = previous && sameSegmentFacts(previous.listing, item.listing) ? previous.segment : null;
    byId.set(item.listing.externalId, { ...item, segment: item.segment ?? carried });
  }
  return [...byId.values()];
}

function sameSegmentFacts(a: NormalizedListing, b: NormalizedListing): boolean {
  return a.priceEur === b.priceEur && a.makeSlug === b.makeSlug;
}

/**
 * Writes one batch in a transaction: stores the listings and takes the ones normalize now leaves
 * out (`rejected`, e.g. an ad found to be a dealer buying up cars) out of the search as filtered,
 * like the review of stored listings does (src/ingest/review.ts). Returns how many listings it
 * stored and how many it took out.
 */
async function writeBatch(client: PoolClient, sourceId: string, raws: RawListing[], pending: PendingListing[], rejected: string[] = []) {
  raws = lastPerId(raws, (raw) => raw.externalId);
  // A listing left out at its last sighting stays out, even if an earlier one in the batch was kept.
  const out = new Set(rejected);
  pending = mergePending(pending).filter((item) => !out.has(item.listing.externalId));
  let filtered = 0;
  await client.query("begin");
  try {
    if (rejected.length > 0) {
      const gone = await client.query(
        `update listings set status = 'gone', gone_reason = 'filtered', gone_at = now()
          where source_id = $1 and external_id = any($2::text[]) and status = 'active'`,
        [sourceId, rejected],
      );
      filtered = gone.rowCount ?? 0;
    }
    if (raws.length > 0) {
      const values = raws.flatMap((raw) => [sourceId, raw.externalId, JSON.stringify(raw.payload)]);
      await client.query(
        `insert into raw_listings (source_id, external_id, payload)
         values ${placeholders(raws.length, 3)}
         on conflict (source_id, external_id)
         do update set payload = excluded.payload, fetched_at = now()`,
        values,
      );
    }
    if (pending.length > 0) {
      const updates = LISTING_COLUMNS.filter((c) => c !== "source_id" && c !== "external_id" && c !== "segment")
        .map((c) => UPDATE_RULES[c] ?? `${c} = excluded.${c}`)
        .join(", ");
      await client.query(
        `insert into listings (${LISTING_COLUMNS.join(", ")})
         values ${placeholders(pending.length, LISTING_COLUMNS.length)}
         on conflict (source_id, external_id)
         do update set ${updates},
                       segment = case
                         when excluded.segment is not null then excluded.segment
                         -- Seen outside a segment (e.g. in the newest list): keep the old one only
                         -- while the facts a segment is cut by are the same.
                         when excluded.price_eur is not distinct from listings.price_eur
                          and excluded.make_slug is not distinct from listings.make_slug then listings.segment
                       end,
                       status = 'active', gone_reason = null, gone_at = null, missed_runs = 0, last_seen_at = now()`,
        pending.flatMap(listingValues),
      );
    }
    await client.query("commit");
    return { upserted: pending.length, filtered };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

/**
 * Fetches everything from one source, normalizes it and stores it. Only one import per source
 * runs at a time; a second one fails with IngestBusyError. What was fetched before an error is
 * kept, but nothing is marked as sold after an error.
 */
export async function runIngest(pool: Pool, adapter: SourceAdapter): Promise<IngestResult> {
  const { source } = adapter;
  const client = await pool.connect();
  try {
    // Session lock on this connection, released below, so overlapping runs cannot interleave.
    const lock = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext($1)) as locked", [
      `autometa-ingest:${source.id}`,
    ]);
    if (!lock.rows[0].locked) throw new IngestBusyError(source.id);
    try {
      return await ingestLocked(client, adapter);
    } finally {
      await client.query("select pg_advisory_unlock(hashtext($1))", [`autometa-ingest:${source.id}`]);
    }
  } finally {
    client.release();
  }
}

async function ingestLocked(client: PoolClient, adapter: SourceAdapter): Promise<IngestResult> {
  const { source } = adapter;
  await client.query(
    `insert into sources (id, name, kind, website_url) values ($1, $2, $3, $4)
     on conflict (id) do update set name = excluded.name, kind = excluded.kind, website_url = excluded.website_url`,
    [source.id, source.name, source.kind, source.websiteUrl],
  );

  const run = await client.query<{ id: string; started_at: Date }>(
    "insert into ingest_runs (source_id) values ($1) returning id, started_at",
    [source.id],
  );
  const runId = Number(run.rows[0].id);
  const startedAt = run.rows[0].started_at;

  const postal = await client.query<{ zip: string; city: string; lat: number; lng: number }>("select zip, city, lat, lng from postal_codes");
  const places = new Map(postal.rows.map((row) => [row.zip, row]));

  const result: IngestResult = { runId, fetched: 0, upserted: 0, skipped: 0, gone: 0, checked: 0 };
  let raws: RawListing[] = [];
  let pending: PendingListing[] = [];
  // Per listing of the batch, whether its last sighting was left out by normalize.
  let leftOut = new Map<string, boolean>();
  const flush = async () => {
    const rejected = [...leftOut].filter(([, out]) => out).map(([id]) => id);
    const written = await writeBatch(client, source.id, raws, pending, rejected);
    result.upserted += written.upserted;
    result.gone += written.filtered;
    raws = [];
    pending = [];
    leftOut = new Map();
  };

  try {
    try {
      for await (const raw of adapter.fetch({ db: client })) {
        result.fetched += 1;
        raws.push(raw);
        const listing = adapter.normalize(raw);
        leftOut.set(raw.externalId, !listing);
        if (!listing) {
          result.skipped += 1;
        } else {
          const place = listing.zip ? places.get(listing.zip) : undefined;
          if (listing.lat === null && place) {
            listing.lat = place.lat;
            listing.lng = place.lng;
          }
          listing.city = cleanCity(listing.city, place?.city);
          pending.push({
            listing: { ...listing, sourceId: source.id },
            segment: raw.segment ?? null,
            inspection: detectInspection(listing),
            damage: detectDamage(listing.title),
          });
        }
        if (raws.length >= BATCH_SIZE) await flush();
      }
    } finally {
      // Keep what was fetched before an error, too.
      if (raws.length > 0) await flush();
    }

    let checkError: string | null = null;
    if (adapter.checkListings) {
      try {
        await checkDueListings(client, adapter, result);
      } catch (error) {
        if (!(error instanceof BlockedError)) throw error;
        // The portal refused a listing page. No further request goes out in this run, but what
        // the lists showed still counts, and so do the listings not confirmed for too long.
        checkError = `Einzelprüfung abgebrochen: ${error.message}`;
      }
    }

    if (adapter.fullSnapshot) {
      result.gone += await markMissed(client, source.id, startedAt, null);
    }
    const segments = adapter.completedSegments?.() ?? [];
    if (segments.length > 0) {
      result.gone += await markMissed(client, source.id, startedAt, segments);
    }
    if (adapter.staleAfterDays !== undefined) {
      const stale = await client.query(
        `update listings set status = 'gone', gone_reason = 'stale', gone_at = now()
          where source_id = $1 and status = 'active' and last_seen_at < now() - make_interval(days => $2)`,
        [source.id, adapter.staleAfterDays],
      );
      result.gone += stale.rowCount ?? 0;
    }

    await client.query(
      `update ingest_runs set finished_at = now(), fetched = $2, upserted = $3, skipped = $4, gone = $5, checked = $6, error = $7 where id = $1`,
      [runId, result.fetched, result.upserted, result.skipped, result.gone, result.checked, checkError],
    );
    return result;
  } catch (error) {
    // Never let a failed bookkeeping write hide the original error.
    try {
      await client.query(
        "update ingest_runs set finished_at = now(), fetched = $2, upserted = $3, skipped = $4, gone = $5, checked = $6, error = $7 where id = $1",
        [runId, result.fetched, result.upserted, result.skipped, result.gone, result.checked, error instanceof Error ? error.message : String(error)],
      );
    } catch (logError) {
      console.error("Could not record the failed ingest run:", logError);
    }
    throw error;
  }
}

/**
 * Counts a miss for active listings not seen since the run started, in the whole source
 * (segments = null) or in the given segments. Returns how many became 'gone'.
 */
async function markMissed(client: PoolClient, sourceId: string, startedAt: Date, segments: string[] | null) {
  const missed = await client.query<{ status: string }>(
    `update listings
        set missed_runs = missed_runs + 1,
            status = case when missed_runs + 1 >= $3 then 'gone' else status end,
            gone_reason = case when missed_runs + 1 >= $3 then 'missed' else gone_reason end,
            gone_at = case when missed_runs + 1 >= $3 then now() else gone_at end
      where source_id = $1 and status = 'active' and last_seen_at < $2
        and ($4::text[] is null or segment = any($4::text[]))
      returning status`,
    [sourceId, startedAt, MISSED_RUNS_UNTIL_GONE, segments],
  );
  return missed.rows.filter((row) => row.status === "gone").length;
}

/**
 * Hands the adapter the listings neither seen nor checked for CHECK_AFTER_HOURS, the longest
 * unlooked-at first, and applies what their pages say: online counts as seen now (with the price
 * the page asks, which the price history keeps like a price seen in a list), taken down leaves the
 * search at once, unclear only records the attempt (the listing is due again a day later).
 * Written in small batches, so a run that ends early keeps its checks.
 */
async function checkDueListings(client: PoolClient, adapter: SourceAdapter, totals: IngestResult) {
  const { source } = adapter;
  // greatest() skips a null checked_at.
  const due = await client.query<{ external_id: string; url: string; price_eur: number; title: string }>(
    `select external_id, url, price_eur, title from listings
      where source_id = $1 and status = 'active'
        and greatest(last_seen_at, checked_at) < now() - make_interval(hours => $2)
      order by greatest(last_seen_at, checked_at), id
      limit $3`,
    [source.id, CHECK_AFTER_HOURS, MAX_DUE],
  );
  if (due.rows.length === 0) return;

  let batch: CheckResult[] = [];
  const write = async () => {
    totals.checked += batch.length;
    const checks = batch;
    batch = [];
    // An ad online but offering no car (a dealer buying up cars) leaves the search like one the
    // import rules leave out (see src/ingest/review.ts).
    const updated = await client.query<{ outcome: string; not_for_sale: boolean }>(
      `update listings l
          set status = case when v.outcome = 'gone' or v.not_for_sale then 'gone' else l.status end,
              gone_reason = case when v.not_for_sale then 'filtered' when v.outcome = 'gone' then 'checked' else l.gone_reason end,
              gone_at = case when v.outcome = 'gone' or v.not_for_sale then now() else l.gone_at end,
              last_seen_at = case when v.outcome = 'active' then now() else l.last_seen_at end,
              missed_runs = case when v.outcome = 'active' then 0 else l.missed_runs end,
              price_eur = case when v.outcome = 'active' and v.price_eur is not null then v.price_eur else l.price_eur end,
              -- Segments are cut by price, so a new price may belong to another one (see writeBatch).
              segment = case when v.outcome = 'active' and v.price_eur is distinct from l.price_eur and v.price_eur is not null
                             then null else l.segment end,
              -- The earliest day any page named: a later one may be the day it was pushed up again.
              listed_on = case when v.outcome = 'active' then least(l.listed_on, v.listed_on) else l.listed_on end,
              checked_at = now()
         from unnest($2::text[], $3::text[], $4::int[], $5::date[], $6::boolean[])
              as v (external_id, outcome, price_eur, listed_on, not_for_sale)
        where l.source_id = $1 and l.external_id = v.external_id and l.status = 'active'
        returning v.outcome, v.not_for_sale`,
      [
        source.id,
        checks.map((r) => r.externalId),
        checks.map((r) => r.outcome),
        checks.map((r) => r.priceEur ?? null),
        checks.map((r) => r.listedOn ?? null),
        checks.map((r) => r.notForSale === true),
      ],
    );
    totals.gone += updated.rows.filter((row) => row.outcome === "gone" || row.not_for_sale).length;
  };

  try {
    for await (const check of adapter.checkListings!(
      due.rows.map((row) => ({ externalId: row.external_id, url: row.url, priceEur: row.price_eur, title: row.title })),
      { db: client },
    )) {
      batch.push(check);
      if (batch.length >= CHECK_BATCH) await write();
    }
  } finally {
    // Keep the checks made before an error, too.
    if (batch.length > 0) await write();
  }
}
