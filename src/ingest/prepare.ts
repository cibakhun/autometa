import type { Pool } from "pg";
import type { SourceAdapter } from "./adapter";
import { ADAPTERS } from "./adapters";
import { runIngest, type IngestResult } from "./run";
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
  createDemo: () => SourceAdapter = ADAPTERS.demo,
): Promise<PrepareResult> {
  const reference = await seedReferenceData(pool);
  const { rows } = await pool.query<{ empty: boolean }>("select not exists (select 1 from listings) as empty");
  const demo = rows[0].empty ? await runIngest(pool, createDemo()) : null;
  return { reference, demo };
}
