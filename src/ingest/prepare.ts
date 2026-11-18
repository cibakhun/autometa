import type { Pool } from "pg";
import type { AdapterFactory } from "./adapter";
import { ADAPTERS } from "./adapters";
import { IngestBusyError, runIngest, type IngestResult } from "./run";
import { seedReferenceData } from "./seed";

export interface PrepareResult {
  reference: Awaited<ReturnType<typeof seedReferenceData>>;
  /** The demo import, or null when the database already had listings. */
  demo: IngestResult | null;
}

/**
 * Fills a migrated database for the deployed code. Reference data is written on every call, so
 * makes, models and postal codes follow the code. The demo listings are imported only while the
 * database has no listings at all, so a fresh deployment shows a working search without anyone
 * opening a terminal, and later starts leave the listings alone.
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
  return { reference, demo };
}
