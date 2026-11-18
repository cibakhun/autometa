import {
  detectBodyType,
  detectFuel,
  detectTransmission,
  findMakeInTitle,
  isNotForSale,
  parseFirstRegistration,
  parseInteger,
  parsePowerKw,
  resolveModelInTitle,
  sourceImageUrl,
} from "@/core/normalize";
import { MAKES } from "@/core/taxonomy";
import type { NormalizedListing } from "@/core/types";
import type { RawListing, SourceAdapter, SourceInfo } from "../adapter";
import { BlockedError, BudgetExceededError, DisallowedError, HttpStatusError, type PoliteFetcher } from "../http/fetcher";
import { decodeEntities, textOf } from "../http/html";

/**
 * Kleinanzeigen (www.kleinanzeigen.de), car category "Autos" (c216). Its robots.txt allows the
 * result lists up to page 5 and the make filter, but not filters such as price, mileage or first
 * registration. So each run reads the newest listings: each make and then the whole category, up
 * to five pages each. Listings drop out of the newest pages after a while and are not re-checked,
 * so they leave the search staleAfterDays after they were last seen.
 *
 * The result list does not say whether a seller is a dealer or a private person, so the seller
 * type stays unknown. Description texts and seller names are never stored.
 */

export const KLEINANZEIGEN: SourceInfo = {
  id: "kleinanzeigen",
  name: "Kleinanzeigen",
  kind: "scrape",
  websiteUrl: "https://www.kleinanzeigen.de",
};

const ORIGIN = "https://www.kleinanzeigen.de";
/** robots.txt disallows page 6 and later. */
export const MAX_PAGES = 5;
const MAX_FAILURES_IN_A_ROW = 3;

/** Kleinanzeigen's value of the make filter (autos.marke_s), where it is not our slug. */
const MAKE_KEYS: Record<string, string> = {
  "mercedes-benz": "mercedes_benz",
  "land-rover": "land_rover",
  "alfa-romeo": "alfa_romeo",
};

export function makeKey(make: string): string {
  return MAKE_KEYS[make] ?? make.replace(/-/g, "_");
}

/** First result page of the whole car category or of one make. */
export function firstPageUrl(make: string | null): string {
  if (!make) return `${ORIGIN}/s-autos/c216`;
  const key = makeKey(make);
  return `${ORIGIN}/s-autos/${key}/c216+autos.marke_s:${key}`;
}

/** Later result pages, in the form Kleinanzeigen links them: ".../seite:N/c216...". */
export function pageUrl(make: string | null, page: number): string {
  const first = firstPageUrl(make);
  return page <= 1 ? first : first.replace("/c216", `/seite:${page}/c216`);
}

/** One result list entry as we store it: facts only. */
export interface KleinanzeigenItem {
  id: string;
  url: string;
  title: string;
  price: string | null;
  mileage: string | null;
  firstRegistration: string | null;
  zip: string | null;
  city: string | null;
  /** Our make slug of the list the entry was found in, if it was a make's list. */
  listMake: string | null;
  /** Address of the list's preview photo on Kleinanzeigen's image server. */
  image: string | null;
}

/** Reads the result entries of a list page. Entries without an id or link are left out. */
export function parseKleinanzeigenPage(html: string, listMake: string | null = null): KleinanzeigenItem[] {
  const items: KleinanzeigenItem[] = [];
  for (const [article] of html.matchAll(/<article\b[^>]*data-adid="[^"]*"[\s\S]*?<\/article>/g)) {
    const id = article.match(/data-adid="(\d+)"/)?.[1];
    const href = article.match(/data-href="([^"]+)"/)?.[1] ?? article.match(/href="(\/s-anzeige\/[^"]+)"/)?.[1];
    if (!id || !href) continue;

    const titleHtml = article.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? article.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1];
    const title = titleHtml ? textOf(titleHtml) : "";
    if (!title) continue;

    // Short paragraphs that hold nothing but a price, e.g. "18.500 € VB", "VB" or "20.000 €".
    const prices = [...article.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map((m) => textOf(m[1]))
      .filter((text) => /^(\d{1,3}(\.\d{3})*|\d+) €( VB)?$|^VB$|^Zu verschenken$/.test(text));
    // Facts come from the short text nodes outside the seller's description, which can hold
    // anything (names, phone numbers) and is never read.
    const withoutDescription = article.replace(/<(p|div)\b[^>]*class="[^"]*description[^"]*"[^>]*>[\s\S]*?<\/\1>/g, "");
    const texts = [...withoutDescription.matchAll(/>([^<>]+)</g)].map((m) => decodeEntities(m[1]).trim()).filter(Boolean);
    // "10115 Berlin", "80331 München - Altstadt": a place name has no digits.
    const place = texts.map((t) => t.match(/^(\d{5}) ([^\d]{2,60})$/)).find(Boolean);
    const mileage = texts.find((t) => /^\d{1,3}(\.\d{3})* km$|^\d+ km$/.test(t)) ?? null;
    const registration = texts.map((t) => t.match(/^EZ (\d{1,2}\/\d{4})$/)).find(Boolean);
    // The preview photo: the first image in the entry (lazy lists put its address in data-imgsrc).
    const image =
      article.match(/<img\b[^>]*?\s(?:src|data-src)="(https?:\/\/[^"]+)"/)?.[1] ??
      article.match(/\sdata-imgsrc="(https?:\/\/[^"]+)"/)?.[1];

    items.push({
      id,
      url: new URL(href, ORIGIN).href,
      title: title.slice(0, 200),
      price: prices[0] ?? null,
      mileage,
      firstRegistration: registration ? registration[1] : null,
      zip: place ? place[1] : null,
      city: place ? place[2].trim() : null,
      listMake,
      image: image ? decodeEntities(image) : null,
    });
  }
  return items;
}

export function normalizeKleinanzeigen(raw: RawListing): NormalizedListing | null {
  const item = raw.payload as unknown as KleinanzeigenItem;
  const price = item.price && /\d/.test(item.price) ? parseInteger(item.price) : null;
  if (price === null || price < 100) return null;
  if (isNotForSale(item.title)) return null;

  // The make from the title wins when it agrees with the list; otherwise the list's make filter.
  const fromTitle = findMakeInTitle(item.title);
  const listMake = item.listMake ? MAKES.find((make) => make.slug === item.listMake) ?? null : null;
  const make = listMake ?? fromTitle?.make ?? null;
  const rest = fromTitle && (!listMake || fromTitle.make.slug === listMake.slug) ? fromTitle.rest : item.title;
  const resolved = make ? resolveModelInTitle(make.name, rest) : { makeSlug: null, modelSlug: null, variant: null };
  const power = parsePowerKw(item.title);

  return {
    sourceId: KLEINANZEIGEN.id,
    externalId: item.id,
    url: item.url,
    title: item.title,
    makeSlug: resolved.makeSlug,
    modelSlug: resolved.modelSlug,
    makeRaw: make?.name ?? "",
    modelRaw: rest,
    variant: resolved.variant?.slice(0, 160) ?? null,
    priceEur: price,
    mileageKm: parseInteger(item.mileage),
    firstRegistration: parseFirstRegistration(item.firstRegistration),
    fuel: detectFuel(item.title),
    transmission: detectTransmission(item.title),
    powerKw: power !== null && power >= 20 && power <= 1000 ? power : null,
    bodyType: detectBodyType(item.title),
    color: null,
    sellerType: null,
    sellerName: null,
    zip: item.zip,
    city: item.city,
    lat: null,
    lng: null,
    imageUrl: sourceImageUrl(item.image, "kleinanzeigen.de"),
  };
}

export interface KleinanzeigenOptions {
  fetcher: PoliteFetcher;
  /** Our make slugs whose lists are read, besides the whole category. Defaults to the taxonomy. */
  makes?: string[];
  pagesPerList?: number;
  staleAfterDays?: number;
  log?: (message: string) => void;
}

export function createKleinanzeigenAdapter(options: KleinanzeigenOptions): SourceAdapter {
  const { fetcher } = options;
  const makes = options.makes ?? MAKES.map((make) => make.slug);
  const pagesPerList = Math.min(options.pagesPerList ?? MAX_PAGES, MAX_PAGES);
  const log = options.log ?? (() => undefined);
  let failuresInARow = 0;

  async function load(url: string): Promise<string | null> {
    try {
      const page = await fetcher.getText(url);
      failuresInARow = 0;
      return page.text;
    } catch (error) {
      if (error instanceof BlockedError || error instanceof BudgetExceededError) throw error;
      if (error instanceof DisallowedError) {
        log(`skipped (robots.txt): ${url}`);
        return null;
      }
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
    source: KLEINANZEIGEN,
    fullSnapshot: false,
    staleAfterDays: options.staleAfterDays ?? 14,
    normalize: normalizeKleinanzeigen,
    async *fetch() {
      failuresInARow = 0;
      const seen = new Set<string>();
      try {
        // Makes first, so their listings keep the make filter's make; the whole category last.
        for (const make of [...makes, null]) {
          const inList = new Set<string>();
          for (let page = 1; page <= pagesPerList; page += 1) {
            if (fetcher.requestsLeft < 1) return;
            const url = pageUrl(make, page);
            const html = await load(url);
            if (html === null) break;
            const items = parseKleinanzeigenPage(html, make);
            // A make may have no listings, but the whole category always has some: none there
            // means the page layout changed.
            if (make === null && page === 1 && items.length === 0) {
              throw new Error(`Kleinanzeigen: no listings found on ${url}; did the page change?`);
            }
            const newInList = items.filter((item) => !inList.has(item.id));
            for (const item of newInList) {
              inList.add(item.id);
              // Listings already found in an earlier list keep that list's make.
              if (seen.has(item.id)) continue;
              seen.add(item.id);
              yield { externalId: item.id, payload: item as unknown as Record<string, unknown> };
            }
            // A page with nothing new for this list means the list ends here (or repeats itself).
            if (newInList.length === 0) break;
          }
        }
      } catch (error) {
        if (!(error instanceof BudgetExceededError)) throw error;
      } finally {
        log(`requests: ${fetcher.requestsMade}, listings: ${seen.size}`);
      }
    },
  };
}
