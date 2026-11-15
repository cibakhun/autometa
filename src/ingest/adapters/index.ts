import { MAKES } from "@/core/taxonomy";
import type { AdapterFactory } from "../adapter";
import { createFetcherFromEnv, readList } from "../http/config";
import { createAutoScout24Adapter } from "./autoscout24";
import { createDemoAdapter } from "./demo";
import { createKleinanzeigenAdapter } from "./kleinanzeigen";
import { createMobileDeAdapter, mobileDeApiFromEnv } from "./mobilede";

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

/** All known sources. */
export const ADAPTERS: Record<string, AdapterFactory> = {
  demo: () => createDemoAdapter({ count: demoListingCount() }),
  autoscout24: () =>
    createAutoScout24Adapter({
      fetcher: createFetcherFromEnv(),
      makes: makesFromEnv("AUTOSCOUT24_MAKES"),
      log: logFor("autoscout24"),
    }),
  kleinanzeigen: () =>
    createKleinanzeigenAdapter({
      fetcher: createFetcherFromEnv(),
      makes: makesFromEnv("KLEINANZEIGEN_MAKES"),
      log: logFor("kleinanzeigen"),
    }),
  // Official Search-API; runs only with an API account from mobile.de (MOBILE_DE_API_USER/PASSWORD).
  mobilede: () =>
    createMobileDeAdapter({
      api: mobileDeApiFromEnv(),
      makes: makesFromEnv("MOBILE_DE_MAKES"),
      log: logFor("mobilede"),
    }),
};
