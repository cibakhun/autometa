import type { SourceAdapter } from "../adapter";
import { createDemoAdapter } from "./demo";

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

/** All known sources. Add a real adapter here once its access is agreed. */
export const ADAPTERS: Record<string, () => SourceAdapter> = {
  demo: () => createDemoAdapter({ count: demoListingCount() }),
};
