import {
  detectBodyType,
  normalizeFuel,
  normalizeTransmission,
  parseFirstRegistration,
  parseInteger,
  parsePowerKw,
  resolveMakeModel,
} from "@/core/normalize";
import { MAKES } from "@/core/taxonomy";
import type { NormalizedListing, SellerType } from "@/core/types";
import type { FetchContext, RawListing, SourceAdapter, SourceInfo } from "../adapter";
import { BlockedError, BudgetExceededError, DisallowedError, HttpStatusError, type PoliteFetcher } from "../http/fetcher";
import { SegmentStore, type Segment, type SegmentDraft } from "../segments";

/**
 * AutoScout24 (www.autoscout24.de), read through its result lists /lst/<make>, which its
 * robots.txt allows for every crawler. Detail pages (/angebote/) are not allowed and are never
 * requested; users reach them through our link.
 *
 * Each run does two things within the request budget:
 * 1. "Newest": the first result pages per make, newest first, so fresh listings appear quickly.
 * 2. "Sweep": whole segments (make and price range) in rotation, page by page. A segment with more
 *    results than the portal lets us page through is split into smaller price ranges. Once a
 *    segment was read to the end and every listing it reported came in, listings of that segment
 *    we did not see count as missed; after two misses in a row they are taken out of the search.
 * Listings not seen for staleAfterDays are taken out as well, as a safety net.
 */

export const AUTOSCOUT24: SourceInfo = {
  id: "autoscout24",
  name: "AutoScout24",
  kind: "scrape",
  websiteUrl: "https://www.autoscout24.de",
};

const ORIGIN = "https://www.autoscout24.de";
/** Listings per result page on AutoScout24. */
export const PAGE_SIZE = 20;

/** AutoScout24's URL name per make, where it differs from our slug. */
const MAKE_PATHS: Record<string, string> = {
  ds: "ds-automobiles",
};

/** First split of a whole make into price ranges (EUR); later splits halve a range. */
const PRICE_LADDER = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 14000, 16000, 18000, 20000, 23000, 26000, 30000, 35000, 40000, 50000, 60000, 80000, 100000];
/** Ranges narrower than this are not split any further. */
const MIN_RANGE_EUR = 200;
/** This many failed pages in a row stop the run: the site is probably down or has changed. */
const MAX_FAILURES_IN_A_ROW = 3;

export interface SweepParams {
  make: string;
  /** Lowest price, inclusive. */
  priceFrom: number;
  /** Highest price, exclusive; null means no upper limit. */
  priceTo: number | null;
}

export interface AutoScout24Options {
  fetcher: PoliteFetcher;
  /** Our make slugs to read. Defaults to every make of the taxonomy. */
  makes?: string[];
  /** Newest pages per make and run. */
  newestPages?: number;
  /** Most result pages we read per segment; AutoScout24 itself stops somewhere around 20. */
  maxPagesPerSegment?: number;
  staleAfterDays?: number;
  log?: (message: string) => void;
}

/** One result list entry as we store it: facts only, no photos, texts or contact data. */
export interface AutoScout24Item {
  id: string;
  url: string;
  make: string;
  model: string;
  modelGroup: string | null;
  motor: string | null;
  version: string | null;
  offerType: string | null;
  price: number | null;
  mileage: string | null;
  firstRegistration: string | null;
  fuel: string | null;
  transmission: string | null;
  power: string | null;
  sellerType: string | null;
  dealerName: string | null;
  zip: string | null;
  city: string | null;
  countryCode: string | null;
  /** False for ads AutoScout24 mixes into the list regardless of the filters. */
  organic: boolean;
}

export interface AutoScout24Page {
  items: AutoScout24Item[];
  total: number;
  pages: number;
}

/** Thrown when a result page does not have the structure this adapter expects. */
export class PageFormatError extends Error {
  constructor(url: string, detail: string) {
    super(`Unexpected AutoScout24 page at ${url}: ${detail}`);
    this.name = "PageFormatError";
  }
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** Reads the result list from the page's embedded Next.js data. */
export function parseAutoScout24Page(html: string, url = ORIGIN): AutoScout24Page {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new PageFormatError(url, "no __NEXT_DATA__ script");
  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    throw new PageFormatError(url, "__NEXT_DATA__ is not valid JSON");
  }
  const pageProps = obj(obj(obj(data).props).pageProps);
  if (!Array.isArray(pageProps.listings)) throw new PageFormatError(url, "no listings array");
  // Without these counts we cannot tell whether a segment was read completely.
  const total = pageProps.numberOfResults;
  const pages = pageProps.numberOfPages;
  if (!isCount(total) || !isCount(pages)) throw new PageFormatError(url, "no result or page count");
  if (total > 0 && pages < 1) throw new PageFormatError(url, `${total} results on ${pages} pages`);

  const items: AutoScout24Item[] = [];
  for (const entry of pageProps.listings) {
    const listing = obj(entry);
    const vehicle = obj(listing.vehicle);
    const id = str(listing.id);
    const path = str(listing.url);
    const make = str(vehicle.make);
    const model = str(vehicle.model) ?? str(vehicle.modelGroup);
    if (!id || !path || !make || !model) continue;

    const details = new Map<string, string>();
    for (const detail of Array.isArray(listing.vehicleDetails) ? listing.vehicleDetails : []) {
      const icon = str(obj(detail).iconName);
      const value = str(obj(detail).data);
      if (icon && value) details.set(icon, value);
    }
    const tracking = obj(listing.tracking);
    const price = obj(listing.price);
    const seller = obj(listing.seller);
    const location = obj(listing.location);
    const sellerType = str(seller.type);
    const rawPrice = typeof price.priceRaw === "number" ? price.priceRaw : parseInteger(str(price.priceFormatted));

    items.push({
      id,
      url: new URL(path, ORIGIN).href,
      make,
      model,
      modelGroup: str(vehicle.modelGroup),
      motor: str(vehicle.motorTypeName),
      version: str(vehicle.modelVersionInput),
      offerType: str(vehicle.offerType),
      price: rawPrice,
      mileage: str(vehicle.mileageInKm) ?? details.get("mileage_odometer") ?? str(tracking.mileage),
      firstRegistration: details.get("calendar") ?? str(tracking.firstRegistration),
      fuel: str(vehicle.fuel) ?? details.get("gas_pump") ?? null,
      transmission: str(vehicle.transmission) ?? details.get("gearbox") ?? null,
      power: details.get("speedometer") ?? null,
      sellerType,
      // Company names only; private sellers' names are never stored.
      dealerName: sellerType === "Dealer" ? str(seller.companyName) : null,
      zip: str(location.zip),
      city: str(location.city),
      countryCode: str(location.countryCode),
      organic: (str(listing.searchResultType) ?? "Organic") === "Organic",
    });
  }
  return { items, total, pages };
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

const cleanText = (value: string | null) => (value ? value.replace(/[*|]+/g, " ").replace(/\s+/g, " ").trim() || null : null);

export function normalizeAutoScout24(raw: RawListing): NormalizedListing | null {
  const item = raw.payload as unknown as AutoScout24Item;
  if (item.price === null || item.price < 100) return null;

  const resolved = resolveMakeModel(item.make, item.modelGroup ?? item.model);
  const byModel = resolved.modelSlug ? resolved : resolveMakeModel(item.make, item.model);
  const version = cleanText(item.version);
  const variant = [cleanText(item.motor), version].filter(Boolean).join(" ").slice(0, 160) || null;
  const title = [item.make, item.model, variant].filter(Boolean).join(" ").slice(0, 200);
  const sellerType: SellerType | null = item.sellerType === "Dealer" ? "dealer" : item.sellerType === "Private" ? "private" : null;

  return {
    sourceId: AUTOSCOUT24.id,
    externalId: item.id,
    url: item.url,
    title,
    makeSlug: byModel.makeSlug,
    modelSlug: byModel.modelSlug,
    makeRaw: item.make,
    modelRaw: item.model,
    variant,
    priceEur: item.price,
    mileageKm: parseInteger(item.mileage),
    firstRegistration: parseFirstRegistration(item.firstRegistration),
    fuel: item.fuel ? normalizeFuel(item.fuel) : null,
    transmission: normalizeTransmission(item.transmission),
    powerKw: parsePowerKw(item.power),
    bodyType: detectBodyType(`${item.model} ${version ?? ""}`),
    color: null,
    sellerType,
    sellerName: sellerType === "dealer" ? item.dealerName : null,
    zip: item.countryCode === null || item.countryCode === "DE" ? item.zip : null,
    city: item.city,
    lat: null,
    lng: null,
  };
}

/** The result list URL for a make, newest first, optionally limited to a price range. */
export function listUrl(make: string, page: number, price?: { from: number; to: number | null }): string {
  const url = new URL(`/lst/${MAKE_PATHS[make] ?? make}`, ORIGIN);
  url.searchParams.set("atype", "C");
  url.searchParams.set("cy", "D");
  url.searchParams.set("desc", "1");
  url.searchParams.set("sort", "age");
  if (price && price.from > 0) url.searchParams.set("pricefrom", String(price.from));
  if (price && price.to !== null) url.searchParams.set("priceto", String(price.to - 1));
  if (page > 1) url.searchParams.set("page", String(page));
  return url.href;
}

export function segmentKey({ make, priceFrom, priceTo }: SweepParams): string {
  return `${make}:${priceFrom}-${priceTo ?? ""}`;
}

/** Smaller price ranges replacing one that has too many results, or [] when it cannot be split. */
export function splitSegment(params: SweepParams): SweepParams[] {
  const { make, priceFrom, priceTo } = params;
  if (priceFrom === 0 && priceTo === null) {
    return PRICE_LADDER.map((from, i) => ({ make, priceFrom: from, priceTo: PRICE_LADDER[i + 1] ?? null }));
  }
  if (priceTo === null) {
    return [
      { make, priceFrom, priceTo: priceFrom * 2 },
      { make, priceFrom: priceFrom * 2, priceTo: null },
    ];
  }
  if (priceTo - priceFrom < MIN_RANGE_EUR) return [];
  const middle = Math.round((priceFrom + priceTo) / 2 / 100) * 100;
  const cut = middle > priceFrom && middle < priceTo ? middle : Math.floor((priceFrom + priceTo) / 2);
  return [
    { make, priceFrom, priceTo: cut },
    { make, priceFrom: cut, priceTo },
  ];
}

const inRange = (price: number | null, { priceFrom, priceTo }: SweepParams) =>
  price !== null && price >= priceFrom && (priceTo === null || price < priceTo);

export function defaultAutoScout24Makes(): string[] {
  return MAKES.map((make) => make.slug);
}

export function createAutoScout24Adapter(options: AutoScout24Options): SourceAdapter {
  const { fetcher } = options;
  const makes = options.makes ?? defaultAutoScout24Makes();
  const newestPages = options.newestPages ?? 1;
  const maxPagesPerSegment = options.maxPagesPerSegment ?? 20;
  const log = options.log ?? (() => undefined);
  let store!: SegmentStore<SweepParams>;
  let completed: string[] = [];
  let failuresInARow = 0;

  /** One result page, or null when this page is skipped (not allowed, missing, broken connection). */
  async function load(url: string): Promise<AutoScout24Page | null> {
    try {
      const page = await fetcher.getText(url);
      failuresInARow = 0;
      return parseAutoScout24Page(page.text, url);
    } catch (error) {
      if (error instanceof BlockedError || error instanceof BudgetExceededError || error instanceof PageFormatError) throw error;
      if (error instanceof DisallowedError) {
        log(`skipped (robots.txt): ${url}`);
        return null;
      }
      if (error instanceof HttpStatusError && error.status < 500) {
        // For example an unknown make: skip it, the site itself is fine.
        log(`skipped (HTTP ${error.status}): ${url}`);
        return null;
      }
      failuresInARow += 1;
      log(`failed: ${url}: ${error instanceof Error ? error.message : String(error)}`);
      if (failuresInARow >= MAX_FAILURES_IN_A_ROW) throw error;
      return null;
    }
  }

  function toRaw(item: AutoScout24Item, segment?: string): RawListing {
    return { externalId: item.id, payload: item as unknown as Record<string, unknown>, segment };
  }

  async function* newest(): AsyncGenerator<RawListing> {
    for (const make of makes) {
      for (let page = 1; page <= newestPages; page += 1) {
        if (fetcher.requestsLeft < 1) return;
        const result = await load(listUrl(make, page));
        if (!result) break;
        for (const item of result.items) yield toRaw(item);
        if (page >= result.pages) break;
      }
    }
  }

  async function* sweep(segment: Segment<SweepParams>): AsyncGenerator<RawListing> {
    const params = segment.params;
    const price = { from: params.priceFrom, to: params.priceTo };
    const first = await load(listUrl(params.make, 1, price));
    if (!first) return;
    await store.started(segment.key, first.total);

    const reachablePages = Math.min(first.pages, maxPagesPerSegment);
    if (first.total > reachablePages * PAGE_SIZE) {
      const children = splitSegment(params);
      if (children.length > 0) {
        await store.split(
          segment.key,
          children.map((child) => ({ key: segmentKey(child), params: child })),
        );
        log(`split ${segment.key} (${first.total} results) into ${children.length} price ranges`);
        // The page is still useful; its listings get their segment once the smaller ranges are read.
        for (const item of first.items) yield toRaw(item);
        return;
      }
    }

    const seen = new Set<string>();
    const emit = function* (items: AutoScout24Item[]) {
      for (const item of items) {
        const own = item.organic && inRange(item.price, params);
        if (own) seen.add(item.id);
        yield toRaw(item, own ? segment.key : undefined);
      }
    };
    yield* emit(first.items);

    const lastPage = Math.min(reachablePages, Math.ceil(first.total / PAGE_SIZE));
    for (let page = 2; page <= lastPage; page += 1) {
      if (fetcher.requestsLeft < 1) return;
      const result = await load(listUrl(params.make, page, price));
      if (!result) return;
      yield* emit(result.items);
      if (result.items.length === 0) break;
    }

    // Only a read that saw every reported listing may count the others as sold. Listings that moved
    // between pages while we read leave the segment incomplete for this run.
    if (first.total <= reachablePages * PAGE_SIZE && seen.size >= first.total) {
      completed.push(segment.key);
      await store.completed(segment.key);
    }
  }

  return {
    source: AUTOSCOUT24,
    fullSnapshot: false,
    staleAfterDays: options.staleAfterDays ?? 30,
    normalize: normalizeAutoScout24,
    completedSegments: () => completed,
    async *fetch(context?: FetchContext) {
      if (!context) throw new Error("AutoScout24 needs the import's database connection");
      store = new SegmentStore<SweepParams>(context.db, AUTOSCOUT24.id);
      completed = [];
      failuresInARow = 0;
      try {
        yield* newest();
        await store.ensure(makes.map((make) => root(make)));
        const wanted = new Set(makes);
        const done = new Set<string>();
        // Read the plan again after every segment: a split adds smaller segments to read next.
        for (;;) {
          // Page 1 alone may split the segment; keep one request for it and one more for page 2.
          if (fetcher.requestsLeft < 2) break;
          const next = (await store.active()).find((s) => wanted.has(s.params.make) && !done.has(s.key));
          if (!next) break;
          done.add(next.key);
          yield* sweep(next);
        }
      } catch (error) {
        // The budget ends the run quietly; everything read so far is kept.
        if (!(error instanceof BudgetExceededError)) throw error;
      }
      log(`requests: ${fetcher.requestsMade}, segments read completely: ${completed.length}`);
    },
  };
}

function root(make: string): SegmentDraft<SweepParams> {
  const params = { make, priceFrom: 0, priceTo: null };
  return { key: segmentKey(params), params };
}
