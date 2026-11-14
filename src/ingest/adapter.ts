import type { NormalizedListing } from "@/core/types";

export interface SourceInfo {
  id: string;
  name: string;
  kind: "api" | "feed" | "push" | "scrape" | "demo";
  websiteUrl: string | null;
}

/** One listing as delivered by a source, before normalization. Stored as-is in raw_listings. */
export interface RawListing {
  externalId: string;
  payload: Record<string, unknown>;
}

/**
 * Every source (marketplace API, dealer feed, scraped portal, demo data) implements this interface.
 * Rules every adapter must follow: only facts, no photos or description texts,
 * no personal data of private sellers, never bypass bot protection, logins or captchas.
 * Scrapers fetch only through PoliteFetcher (src/ingest/http/fetcher.ts) and set
 * fullSnapshot to false unless they really read the source's whole inventory.
 */
export interface SourceAdapter {
  source: SourceInfo;
  /**
   * True when each run returns the source's complete current inventory.
   * Only then may listings missing from a run be counted as possibly sold.
   */
  fullSnapshot: boolean;
  fetch(): AsyncIterable<RawListing>;
  /** Returns null when the listing cannot be used (e.g. no price). */
  normalize(raw: RawListing): NormalizedListing | null;
}
