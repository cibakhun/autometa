import type { Pool, PoolClient } from "pg";
import type { NormalizedListing } from "@/core/types";
import type { RawListing, SourceAdapter } from "./adapter";

const BATCH_SIZE = 500;
/** A listing missing from this many full-snapshot runs in a row counts as sold. */
export const MISSED_RUNS_UNTIL_GONE = 2;

export interface IngestResult {
  runId: number;
  fetched: number;
  upserted: number;
  skipped: number;
  gone: number;
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
] as const;

function listingValues(l: NormalizedListing): unknown[] {
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

async function writeBatch(client: PoolClient, sourceId: string, raws: RawListing[], listings: NormalizedListing[]) {
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
    if (listings.length > 0) {
      const updates = LISTING_COLUMNS.filter((c) => c !== "source_id" && c !== "external_id")
        .map((c) => `${c} = excluded.${c}`)
        .join(", ");
      await client.query(
        `insert into listings (${LISTING_COLUMNS.join(", ")})
         values ${placeholders(listings.length, LISTING_COLUMNS.length)}
         on conflict (source_id, external_id)
         do update set ${updates}, status = 'active', missed_runs = 0, last_seen_at = now()`,
        listings.flatMap(listingValues),
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

/** Fetches everything from one source, normalizes it and stores it. */
export async function runIngest(pool: Pool, adapter: SourceAdapter): Promise<IngestResult> {
  const { source } = adapter;
  await pool.query(
    `insert into sources (id, name, kind, website_url) values ($1, $2, $3, $4)
     on conflict (id) do update set name = excluded.name, kind = excluded.kind, website_url = excluded.website_url`,
    [source.id, source.name, source.kind, source.websiteUrl],
  );

  const run = await pool.query<{ id: string; started_at: Date }>(
    "insert into ingest_runs (source_id) values ($1) returning id, started_at",
    [source.id],
  );
  const runId = Number(run.rows[0].id);
  const startedAt = run.rows[0].started_at;

  const postal = await pool.query<{ zip: string; lat: number; lng: number }>("select zip, lat, lng from postal_codes");
  const coords = new Map(postal.rows.map((row) => [row.zip, { lat: row.lat, lng: row.lng }]));

  const result: IngestResult = { runId, fetched: 0, upserted: 0, skipped: 0, gone: 0 };
  const client = await pool.connect();
  try {
    let raws: RawListing[] = [];
    let listings: NormalizedListing[] = [];
    const flush = async () => {
      await writeBatch(client, source.id, raws, listings);
      result.upserted += listings.length;
      raws = [];
      listings = [];
    };

    for await (const raw of adapter.fetch()) {
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
        listings.push({ ...listing, sourceId: source.id });
      }
      if (raws.length >= BATCH_SIZE) await flush();
    }
    await flush();

    if (adapter.fullSnapshot) {
      const missed = await client.query(
        `update listings
           set missed_runs = missed_runs + 1,
               status = case when missed_runs + 1 >= $3 then 'gone' else status end
         where source_id = $1 and status = 'active' and last_seen_at < $2
         returning status`,
        [source.id, startedAt, MISSED_RUNS_UNTIL_GONE],
      );
      result.gone = missed.rows.filter((row) => row.status === "gone").length;
    }

    await client.query(
      `update ingest_runs set finished_at = now(), fetched = $2, upserted = $3, skipped = $4, gone = $5 where id = $1`,
      [runId, result.fetched, result.upserted, result.skipped, result.gone],
    );
    return result;
  } catch (error) {
    // Record the failure on the client we already hold, so a small pool cannot deadlock here,
    // and never let a failed bookkeeping write hide the original error.
    try {
      await client.query("update ingest_runs set finished_at = now(), error = $2 where id = $1", [
        runId,
        error instanceof Error ? error.message : String(error),
      ]);
    } catch (logError) {
      console.error("Could not record the failed ingest run:", logError);
    }
    throw error;
  } finally {
    client.release();
  }
}
