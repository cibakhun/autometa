import type { Pool, PoolClient } from "pg";
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
  /**
   * Facts only: no description texts or contact data of private sellers. Photos are never
   * copied; the address of the list's preview photo may be kept as a link.
   */
  payload: Record<string, unknown>;
  /**
   * The part of the source's inventory this listing was found in (see crawl_segments).
   * Only set it when the listing really belongs to that part, not for ads the portal mixes in.
   * A sighting without a segment keeps the stored one only while price and make are unchanged;
   * segments must be cut by those facts (or coarser ones) for that to hold.
   */
  segment?: string;
}

/** What an adapter gets from the import run. */
export interface AdapterContext {
  pool: Pool;
}

/**
 * Every source (marketplace API, dealer feed, scraped portal, demo data) implements this interface.
 * Rules every adapter must follow: only facts, no description texts and no copies of photos
 * (a link to the preview photo is fine), no personal data of private sellers, never bypass bot
 * protection, logins or captchas.
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
  /**
   * For sources that cannot be read completely: listings not seen for this many days count as
   * sold. Leave it out for full snapshots.
   */
  staleAfterDays?: number;
  fetch(context?: FetchContext): AsyncIterable<RawListing>;
  /** Returns null when the listing cannot be used (e.g. no price). */
  normalize(raw: RawListing): NormalizedListing | null;
  /**
   * Segments the last fetch() read completely. Active listings of these segments that the run did
   * not see count as missed, like listings missing from a full snapshot. Called after fetch()
   * finished without an error.
   */
  completedSegments?(): string[];
}

/** What a running import hands to fetch(). */
export interface FetchContext {
  /**
   * The import's own database connection. Adapters that keep crawl state use it instead of the
   * pool, so an import never waits for a second connection.
   */
  db: PoolClient;
}

export type AdapterFactory = (context: AdapterContext) => SourceAdapter;
