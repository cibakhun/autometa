import { MAKES } from "@/core/taxonomy";
import type { AdapterFactory } from "../adapter";
import {
  createFetcherFromEnv,
  cycleHours,
  floorDelayMs,
  intervalMinutes,
  readList,
  RELAXED_DELAY_MS,
  runMinutes,
} from "../http/config";
import { createAutoDeAdapter } from "./autode";
import { createAutoheroAdapter } from "./autohero";
import { createAutoScout24Adapter } from "./autoscout24";
import { createDemoAdapter } from "./demo";
import { createKleinanzeigenAdapter } from "./kleinanzeigen";
import { createQuokaAdapter } from "./quoka";

const DEFAULT_DEMO_COUNT = 3000;

/** Reads DEMO_LISTING_COUNT; a set value must be a whole number of 0 or more. */
export function demoListingCount(value = process.env.DEMO_LISTING_COUNT): number {
  if (value === undefined || value.trim() === "") return DEFAULT_DEMO_COUNT;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`DEMO_LISTING_COUNT must be a whole number of 0 or more, got "${value}".`);
  }
  return count;
}

/** Make slugs from an environment variable such as AUTOSCOUT24_MAKES; all makes when unset. */
export function makesFromEnv(name: string): string[] | undefined {
  const makes = readList(name)?.map((make) => make.toLowerCase());
  const unknown = makes?.filter((make) => !MAKES.some((known) => known.slug === make)) ?? [];
  if (unknown.length > 0) {
    throw new Error(`${name} has unknown makes: ${unknown.join(", ")}. Known: ${MAKES.map((m) => m.slug).join(", ")}`);
  }
  return makes;
}

const logFor = (source: string) => (message: string) => console.log(`[${source}] ${message}`);

/**
 * Pause for sources that read their newest pages and then check older listings one by one on
 * their own page for the rest of the run: one request every 3 s to the portal.
 */
export const CHECKING_DELAY_MS = 3000;

/** All known sources. */
export const ADAPTERS: Record<string, AdapterFactory> = {
  demo: () => createDemoAdapter({ count: demoListingCount() }),
  // Paces itself between the floor and the relaxed pause to read its whole inventory once per cycle.
  autoscout24: () =>
    createAutoScout24Adapter({
      fetcher: createFetcherFromEnv({ delayMs: RELAXED_DELAY_MS }),
      makes: makesFromEnv("AUTOSCOUT24_MAKES"),
      pace: {
        cycleHours: cycleHours(),
        runMinutes: runMinutes(),
        intervalMinutes: intervalMinutes(),
        minDelayMs: floorDelayMs(),
        maxDelayMs: Math.max(RELAXED_DELAY_MS, floorDelayMs()),
      },
      log: logFor("autoscout24"),
    }),
  kleinanzeigen: () =>
    createKleinanzeigenAdapter({
      fetcher: createFetcherFromEnv({ delayMs: CHECKING_DELAY_MS }),
      makes: makesFromEnv("KLEINANZEIGEN_MAKES"),
      log: logFor("kleinanzeigen"),
    }),
  quoka: () =>
    createQuokaAdapter({
      fetcher: createFetcherFromEnv({ delayMs: CHECKING_DELAY_MS }),
      makes: makesFromEnv("QUOKA_MAKES"),
      log: logFor("quoka"),
    }),
  autohero: () => createAutoheroAdapter({ fetcher: createFetcherFromEnv(), log: logFor("autohero") }),
  autode: () => createAutoDeAdapter({ fetcher: createFetcherFromEnv(), log: logFor("autode") }),
};
