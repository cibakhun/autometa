import { normalizeText, resolveMakeModel } from "@/core/normalize";
import { MAKES } from "@/core/taxonomy";
import type { BodyType, Fuel, NormalizedListing, SellerType, Transmission } from "@/core/types";
import type { FetchContext, RawListing, SourceAdapter, SourceInfo } from "../adapter";
import { readNumber } from "../http/config";
import { BlockedError, BudgetExceededError, DEFAULT_USER_AGENT, HttpStatusError } from "../http/fetcher";
import { crawlPriceSegments, type ListPage, type PriceRange } from "../price-segments";

/**
 * mobile.de, read only through its official Search-API (https://services.mobile.de/docs/search-api.html)
 * with an API account that mobile.de grants. mobile.de's terms forbid scraping and its robots.txt
 * blocks the search pages, so without MOBILE_DE_API_USER and MOBILE_DE_API_PASSWORD this source
 * does not run at all.
 *
 * The API returns at most 2000 results per query, so the inventory is read like AutoScout24's:
 * newest changes per make first, then make × price-range segments in rotation (crawlPriceSegments).
 * Stored are facts only: no photos, description texts, phone numbers or e-mail addresses, and a
 * seller name only for dealers. Every listing links to its page on mobile.de.
 */

export const MOBILE_DE: SourceInfo = {
  id: "mobilede",
  name: "mobile.de",
  kind: "api",
  websiteUrl: "https://www.mobile.de",
};

const API_ORIGIN = "https://services.mobile.de";
const ACCEPT = "application/vnd.de.mobile.api+json";
/** Ads per request; the most the Search-API allows. */
export const MOBILE_DE_PAGE_SIZE = 100;
/** The Search-API pages through at most this many results of one query. */
const MAX_RESULTS_PER_QUERY = 2000;
/** This many failed requests in a row stop the run: the API is probably down. */
const MAX_FAILURES_IN_A_ROW = 3;

/** mobile.de's make keys (refdata/classes/Car/makes) for the makes of our taxonomy. */
export const MOBILE_DE_MAKE_KEYS: Record<string, string> = {
  volkswagen: "VW",
  "mercedes-benz": "MERCEDES-BENZ",
  bmw: "BMW",
  audi: "AUDI",
  opel: "OPEL",
  ford: "FORD",
  skoda: "SKODA",
  seat: "SEAT",
  cupra: "CUPRA",
  renault: "RENAULT",
  peugeot: "PEUGEOT",
  citroen: "CITROEN",
  ds: "DS",
  toyota: "TOYOTA",
  lexus: "LEXUS",
  hyundai: "HYUNDAI",
  kia: "KIA",
  fiat: "FIAT",
  abarth: "ABARTH",
  "alfa-romeo": "ALFA ROMEO",
  dacia: "DACIA",
  mazda: "MAZDA",
  nissan: "NISSAN",
  honda: "HONDA",
  mitsubishi: "MITSUBISHI",
  suzuki: "SUZUKI",
  subaru: "SUBARU",
  volvo: "VOLVO",
  polestar: "POLESTAR",
  tesla: "TESLA",
  byd: "BYD",
  mg: "MG",
  porsche: "PORSCHE",
  mini: "MINI",
  smart: "SMART",
  "land-rover": "LAND ROVER",
  jaguar: "JAGUAR",
  jeep: "JEEP",
  chevrolet: "CHEVROLET",
};

/** One ad as we store it: facts only. */
export interface MobileDeItem {
  id: string;
  url: string;
  /** mobile.de's make key, e.g. "VW". */
  make: string;
  model: string;
  /** The ad's short title as the seller wrote it, e.g. "Golf 1.4 TSI Comfortline". */
  title: string | null;
  price: number | null;
  mileage: number | null;
  /** yyyyMM */
  firstRegistration: string | null;
  fuel: string | null;
  pluginHybrid: boolean;
  gearbox: string | null;
  power: number | null;
  category: string | null;
  condition: string | null;
  sellerType: string | null;
  /** Company name, for dealers only. */
  dealerName: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
}

/** The API answered with something this adapter does not understand, or reported query errors. */
export class ApiFormatError extends Error {
  constructor(url: string, detail: string) {
    super(`Unexpected mobile.de Search-API answer for ${url}: ${detail}`);
    this.name = "ApiFormatError";
  }
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const int = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Query values keep "/" readable and encode everything else once ("ALFA ROMEO" -> ALFA%20ROMEO). */
const encode = (value: string) => encodeURIComponent(value).replace(/%2F/g, "/");

/** The search URL for one make, most recently changed first, optionally limited to a price range. */
export function searchUrl(make: string, page: number, price?: PriceRange, pageSize = MOBILE_DE_PAGE_SIZE): string {
  const key = MOBILE_DE_MAKE_KEYS[make];
  if (!key) throw new Error(`No mobile.de make key for "${make}"`);
  const params: [string, string][] = [
    ["classification", `refdata/classes/Car/makes/${key}`],
    ["country", "DE"],
    ["sort.field", "modificationTime"],
    ["sort.order", "DESCENDING"],
    ["page.size", String(pageSize)],
    ["page.number", String(page)],
  ];
  if (price && price.from > 0) params.push(["price.min", String(price.from)]);
  // Our ranges end below `to`; prices have cents.
  if (price && price.to !== null) params.push(["price.max", (price.to - 0.01).toFixed(2)]);
  return `${API_ORIGIN}/search-api/search?${params.map(([name, value]) => `${name}=${encode(value)}`).join("&")}`;
}

/** Only links to mobile.de itself are kept, so /go/[id] never forwards anywhere else. */
function isMobileDeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "mobile.de" || url.hostname.endsWith(".mobile.de"));
  } catch {
    return false;
  }
}

function parsePrice(price: Json): number | null {
  const currency = str(price.currency);
  if (currency !== null && currency !== "EUR") return null;
  const gross = price.consumerPriceGross;
  const value = typeof gross === "number" ? gross : typeof gross === "string" ? Number(gross) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Reads one search answer in the "new JSON" format. */
export function parseMobileDeSearch(json: unknown, url = API_ORIGIN): ListPage<MobileDeItem> {
  const data = obj(json);
  // An invalid filter may be ignored by the API, which would make a price segment look complete.
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    throw new ApiFormatError(url, `query errors ${JSON.stringify(data.errors).slice(0, 300)}`);
  }
  if (!Array.isArray(data.ads)) throw new ApiFormatError(url, "no ads array");
  const total = data.total;
  const pages = data.maxPages;
  if (!isCount(total) || !isCount(pages)) throw new ApiFormatError(url, "no result or page count");
  if (total > 0 && pages < 1) throw new ApiFormatError(url, `${total} results on ${pages} pages`);

  const items: MobileDeItem[] = [];
  for (const entry of data.ads) {
    const ad = obj(entry);
    const id = str(ad.mobileAdId);
    const link = str(ad.detailPageUrl);
    const make = str(ad.make);
    const model = str(ad.model) ?? str(ad.modelDescription);
    if (!id || !link || !make || !model || !isMobileDeUrl(link)) continue;
    const seller = obj(ad.seller);
    const address = obj(seller.address);
    const sellerType = str(seller.type) ?? (seller.commercial === true ? "DEALER" : seller.commercial === false ? "FOR_SALE_BY_OWNER" : null);
    items.push({
      id,
      url: link,
      make,
      model,
      title: str(ad.modelDescription)?.slice(0, 160) ?? null,
      price: parsePrice(obj(ad.price)),
      mileage: int(ad.mileage),
      firstRegistration: str(ad.firstRegistration),
      fuel: str(ad.fuel),
      pluginHybrid: ad.hybridPlugin === true,
      gearbox: str(ad.gearbox),
      power: int(ad.power),
      category: str(ad.category),
      condition: str(ad.condition),
      sellerType,
      // Company names only; private sellers' names, phones and e-mail addresses are never stored.
      dealerName: sellerType === "DEALER" ? str(seller.companyName) : null,
      zip: str(address.zipcode),
      city: str(address.city),
      country: str(address.country),
    });
  }
  return { items, total, pages };
}

const FUELS: Record<string, Fuel> = {
  PETROL: "petrol",
  DIESEL: "diesel",
  ELECTRICITY: "electric",
  HYBRID: "hybrid",
  HYBRID_DIESEL: "hybrid",
  LPG: "lpg",
  CNG: "cng",
  HYDROGENIUM: "hydrogen",
  ETHANOL: "other",
  OTHER: "other",
};

const GEARBOXES: Record<string, Transmission> = {
  MANUAL_GEAR: "manual",
  AUTOMATIC_GEAR: "automatic",
  SEMIAUTOMATIC_GEAR: "automatic",
};

const CATEGORIES: Record<string, BodyType> = {
  Cabrio: "convertible",
  EstateCar: "estate",
  Limousine: "sedan",
  OffRoad: "suv",
  SmallCar: "small",
  SportsCar: "coupe",
  Van: "van",
  OtherCar: "other",
};

const SELLER_TYPES: Record<string, SellerType> = {
  DEALER: "dealer",
  FOR_SALE_BY_OWNER: "private",
};

/** "202007" -> "2020-07-01" */
function firstRegistrationDate(value: string | null): string | null {
  const match = value?.match(/^(\d{4})(\d{2})$/);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}-01` : null;
}

const titleCase = (value: string) => value.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());

export function normalizeMobileDe(raw: RawListing): NormalizedListing | null {
  const item = raw.payload as unknown as MobileDeItem;
  if (item.price === null || item.price < 100) return null;

  const byModel = resolveMakeModel(item.make, item.model);
  const byTitle = item.title ? resolveMakeModel(item.make, item.title) : null;
  const modelSlug = byModel.modelSlug ?? byTitle?.modelSlug ?? null;
  const variant = byTitle?.modelSlug
    ? byTitle.variant
    : item.title && normalizeText(item.title) !== normalizeText(item.model)
      ? item.title
      : null;
  const makeName = MAKES.find((make) => make.slug === byModel.makeSlug)?.name ?? titleCase(item.make);
  const sellerType = item.sellerType ? (SELLER_TYPES[item.sellerType] ?? null) : null;
  const fuel = item.pluginHybrid ? "plugin_hybrid" : item.fuel ? (FUELS[item.fuel] ?? "other") : null;

  return {
    sourceId: MOBILE_DE.id,
    externalId: item.id,
    url: item.url,
    title: `${makeName} ${item.title ?? item.model}`.slice(0, 200),
    makeSlug: byModel.makeSlug,
    modelSlug,
    makeRaw: item.make,
    modelRaw: item.model,
    variant,
    priceEur: Math.round(item.price),
    mileageKm: item.mileage,
    firstRegistration: firstRegistrationDate(item.firstRegistration),
    fuel,
    transmission: item.gearbox ? (GEARBOXES[item.gearbox] ?? null) : null,
    powerKw: item.power,
    bodyType: item.category ? (CATEGORIES[item.category] ?? null) : null,
    color: null,
    sellerType,
    sellerName: sellerType === "dealer" ? item.dealerName : null,
    zip: item.country === null || item.country === "DE" ? item.zip : null,
    city: item.city,
    lat: null,
    lng: null,
  };
}

export interface MobileDeApiOptions {
  user: string;
  password: string;
  userAgent?: string;
  /** Pause between two requests. */
  minDelayMs?: number;
  /** Requests per run. */
  maxRequests?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * The Search-API client: HTTP Basic auth with the API account, one request at a time with a pause
 * in between and a request budget per run. Rejected credentials (401/403) and rate limits (429)
 * stop the run at once; they are never retried.
 */
export class MobileDeApi {
  private readonly authorization: string;
  private readonly userAgent: string;
  private readonly minDelayMs: number;
  private readonly maxRequests: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private nextSlot = 0;
  private requestCount = 0;

  constructor(options: MobileDeApiOptions) {
    this.authorization = `Basic ${Buffer.from(`${options.user}:${options.password}`).toString("base64")}`;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.minDelayMs = options.minDelayMs ?? 1000;
    this.maxRequests = options.maxRequests ?? 1000;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  get requestsMade(): number {
    return this.requestCount;
  }

  get requestsLeft(): number {
    return Math.max(0, this.maxRequests - this.requestCount);
  }

  async getJson(url: string): Promise<unknown> {
    if (this.requestCount >= this.maxRequests) throw new BudgetExceededError(this.maxRequests);
    const wait = this.nextSlot - this.now();
    if (wait > 0) await this.sleep(wait);
    this.requestCount += 1;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { authorization: this.authorization, accept: ACCEPT, "user-agent": this.userAgent },
        // The credentials must never follow a redirect to another address.
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } finally {
      this.nextSlot = this.now() + this.minDelayMs;
    }
    if (response.status === 401 || response.status === 403) {
      throw new BlockedError(url, `HTTP ${response.status}: API account rejected or without access to this search`);
    }
    if (response.status === 429) throw new BlockedError(url, "HTTP 429: rate limit reached");
    if (!response.ok) throw new HttpStatusError(url, response.status);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiFormatError(url, "answer is not JSON");
    }
  }
}

/** The API client from MOBILE_DE_* environment variables; fails clearly without an API account. */
export function mobileDeApiFromEnv(): MobileDeApi {
  const user = process.env.MOBILE_DE_API_USER?.trim();
  const password = process.env.MOBILE_DE_API_PASSWORD;
  if (!user || !password) {
    throw new Error("mobile.de needs an API account from mobile.de: set MOBILE_DE_API_USER and MOBILE_DE_API_PASSWORD.");
  }
  return new MobileDeApi({
    user,
    password,
    userAgent: process.env.SCRAPE_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    minDelayMs: readNumber("MOBILE_DE_MIN_DELAY_MS", 1000, 200),
    maxRequests: readNumber("MOBILE_DE_MAX_REQUESTS", 1000, 1),
  });
}

export interface MobileDeOptions {
  api: MobileDeApi;
  /** Our make slugs to read. Defaults to every make of the taxonomy. */
  makes?: string[];
  /** Newest pages per make and run. */
  newestPages?: number;
  pageSize?: number;
  staleAfterDays?: number;
  log?: (message: string) => void;
}

export function createMobileDeAdapter(options: MobileDeOptions): SourceAdapter {
  const { api } = options;
  const makes = options.makes ?? MAKES.map((make) => make.slug);
  const pageSize = options.pageSize ?? MOBILE_DE_PAGE_SIZE;
  const log = options.log ?? (() => undefined);
  let completed: string[] = [];
  let failuresInARow = 0;

  /** One search page, or null when it is skipped (rejected query, temporary error). */
  async function load(url: string): Promise<ListPage<MobileDeItem> | null> {
    try {
      const page = parseMobileDeSearch(await api.getJson(url), url);
      failuresInARow = 0;
      return page;
    } catch (error) {
      if (error instanceof BlockedError || error instanceof BudgetExceededError || error instanceof ApiFormatError) throw error;
      if (error instanceof HttpStatusError && error.status < 500) {
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
    source: MOBILE_DE,
    fullSnapshot: false,
    staleAfterDays: options.staleAfterDays ?? 30,
    normalize: normalizeMobileDe,
    completedSegments: () => completed,
    async *fetch(context?: FetchContext) {
      if (!context) throw new Error("mobile.de needs the import's database connection");
      completed = [];
      failuresInARow = 0;
      try {
        yield* crawlPriceSegments<MobileDeItem>(
          {
            sourceId: MOBILE_DE.id,
            db: context.db,
            makes,
            pageSize,
            maxPagesPerSegment: Math.floor(MAX_RESULTS_PER_QUERY / pageSize),
            newestPages: options.newestPages ?? 1,
            requestsLeft: () => api.requestsLeft,
            loadPage: (make, page, price) => load(searchUrl(make, page, price, pageSize)),
            itemId: (item) => item.id,
            itemPrice: (item) => item.price,
            toRaw: (item, segment) => ({ externalId: item.id, payload: item as unknown as Record<string, unknown>, segment }),
            log,
          },
          completed,
        );
      } catch (error) {
        // The budget ends the run quietly; everything read so far is kept.
        if (!(error instanceof BudgetExceededError)) throw error;
      }
      log(`requests: ${api.requestsMade}, segments read completely: ${completed.length}`);
    },
  };
}
