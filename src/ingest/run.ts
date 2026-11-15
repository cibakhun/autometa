import type { Pool, PoolClient } from "pg";
import type { NormalizedListing } from "@/core/types";
import type { RawListing, SourceAdapter } from "./adapter";

const BATCH_SIZE = 500;
/** A listing missing from this many full reads (of the source or of its segment) in a row counts as sold. */
export const MISSED_RUNS_UNTIL_GONE = 2;

export interface IngestResult {
  runId: number;
  fetched: number;
  upserted: number;
  skipped: number;
  gone: number;
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
  "segment",
] as const;

interface PendingListing {
  listing: NormalizedListing;
  segment: string | null;
}

function listingValues({ listing: l, segment }: PendingListing): unknown[] {
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

/** Like lastPerId, but a listing keeps the segment of any sighting that had one. */
function mergePending(pending: PendingListing[]): PendingListing[] {
  const byId = new Map<string, PendingListing>();
  for (const item of pending) {
    const previous = byId.get(item.listing.externalId);
    byId.set(item.listing.externalId, { ...item, segment: item.segment ?? previous?.segment ?? null });
  }
  return [...byId.values()];
}

/** Writes one batch in a transaction and returns how many listings it stored. */
async function writeBatch(client: PoolClient, sourceId: string, raws: RawListing[], pending: PendingListing[]) {
  raws = lastPerId(raws, (raw) => raw.externalId);
  pending = mergePending(pending);
  await client.query("begin");
  try {
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
        .map((c) => `${c} = excluded.${c}`)
        .join(", ");
      await client.query(
        `insert into listings (${LISTING_COLUMNS.join(", ")})
         values ${placeholders(pending.length, LISTING_COLUMNS.length)}
         on conflict (source_id, external_id)
         do update set ${updates},
                       segment = coalesce(excluded.segment, listings.segment),
                       status = 'active', missed_runs = 0, last_seen_at = now()`,
        pending.flatMap(listingValues),
      );
    }
    await client.query("commit");
    return pending.length;
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

  const postal = await client.query<{ zip: string; lat: number; lng: number }>("select zip, lat, lng from postal_codes");
  const coords = new Map(postal.rows.map((row) => [row.zip, { lat: row.lat, lng: row.lng }]));

  const result: IngestResult = { runId, fetched: 0, upserted: 0, skipped: 0, gone: 0 };
  let raws: RawListing[] = [];
  let pending: PendingListing[] = [];
  const flush = async () => {
    result.upserted += await writeBatch(client, source.id, raws, pending);
    raws = [];
    pending = [];
  };

  try {
    try {
      for await (const raw of adapter.fetch({ db: client })) {
        result.fetched += 1;
        raws.push(raw);
        const listing = adapter.normalize(raw);
        if (!listing) {
          result.skipped += 1;
        } else {
          if (listing.lat === null && listing.zip && coords.has(listing.zip)) {
            const point = coords.get(listing.zip)!;
            listing.lat = point.lat;
            listing.lng = point.lng;
          }
          pending.push({ listing: { ...listing, sourceId: source.id }, segment: raw.segment ?? null });
        }
        if (raws.length >= BATCH_SIZE) await flush();
      }
    } finally {
      // Keep what was fetched before an error, too.
      if (raws.length > 0) await flush();
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
        `update listings set status = 'gone'
          where source_id = $1 and status = 'active' and last_seen_at < now() - make_interval(days => $2)`,
        [source.id, adapter.staleAfterDays],
      );
      result.gone += stale.rowCount ?? 0;
    }

    await client.query(
      `update ingest_runs set finished_at = now(), fetched = $2, upserted = $3, skipped = $4, gone = $5 where id = $1`,
      [runId, result.fetched, result.upserted, result.skipped, result.gone],
    );
    return result;
  } catch (error) {
    // Never let a failed bookkeeping write hide the original error.
    try {
      await client.query(
        "update ingest_runs set finished_at = now(), fetched = $2, upserted = $3, skipped = $4, error = $5 where id = $1",
        [runId, result.fetched, result.upserted, result.skipped, error instanceof Error ? error.message : String(error)],
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
            status = case when missed_runs + 1 >= $3 then 'gone' else status end
      where source_id = $1 and status = 'active' and last_seen_at < $2
        and ($4::text[] is null or segment = any($4::text[]))
      returning status`,
    [sourceId, startedAt, MISSED_RUNS_UNTIL_GONE, segments],
  );
  return missed.rows.filter((row) => row.status === "gone").length;
}
