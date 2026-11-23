import "./env";
import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import { ADAPTERS } from "@/ingest/adapters";
import { refreshDefectProfiles } from "@/ingest/defects/refresh";
import { intervalMinutes, readBoolean, readList, runMinutes } from "@/ingest/http/config";
import { ingestSources } from "@/ingest/pipeline";
import { updateRepairEstimates } from "@/ingest/repairs";
import { runAlerts } from "@/alerts/run";

/**
 * Background import: runs the sources in SCRAPE_SOURCES (e.g. "autoscout24,kleinanzeigen") right
 * away and then every SCRAPE_INTERVAL_MINUTES, counted from the start of the previous round.
 * A round that runs longer than the interval is followed by the next one at once, never overlapped.
 * Each source fetches for at most SCRAPE_RUN_MINUTES per round; the rest of the round is for
 * duplicates, market values and repair estimates. Sources with much to check (AutoScout24's whole
 * inventory, Kleinanzeigen's and Quoka's older listings) use that time fully, so every listing is
 * read or checked about once a day.
 *
 * Next to it, unless RDW_PROFILES is false, the defect profiles per model are built from RDW open
 * data (src/ingest/defects): a run of at most RDW_MAX_REQUESTS queries, then the next one an hour
 * later while profiles are still due, else a day later.
 *
 * And every ALERT_INTERVAL_MINUTES (default 5) the alert job pushes what saved searches found and
 * what changed on watch lists (src/alerts/run.ts); ALERTS=false switches it off.
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
  const intervalMs = intervalMinutes() * 60_000;
  // Fails here, before the first round, when the run time does not fit the interval.
  const fetchMinutes = runMinutes();
  const alertMs = alertIntervalMs();
  // Each source holds one connection for its whole run; the defect refresh and the repair
  // estimates need one each besides, the alert job two, plus one to spare. Otherwise they wait
  // for a source to end.
  process.env.DATABASE_POOL_MAX ??= String(sources.length + 5);
  const pool = getPool();
  let stopping = false;
  const stop = () => {
    stopping = true;
    log("stopping after this round");
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  log(`importing ${sources.join(", ")} every ${intervalMs / 60_000} minutes, fetching up to ${fetchMinutes} minutes each`);
  const defects = readBoolean("RDW_PROFILES", true) ? defectLoop(pool, () => stopping) : Promise.resolve();
  const alerts = readBoolean("ALERTS", true) ? alertLoop(pool, alertMs, () => stopping) : Promise.resolve();
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
  await Promise.all([defects, alerts]);
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
      // Skipped: another refresh (npm run defects) holds the lock and may stop with profiles still due.
      wait = result.error ? 6 * HOUR : result.pending > 0 || result.skipped ? HOUR : 24 * HOUR;
    } catch (error) {
      log(`defects: run failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      wait = 6 * HOUR;
    }
    if (stopping()) break;
    log(`defects: next run in ${Math.round(wait / HOUR)} h`);
    await pause(wait);
  }
}

/** Minutes between two alert runs, 1 to 60 (default 5). */
function alertIntervalMs(): number {
  const raw = Number(process.env.ALERT_INTERVAL_MINUTES ?? 5);
  if (!Number.isFinite(raw) || raw < 1 || raw > 60) throw new Error("ALERT_INTERVAL_MINUTES must be between 1 and 60");
  return raw * 60_000;
}

async function alertLoop(pool: Pool, interval: number, stopping: () => boolean) {
  while (!stopping()) {
    const started = Date.now();
    try {
      const result = await runAlerts(pool, { log: (message) => log(message) });
      if (result.searchPushes > 0 || result.favoritePushes > 0) {
        log(`alerts: ${result.searchPushes} search pushes (${result.vehicles} vehicles), ${result.favoritePushes} watch list pushes`);
      }
    } catch (error) {
      log(`alerts: run failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
    if (stopping()) break;
    await pause(Math.max(0, started + interval - Date.now()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
