import type { Pool } from "pg";
import type { AdapterFactory } from "./adapter";
import { ADAPTERS } from "./adapters";
import { backfillDamage, updateMarketValues, type MarketResult } from "./market";
import { updateRepairEstimates } from "./repairs";
import { reviewStoredListings, type ReviewResult } from "./review";
import { IngestBusyError, runIngest, type IngestResult } from "./run";
import { seedReferenceData } from "./seed";
import { updateSourceStats } from "./status";

export interface PrepareResult {
  reference: Awaited<ReturnType<typeof seedReferenceData>>;
  /** The demo import, or null when the database already had listings. */
  demo: IngestResult | null;
  /** Listings stored before damage detection existed, now checked. */
  damageChecked: number;
  /** Stored listings checked against the import rules deployed now. */
  review: ReviewResult;
  market: MarketResult;
  /** Listings whose repair estimate changed. */
  repairsChanged: number;
}

/**
 * Fills a migrated database for the deployed code. Reference data is written on every call, so
 * makes, models and postal codes follow the code. The demo listings are imported only while the
 * database has no listings at all, so a fresh deployment shows a working search without anyone
 * opening a terminal, and later starts leave the listings alone. Listings stored before a
 * detector existed get their damage kinds, listings stored before an import rule existed are
 * checked against it, and market values and repair estimates follow the deployed rules.
 */
export async function prepareData(
  pool: Pool,
  createDemo: AdapterFactory = ADAPTERS.demo,
): Promise<PrepareResult> {
  const reference = await seedReferenceData(pool);
  const { rows } = await pool.query<{ empty: boolean }>("select not exists (select 1 from listings) as empty");
  let demo: IngestResult | null = null;
  if (rows[0].empty) {
    try {
      demo = await runIngest(pool, createDemo({ pool }));
    } catch (error) {
      // Another instance starting at the same time is importing the demo data already.
      if (!(error instanceof IngestBusyError)) throw error;
    }
  }
  const damageChecked = await backfillDamage(pool);
  // Before the market values, so a listing taken out no longer counts among the comparables.
  const review = await reviewStoredListings(pool);
  const market = await updateMarketValues(pool);
  const repairsChanged = await updateRepairEstimates(pool);
  // The notice above the search shows the check rate from the first page view on.
  await updateSourceStats(pool);
  return { reference, demo, damageChecked, review, market, repairsChanged };
}
