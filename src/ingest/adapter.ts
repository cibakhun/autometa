import type { NormalizedListing } from "@/core/types";

export interface SourceInfo {
  id: string;
  name: string;
  kind: "api" | "feed" | "push" | "demo";
  websiteUrl: string | null;
}

/** One listing as delivered by a source, before normalization. Stored as-is in raw_listings. */
export interface RawListing {
  externalId: string;
  payload: Record<string, unknown>;
}

/**
 * Every source (marketplace API, dealer feed, demo data) implements this interface.
 * Rules every adapter must follow: only facts, no photos or description texts,
 * no personal data of private sellers, never bypass bot protection, logins or captchas.
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
