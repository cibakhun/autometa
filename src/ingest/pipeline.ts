import type { Pool } from "pg";
import { ADAPTERS } from "./adapters";
import { updateDuplicates, type DuplicateResult } from "./duplicates";
import { runIngest, type IngestResult } from "./run";

export interface SourceOutcome {
  source: string;
  result?: IngestResult;
  error?: unknown;
}

export interface PipelineResult {
  sources: SourceOutcome[];
  duplicates: DuplicateResult;
  /** Demo listings removed because real listings arrived. */
  demoRemoved: number;
}

/**
 * Imports the given sources at the same time (each portal has its own fetcher and pacing),
 * then groups duplicates across all sources. Once a real source has stored listings, the demo
 * data is removed, so the search never mixes fictional and real cars. One failing source does
 * not stop the others; its error is returned.
 */
export async function ingestSources(
  pool: Pool,
  sourceIds: string[],
  log: (message: string) => void = console.log,
): Promise<PipelineResult> {
  const unknown = sourceIds.filter((id) => !ADAPTERS[id]);
  if (unknown.length > 0) throw new Error(`Unknown source "${unknown.join(", ")}". Known: ${Object.keys(ADAPTERS).join(", ")}`);

  const sources = await Promise.all(
    sourceIds.map(async (source): Promise<SourceOutcome> => {
      const started = Date.now();
      try {
        const result = await runIngest(pool, ADAPTERS[source]({ pool }));
        log(
          `${source}: fetched ${result.fetched}, stored ${result.upserted}, skipped ${result.skipped}, gone ${result.gone} (${Math.round((Date.now() - started) / 1000)} s)`,
        );
        return { source, result };
      } catch (error) {
        log(`${source}: failed after ${Math.round((Date.now() - started) / 1000)} s: ${error instanceof Error ? error.message : String(error)}`);
        return { source, error };
      }
    }),
  );

  // Also after a failed run: what it stored before the error is in the search, too.
  let demoRemoved = 0;
  if (await hasRealListings(pool)) {
    demoRemoved = await removeDemoData(pool);
    if (demoRemoved > 0) log(`demo: removed ${demoRemoved} demo listings, real listings are in`);
  }
  const duplicates = await updateDuplicates(pool);
  log(`duplicates: ${duplicates.clusters} vehicles listed on several portals (${duplicates.listings} listings)`);
  return { sources, duplicates, demoRemoved };
}

async function hasRealListings(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ found: boolean }>(
    `select exists (
       select 1 from listings l join sources s on s.id = l.source_id where s.kind <> 'demo' and l.status = 'active'
     ) as found`,
  );
  return rows[0].found;
}

/** Deletes demo sources with their listings, clicks and runs. Returns the number of listings. */
export async function removeDemoData(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    "select count(*)::int as count from listings l join sources s on s.id = l.source_id where s.kind = 'demo'",
  );
  await pool.query("delete from sources where kind = 'demo'");
  return rows[0].count;
}
