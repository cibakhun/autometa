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
import { crawlPriceSegments, type PriceRange } from "../price-segments";

/**
 * AutoScout24 (www.autoscout24.de), read through its result lists /lst/<make>, which its
 * robots.txt allows for every crawler. Detail pages (/angebote/) are not allowed and are never
 * requested; users reach them through our link.
 *
 * Each run reads the newest listings per make and then whole make × price-range segments in
 * rotation (see crawlPriceSegments in ../price-segments). Listings not seen for staleAfterDays are
 * taken out as well, as a safety net.
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

/** This many failed pages in a row stop the run: the site is probably down or has changed. */
const MAX_FAILURES_IN_A_ROW = 3;

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
export function listUrl(make: string, page: number, price?: PriceRange): string {
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

export function defaultAutoScout24Makes(): string[] {
  return MAKES.map((make) => make.slug);
}

export function createAutoScout24Adapter(options: AutoScout24Options): SourceAdapter {
  const { fetcher } = options;
  const makes = options.makes ?? defaultAutoScout24Makes();
  const newestPages = options.newestPages ?? 1;
  const maxPagesPerSegment = options.maxPagesPerSegment ?? 20;
  const log = options.log ?? (() => undefined);
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

  return {
    source: AUTOSCOUT24,
    fullSnapshot: false,
    staleAfterDays: options.staleAfterDays ?? 30,
    normalize: normalizeAutoScout24,
    completedSegments: () => completed,
    async *fetch(context?: FetchContext) {
      if (!context) throw new Error("AutoScout24 needs the import's database connection");
      completed = [];
      failuresInARow = 0;
      try {
        yield* crawlPriceSegments<AutoScout24Item>(
          {
            sourceId: AUTOSCOUT24.id,
            db: context.db,
            makes,
            pageSize: PAGE_SIZE,
            maxPagesPerSegment,
            newestPages,
            requestsLeft: () => fetcher.requestsLeft,
            loadPage: (make, page, price) => load(listUrl(make, page, price)),
            itemId: (item) => item.id,
            itemPrice: (item) => item.price,
            isOrganic: (item) => item.organic,
            toRaw: (item, segment) => ({ externalId: item.id, payload: item as unknown as Record<string, unknown>, segment }),
            log,
          },
          completed,
        );
      } catch (error) {
        // The budget ends the run quietly; everything read so far is kept.
        if (!(error instanceof BudgetExceededError)) throw error;
      }
      log(`requests: ${fetcher.requestsMade}, segments read completely: ${completed.length}`);
    },
  };
}
