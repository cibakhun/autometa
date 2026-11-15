import "./env";
import { getPool } from "@/lib/db";
import { ADAPTERS } from "@/ingest/adapters";
import { readList, readNumber } from "@/ingest/http/config";
import { ingestSources } from "@/ingest/pipeline";

/**
 * Background import: runs the sources in SCRAPE_SOURCES (e.g. "autoscout24,kleinanzeigen") right
 * away and then every SCRAPE_INTERVAL_MINUTES, counted from the start of the previous round.
 * A round that runs longer than the interval is followed by the next one at once, never overlapped.
 */

const log = (message: string) => console.log(`[worker] ${new Date().toISOString()} ${message}`);

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
  while (!stopping) {
    const started = Date.now();
    try {
      await ingestSources(pool, sources, log);
    } catch (error) {
      log(`round failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
    const wait = Math.max(0, started + intervalMs - Date.now());
    log(`next round in ${Math.round(wait / 60_000)} minutes`);
    // Wake up early when asked to stop.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, wait);
      const early = () => {
        clearTimeout(timer);
        resolve();
      };
      process.once("SIGTERM", early);
      process.once("SIGINT", early);
    });
  }
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
