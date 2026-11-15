import { DEFAULT_USER_AGENT, PoliteFetcher } from "./fetcher";

export function readNumber(name: string, fallback: number, min: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) throw new Error(`${name} must be a number of at least ${min}, got "${value}".`);
  return n;
}

export function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "ja", "yes"].includes(value)) return true;
  if (["0", "false", "nein", "no"].includes(value)) return false;
  throw new Error(`${name} must be true or false, got "${process.env[name]}".`);
}

/** A comma-separated list, e.g. "autoscout24, kleinanzeigen"; undefined when unset or blank. */
export function readList(name: string): string[] | undefined {
  const items = (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/** The fetcher scrapers use, configured from SCRAPE_* environment variables. */
export function createFetcherFromEnv(): PoliteFetcher {
  return new PoliteFetcher({
    userAgent: process.env.SCRAPE_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    respectRobots: readBoolean("SCRAPE_RESPECT_ROBOTS", true),
    // Below 1 s per host we would put real load on someone else's servers.
    minDelayMs: readNumber("SCRAPE_MIN_DELAY_MS", 5000, 1000),
    maxRequests: readNumber("SCRAPE_MAX_REQUESTS", 500, 1),
  });
}
