import "./env";
import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import { ADAPTERS } from "@/ingest/adapters";
import { refreshDefectProfiles } from "@/ingest/defects/refresh";
import { readBoolean, readList, readNumber } from "@/ingest/http/config";
import { ingestSources } from "@/ingest/pipeline";
import { updateRepairEstimates } from "@/ingest/repairs";

/**
 * Background import: runs the sources in SCRAPE_SOURCES (e.g. "autoscout24,kleinanzeigen") right
 * away and then every SCRAPE_INTERVAL_MINUTES, counted from the start of the previous round.
 * A round that runs longer than the interval is followed by the next one at once, never overlapped.
 *
 * Next to it, unless RDW_PROFILES is false, the defect profiles per model are built from RDW open
 * data (src/ingest/defects): a run of at most RDW_MAX_REQUESTS queries, then the next one an hour
 * later while profiles are still due, else a day later.
 */

const log = (message: string) => console.log(`[worker] ${new Date().toISOString()} ${message}`);

const HOUR = 3_600_000;

async function main() {
  const sources = readList("SCRAPE_SOURCES") ?? [];
  const unknown = sources.filter((id) => !ADAPTERS[id] || id === "demo");
  if (unknown.length > 0) throw new Error(`SCRAPE_SOURCES has unknown sources: ${unknown.join(", ")}`);
  if (sources.length === 0) {
    log("SCRAPE_SOURCES is empty, nothing to import.");
    return;
  }
  const intervalMs = readNumber("SCRAPE_INTERVAL_MINUTES", 60, 10) * 60_000;
  const pool = getPool();
  let stopping = false;
  const stop = () => {
    stopping = true;
    log("stopping after this round");
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  log(`importing ${sources.join(", ")} every ${intervalMs / 60_000} minutes`);
  const defects = readBoolean("RDW_PROFILES", true) ? defectLoop(pool, () => stopping) : Promise.resolve();
  while (!stopping) {
    const started = Date.now();
    try {
      await ingestSources(pool, sources, log);
    } catch (error) {
      log(`round failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
    if (stopping) break;
    const wait = Math.max(0, started + intervalMs - Date.now());
    log(`next round in ${Math.round(wait / 60_000)} minutes`);
    await pause(wait);
  }
  await defects;
  await pool.end();
}

/** Waits, but wakes up early when asked to stop. */
function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const early = () => {
      clearTimeout(timer);
      process.off("SIGTERM", early);
      process.off("SIGINT", early);
      resolve();
    };
    const timer = setTimeout(early, ms);
    process.once("SIGTERM", early);
    process.once("SIGINT", early);
  });
}

async function defectLoop(pool: Pool, stopping: () => boolean) {
  while (!stopping()) {
    let wait = 24 * HOUR;
    try {
      const result = await refreshDefectProfiles(pool, { shouldStop: stopping, log: (message) => log(`defects: ${message}`) });
      // New profiles change the risk buffers; the next import round would do it too, but later.
      if (result.profiles > 0 && !stopping()) log(`defects: ${await updateRepairEstimates(pool)} repair estimates changed`);
      wait = result.error ? 6 * HOUR : result.pending > 0 ? HOUR : 24 * HOUR;
    } catch (error) {
      log(`defects: run failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      wait = 6 * HOUR;
    }
    if (stopping()) break;
    log(`defects: next run in ${Math.round(wait / HOUR)} h`);
    await pause(wait);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
