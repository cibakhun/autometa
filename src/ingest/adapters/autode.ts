import {
  normalizeBodyType,
  normalizeFuel,
  normalizeTransmission,
  parseFirstRegistration,
  psToKw,
  resolveMakeModel,
  resolveModelInTitle,
  sourceImageUrl,
} from "@/core/normalize";
import type { NormalizedListing } from "@/core/types";
import type { FetchContext, RawListing, SourceAdapter, SourceInfo } from "../adapter";
import { readJsonLd } from "../http/cards";
import { BudgetExceededError, type PoliteFetcher } from "../http/fetcher";
import { PageLoader, readSitemapLocs, rotate, toRaw } from "./list-crawler";

/**
 * auto.de, a marketplace for dealer cars. Its robots.txt forbids the search (/search/), but allows
 * the offer pages (/angebot/<make>/<model>/...), which its own sitemap lists. Each of these pages
 * describes about 15 cars for search engines (schema.org ItemList of Car); every run reads a
 * rotating share of the pages. Only the facts are kept: no VIN, description or dealer contacts,
 * and of the photos only the address of the small preview. New cars are left out. The cars'
 * place is not on these pages.
 */

export const AUTODE: SourceInfo = {
  id: "autode",
  name: "auto.de",
  kind: "scrape",
  websiteUrl: "https://www.auto.de",
};

const ORIGIN = "https://www.auto.de";
export const SITEMAP_URL = `${ORIGIN}/angebot/sitemap.xml`;
const DETAIL = /^\/search\/vehicle\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/;

export interface AutoDeItem {
  id: string;
  url: string;
  title: string;
  make: string;
  model: string;
  variant: string | null;
  price: number;
  mileageKm: number | null;
  /** "MM/YYYY" or "YYYY". */
  firstRegistration: string | null;
  fuel: string | null;
  transmission: string | null;
  powerKw: number | null;
  bodyType: string | null;
  color: string | null;
  /** Address of the small preview photo on auto.de's image server. */
  image: string | null;
}

type Json = Record<string, unknown>;
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const obj = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null);

const HALF_A_DAY_MS = 12 * 3_600_000;

/**
 * Unix seconds, milliseconds or an ISO date -> "MM/YYYY". A first day of the month at midnight in
 * Germany is the evening before in UTC, so half a day is added before the month is read.
 */
function registration(value: unknown): string | null {
  const n = num(value);
  const ms = n !== null ? (n < 1e11 ? n * 1000 : n) : text(value) ? Date.parse(String(value)) : NaN;
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms + HALF_A_DAY_MS);
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

/** schema.org image: an address, a list of them or an ImageObject; the first address. */
function firstImage(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return text(first) ?? text(obj(first)?.url) ?? text(obj(first)?.contentUrl);
}

/** schema.org enginePower: KWT is kW; N12 (metric horsepower), BHP and PS are horsepower. */
function power(value: unknown): number | null {
  const spec = obj(value);
  const amount = num(spec?.value);
  if (amount === null || amount <= 0) return null;
  const unit = text(spec?.unitCode)?.toUpperCase() ?? "KWT";
  const kw = unit === "KWT" || unit === "KW" ? Math.round(amount) : psToKw(amount);
  return kw >= 20 && kw <= 1000 ? kw : null;
}

export function parseAutoDePage(html: string): AutoDeItem[] {
  const items: AutoDeItem[] = [];
  for (const car of readJsonLd(html)) {
    if (car["@type"] !== "Car") continue;
    const offers = obj(Array.isArray(car.offers) ? car.offers[0] : car.offers);
    const url = text(car.url) ?? text(offers?.url);
    let id: string | null = null;
    try {
      id = url ? (new URL(url, ORIGIN).pathname.match(DETAIL)?.[1] ?? null) : null;
    } catch {
      id = null;
    }
    const price = num(offers?.price);
    const make = text(obj(car.brand)?.name) ?? text(car.brand) ?? text(car.manufacturer);
    const model = text(car.model);
    if (!id || !url || price === null || !make || !model) continue;
    if (/NewCondition/i.test(text(car.itemCondition) ?? "")) continue;
    const odometer = obj(car.mileageFromOdometer);
    const km = num(odometer?.value);
    const year = num(car.vehicleModelDate);
    items.push({
      id,
      url: new URL(url, ORIGIN).href,
      title: (text(car.name) ?? `${make} ${model}`).slice(0, 200),
      make,
      model,
      variant: text(car.vehicleConfiguration)?.slice(0, 160) ?? null,
      price: Math.round(price),
      mileageKm: km !== null && km >= 0 ? Math.round(km) : null,
      firstRegistration: registration(car.dateVehicleFirstRegistered) ?? (year ? String(year) : null),
      fuel: text(car.fuelType),
      transmission: text(car.vehicleTransmission),
      powerKw: power(obj(car.vehicleEngine)?.enginePower),
      bodyType: text(car.bodyType),
      color: text(car.color)?.slice(0, 40) ?? null,
      image: firstImage(car.image),
    });
  }
  return items;
}

/** The offer pages of the sitemap, on https. */
export function offerPages(xml: string): string[] {
  return readSitemapLocs(xml).flatMap((loc) => {
    try {
      const url = new URL(loc);
      if (!url.hostname.endsWith("auto.de") || !url.pathname.startsWith("/angebot/")) return [];
      url.protocol = "https:";
      return [url.href];
    } catch {
      return [];
    }
  });
}

export function normalizeAutoDe(raw: RawListing): NormalizedListing | null {
  const item = raw.payload as unknown as AutoDeItem;
  if (item.price < 300) return null;
  const byModel = resolveMakeModel(item.make, item.model);
  const resolved = byModel.modelSlug ? byModel : resolveModelInTitle(item.make, `${item.model} ${item.variant ?? ""}`.trim());
  return {
    sourceId: AUTODE.id,
    externalId: item.id,
    url: item.url,
    title: item.title,
    makeSlug: resolved.makeSlug,
    modelSlug: resolved.modelSlug,
    makeRaw: item.make,
    modelRaw: item.model,
    variant: item.variant,
    priceEur: item.price,
    mileageKm: item.mileageKm,
    firstRegistration: parseFirstRegistration(item.firstRegistration),
    fuel: normalizeFuel(item.fuel),
    transmission: normalizeTransmission(item.transmission),
    powerKw: item.powerKw,
    bodyType: normalizeBodyType(item.bodyType),
    color: item.color,
    // auto.de lists dealer cars; the dealer's name is not on the offer pages.
    sellerType: "dealer",
    sellerName: null,
    zip: null,
    city: null,
    lat: null,
    lng: null,
    imageUrl: sourceImageUrl(item.image, "auto.de"),
  };
}

export interface AutoDeOptions {
  fetcher: PoliteFetcher;
  /** Offer pages read per run; the rest follow in the next runs. */
  pagesPerRun?: number;
  staleAfterDays?: number;
  log?: (message: string) => void;
  now?: () => number;
}

/** Pages read without a single car before the run decides the page format changed. */
const PAGES_BEFORE_FORMAT_ERROR = 10;

export function createAutoDeAdapter(options: AutoDeOptions): SourceAdapter {
  const log = options.log ?? (() => undefined);
  const pagesPerRun = options.pagesPerRun ?? 300;
  const now = options.now ?? Date.now;

  return {
    source: AUTODE,
    fullSnapshot: false,
    // About 2,000 offer pages at 300 per hourly run: every page comes round within a day.
    staleAfterDays: options.staleAfterDays ?? 2,
    normalize: normalizeAutoDe,
    async *fetch(context?: FetchContext): AsyncGenerator<RawListing> {
      const loader = new PageLoader(AUTODE.id, options.fetcher, log, context?.db);
      const seen = new Set<string>();
      try {
        const sitemap = await loader.load(SITEMAP_URL);
        if (!sitemap) throw new Error(`auto.de: sitemap ${SITEMAP_URL} not available`);
        const pages = offerPages(sitemap.text);
        if (pages.length === 0) throw await loader.formatError(sitemap, "no offer pages in the sitemap; did it change?");
        const share = rotate(pages, pagesPerRun, now());
        log(`offer pages: ${share.length} of ${pages.length}`);
        let read = 0;
        for (const url of share) {
          if (loader.requestsLeft < 1) return;
          const page = await loader.load(url);
          if (!page) continue;
          read += 1;
          const items = parseAutoDePage(page.text);
          if (seen.size === 0 && items.length === 0 && read >= PAGES_BEFORE_FORMAT_ERROR) {
            throw await loader.formatError(page, `no cars on ${read} offer pages; did the page change?`);
          }
          for (const item of items) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            yield toRaw(item);
          }
        }
      } catch (error) {
        if (!(error instanceof BudgetExceededError)) throw error;
      } finally {
        log(`requests: ${loader.requestsMade}, listings: ${seen.size}`);
      }
    },
  };
}
