import type { PoolClient } from "pg";
import {
  detectBodyType,
  detectFuel,
  detectTransmission,
  findMakeInTitle,
  isNotForSale,
  isYearOnlyRegistration,
  parseFirstRegistration,
  parsePowerKw,
  resolveMake,
  resolveModelInTitle,
  sourceImageUrl,
} from "@/core/normalize";
import { plausibleListing } from "@/core/plausibility";
import type { NormalizedListing, SellerType } from "@/core/types";
import type { RawListing } from "../adapter";
import type { CardFacts } from "../http/cards";
import { BlockedError, BudgetExceededError, DisallowedError, HttpStatusError, type FetchedPage, type PoliteFetcher } from "../http/fetcher";
import { saveSample } from "../samples";

/**
 * The parts every result-list scraper shares: loading pages with one error policy, reading a list
 * page by page until it ends, never yielding a listing twice, and keeping a copy of a page whose
 * format the adapter no longer understands (see /admin/quellen).
 */

/** A page did not have the structure the adapter expects. */
export class PageFormatError extends Error {
  constructor(source: string, url: string, detail: string) {
    super(`${source}: unexpected page at ${url}: ${detail}`);
    this.name = "PageFormatError";
  }
}

const MAX_FAILURES_IN_A_ROW = 3;

export class PageLoader {
  private failuresInARow = 0;

  constructor(
    private readonly sourceId: string,
    private readonly fetcher: PoliteFetcher,
    private readonly log: (message: string) => void,
    private readonly db?: PoolClient,
  ) {}

  get requestsLeft(): number {
    return this.fetcher.requestsLeft;
  }

  get requestsMade(): number {
    return this.fetcher.requestsMade;
  }

  /**
   * The page, or null when it is not there (4xx) or robots.txt forbids it. Blocks and the budget
   * end the run; three network or server errors in a row as well.
   */
  async load(url: string): Promise<FetchedPage | null> {
    try {
      const page = await this.fetcher.getText(url);
      this.failuresInARow = 0;
      return page;
    } catch (error) {
      if (error instanceof BlockedError || error instanceof BudgetExceededError) throw error;
      if (error instanceof DisallowedError) {
        this.log(`skipped (robots.txt): ${url}`);
        return null;
      }
      if (error instanceof HttpStatusError && error.status < 500) {
        this.log(`skipped (HTTP ${error.status}): ${url}`);
        return null;
      }
      this.failuresInARow += 1;
      this.log(`failed: ${url}: ${error instanceof Error ? error.message : String(error)}`);
      if (this.failuresInARow >= MAX_FAILURES_IN_A_ROW) throw error;
      return null;
    }
  }

  /** Keeps the page for diagnosis and returns the error to throw. */
  async formatError(page: FetchedPage, detail: string): Promise<PageFormatError> {
    await this.keepPage(page);
    return new PageFormatError(this.sourceId, page.url, detail);
  }

  /** For a part of the page the run can do without: logs it and keeps the page for diagnosis. */
  async formatWarning(page: FetchedPage, detail: string): Promise<void> {
    this.log(`unexpected page at ${page.url}: ${detail}`);
    await this.keepPage(page);
  }

  private async keepPage(page: FetchedPage): Promise<void> {
    if (!this.db) return;
    try {
      await saveSample(this.db, { sourceId: this.sourceId, url: page.url, status: page.status, reason: "format-error", body: page.text });
    } catch (error) {
      this.log(`could not keep the page: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export interface ListItem {
  id: string;
}

export interface ReadListOptions<T extends ListItem> {
  loader: PageLoader;
  /** URL of page 1, 2, ... of the list. */
  pageUrl: (page: number) => string;
  maxPages: number;
  parse: (page: FetchedPage) => T[] | Promise<T[]>;
  /** Ids already yielded in this run, across lists. */
  seen: Set<string>;
  /** True when page 1 must have listings: none there means the page format changed. */
  mustHaveListings?: boolean;
}

/**
 * Reads a list page by page and yields the listings not seen before. Stops at the last page, at
 * a page that brings nothing new for this list (portals often repeat the last page), or when the
 * request budget is used up.
 */
export async function* readList<T extends ListItem>(options: ReadListOptions<T>): AsyncGenerator<T> {
  const { loader, seen } = options;
  const inList = new Set<string>();
  for (let n = 1; n <= options.maxPages; n += 1) {
    if (loader.requestsLeft < 1) return;
    const page = await loader.load(options.pageUrl(n));
    if (!page) return;
    const items = await options.parse(page);
    if (n === 1 && items.length === 0 && options.mustHaveListings) {
      throw await loader.formatError(page, "no listings found; did the page change?");
    }
    const fresh = items.filter((item) => !inList.has(item.id));
    for (const item of fresh) {
      inList.add(item.id);
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      yield item;
    }
    if (fresh.length === 0) return;
  }
}

/** Wraps list items as raw listings: facts only, as the item holds them. */
export function toRaw<T extends ListItem>(item: T, segment?: string): RawListing {
  return { externalId: item.id, payload: item as unknown as Record<string, unknown>, ...(segment ? { segment } : {}) };
}

/** What a card-based adapter stores per listing. */
export interface CardItem extends CardFacts, ListItem {
  url: string;
  title: string;
  /** Our make slug when the list was a make's list. */
  listMake: string | null;
  /** Address of the card's preview photo. */
  image: string | null;
}

export interface CardNormalizeOptions {
  sourceId: string;
  /** The source's image server domain; preview photos elsewhere are dropped. */
  imageHost: string;
  sellerType: SellerType | null;
  sellerName: string | null;
  /** Lowest price that can be a car rather than a part or a monthly rate. */
  minPrice?: number;
  /** Also require mileage or first registration, for lists that mix in parts and accessories. */
  requireVehicleFacts?: boolean;
}

/** Maps a card's facts and title onto the common format; null when it is no usable car. */
export function normalizeCard(item: CardItem, options: CardNormalizeOptions): NormalizedListing | null {
  if (item.price === null || item.price < (options.minPrice ?? 300)) return null;
  if (options.requireVehicleFacts && item.mileageKm === null && item.firstRegistration === null) return null;
  // On the whole title: a "Leasingübernahme" past the 200 characters stored would be cut off below.
  if (isNotForSale(item.title)) return null;

  const fromTitle = findMakeInTitle(item.title);
  const listMake = item.listMake ? resolveMake(item.listMake) : null;
  const make = listMake ?? fromTitle?.make ?? null;
  const rest = fromTitle && (!listMake || fromTitle.make.slug === listMake.slug) ? fromTitle.rest : item.title;
  const resolved = make ? resolveModelInTitle(make.name, rest) : { makeSlug: null, modelSlug: null, variant: null };
  const titlePower = parsePowerKw(item.title);

  return plausibleListing({
    sourceId: options.sourceId,
    externalId: item.id,
    url: item.url,
    title: item.title.slice(0, 200),
    makeSlug: resolved.makeSlug,
    modelSlug: resolved.modelSlug,
    makeRaw: make?.name ?? "",
    modelRaw: rest.slice(0, 200),
    variant: resolved.variant?.slice(0, 160) ?? null,
    priceEur: item.price,
    mileageKm: item.mileageKm,
    firstRegistration: parseFirstRegistration(item.firstRegistration),
    firstRegistrationYearOnly: isYearOnlyRegistration(item.firstRegistration),
    fuel: item.fuel ?? detectFuel(item.title),
    transmission: item.transmission ?? detectTransmission(item.title),
    powerKw: item.powerKw ?? (titlePower !== null && titlePower >= 20 && titlePower <= 1000 ? titlePower : null),
    bodyType: detectBodyType(item.title),
    color: null,
    sellerType: options.sellerType,
    sellerName: options.sellerType === "dealer" ? options.sellerName : null,
    zip: item.zip,
    city: item.city,
    lat: null,
    lng: null,
    imageUrl: sourceImageUrl(item.image, options.imageHost),
  });
}

/** The page URLs listed in a sitemap (<loc> entries), entities decoded. */
export function readSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) =>
    match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"),
  );
}

/**
 * The share of a long page list for this run: `count` entries from an offset that moves on by
 * `count` every `slotMs`, wrapping around. Consecutive runs so cover the whole list in turn
 * without keeping any state.
 */
export function rotate<T>(items: T[], count: number, now = Date.now(), slotMs = 3_600_000): T[] {
  if (items.length <= count) return [...items];
  const offset = (Math.floor(now / slotMs) * count) % items.length;
  return Array.from({ length: count }, (_, i) => items[(offset + i) % items.length]);
}
