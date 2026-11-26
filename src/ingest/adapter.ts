import type { Pool, PoolClient } from "pg";
import type { DamageKind } from "@/core/damage";
import type { BodyType, Fuel, NormalizedListing, SellerType, Transmission } from "@/core/types";

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
   * For sources whose lists cannot show every stored listing again (for example only their newest
   * pages may be read) but whose robots.txt allows a listing's own page: checks the given listings
   * there, in the given order, and yields what each page says. Stops quietly when the run's request
   * budget or time is used up, and early when the answers look implausible. Called after fetch()
   * finished without an error. Only the outcome is kept, never the page.
   */
  checkListings?(due: ListingRef[], context: FetchContext): AsyncIterable<CheckResult>;
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

/** A stored listing that is due for a check on its own page. */
export interface ListingRef {
  externalId: string;
  url: string;
  /** The price stored for it, to tell a price change on its page from a misread. */
  priceEur: number;
  /** The title stored for it. */
  title?: string;
}

/**
 * What a listing's own page says: still offered, taken down, or nothing clear (the listing stays
 * as it is and is checked again later).
 */
export type CheckOutcome = "active" | "gone" | "unclear";

/** Facts a listing's own page shows besides being online; each left out when the page does not show it clearly. */
export interface PageFacts {
  /** The price the page asks now (0 for a car given away). */
  priceEur?: number;
  /** The day the portal says the listing was put online, YYYY-MM-DD. */
  listedOn?: string;
  /** The page shows no car for sale after all (a dealer buying up cars): the listing leaves the search as filtered. */
  notForSale?: true;
  /**
   * Vehicle facts from the page's own fields (the seller picks them from the portal's lists),
   * for portals whose result lists show only the title. Each is left out when the page does not
   * show it in the expected form.
   */
  fuel?: Fuel;
  transmission?: Transmission;
  powerKw?: number;
  bodyType?: BodyType;
  sellerType?: SellerType;
  /** First day of the last month the HU is valid, YYYY-MM-01. */
  huUntil?: string;
  /** Damage the page's condition field names; empty is not used (an intact car leaves it out). */
  damage?: DamageKind[];
}

export interface CheckResult extends PageFacts {
  externalId: string;
  outcome: CheckOutcome;
}

export type AdapterFactory = (context: AdapterContext) => SourceAdapter;
