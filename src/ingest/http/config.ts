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

/** Pause between two requests to one portal for sources that need only a few pages a day. */
export const RELAXED_DELAY_MS = 5000;

/**
 * The shortest pause any source keeps between two requests to the same portal
 * (SCRAPE_MIN_DELAY_MS, default 2 s). Below 1 s we would put real load on someone else's servers.
 */
export function floorDelayMs(): number {
  return readNumber("SCRAPE_MIN_DELAY_MS", 2000, 1000);
}

/** Minutes from the start of one import round to the start of the next (SCRAPE_INTERVAL_MINUTES). */
export function intervalMinutes(): number {
  return readNumber("SCRAPE_INTERVAL_MINUTES", 60, 10);
}

/**
 * How long one source may fetch per round (SCRAPE_RUN_MINUTES). The default leaves a sixth of the
 * round for duplicates, market values and repair estimates, so rounds keep their rhythm.
 */
export function runMinutes(): number {
  const interval = intervalMinutes();
  const minutes = readNumber("SCRAPE_RUN_MINUTES", Math.max(5, Math.floor((interval * 5) / 6)), 5);
  if (minutes > interval) {
    throw new Error(`SCRAPE_RUN_MINUTES (${minutes}) must not be longer than SCRAPE_INTERVAL_MINUTES (${interval}).`);
  }
  return minutes;
}

/** Hours in which every listing should be checked once (SCRAPE_CYCLE_HOURS, default 24). */
export function cycleHours(): number {
  return readNumber("SCRAPE_CYCLE_HOURS", 24, 1);
}

export interface FetcherSettings {
  /** The source's own pause between requests; never below floorDelayMs(). Defaults to RELAXED_DELAY_MS. */
  delayMs?: number;
  now?: () => number;
}

/**
 * The fetcher scrapers use, configured from SCRAPE_* environment variables. Its run ends after
 * runMinutes(), like at the end of the request budget (SCRAPE_MAX_REQUESTS).
 */
export function createFetcherFromEnv(settings: FetcherSettings = {}): PoliteFetcher {
  const now = settings.now ?? Date.now;
  return new PoliteFetcher({
    userAgent: process.env.SCRAPE_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    respectRobots: readBoolean("SCRAPE_RESPECT_ROBOTS", true),
    minDelayMs: Math.max(settings.delayMs ?? RELAXED_DELAY_MS, floorDelayMs()),
    maxRequests: readNumber("SCRAPE_MAX_REQUESTS", 20_000, 1),
    deadline: now() + runMinutes() * 60_000,
    now,
  });
}
