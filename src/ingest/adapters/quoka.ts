import { resolveMake } from "@/core/normalize";
import { MAKES } from "@/core/taxonomy";
import type { NormalizedListing } from "@/core/types";
import type { CheckOutcome, FetchContext, ListingRef, RawListing, SourceAdapter, SourceInfo } from "../adapter";
import { cardFacts, readCards } from "../http/cards";
import { BudgetExceededError, type FetchedPage, type PoliteFetcher } from "../http/fetcher";
import { checkListingPages } from "./listing-check";
import { normalizeCard, PageLoader, readList, toRaw, type CardItem } from "./list-crawler";

/**
 * Quoka (www.quoka.de), category "Automarkt". Its robots.txt allows the result lists, their
 * pages (?pag=N) and the ads. Each run reads the newest pages of every make's list and of the
 * whole category; the make lists are taken from the links on the category page, so a new or
 * renamed make path needs no code change. Some responses lack that menu; then our make slugs
 * serve as paths. Listings that drop out of the newest pages are checked on their own page for the
 * rest of the run (robots.txt allows the ads), the longest unchecked first; one that is neither
 * seen nor confirmed for staleAfterDays leaves the search.
 *
 * The list mixes in parts and accessories; only entries with a price and a mileage or year count.
 * Whether a seller is a dealer is not on the list, so the seller type stays unknown. No seller
 * names, phone numbers or description texts are stored.
 */

export const QUOKA: SourceInfo = {
  id: "quoka",
  name: "Quoka",
  kind: "scrape",
  websiteUrl: "https://www.quoka.de",
};

const ORIGIN = "https://www.quoka.de";
const CATEGORY_PATH = "/anzeigen/auto-motorrad/automarkt/";
/** Quoka shows at most 100 pages of a list. */
export const MAX_PAGES = 100;

export function listUrl(makePath: string | null, page = 1): string {
  const path = makePath ? `${CATEGORY_PATH}${makePath}/` : CATEGORY_PATH;
  return `${ORIGIN}${path}${page > 1 ? `?pag=${page}` : ""}`;
}

const DETAIL = /^\/anzeigen\/auto-motorrad\/automarkt\/anzeige\/[^/]+\/([0-9a-z]{8,64})\.html$/;

export function detailId(url: URL): string | null {
  return url.hostname.endsWith("quoka.de") ? (url.pathname.match(DETAIL)?.[1] ?? null) : null;
}

export type QuokaItem = CardItem;

export function parseQuokaPage(html: string, url: string, listMake: string | null = null): QuokaItem[] {
  return readCards(html, url, detailId).flatMap((card) => {
    if (!card.title) return [];
    return [{ id: card.id, url: card.url, title: card.title.slice(0, 200), listMake, image: card.image, ...cardFacts(card.pieces) }];
  });
}

export interface MakeList {
  /** Our make slug. */
  make: string;
  /** Quoka's path segment, e.g. "volkswagen". */
  path: string;
  /** Listings Quoka reports for it, when the link says. */
  count: number | null;
}

/** The make lists linked from the category page ("Volkswagen (196448)"), mapped to our makes. */
export function parseMakeLinks(html: string): MakeList[] {
  const lists = new Map<string, MakeList>();
  const pattern = /<a\b[^>]*href="(?:https:\/\/www\.quoka\.de)?\/anzeigen\/auto-motorrad\/automarkt\/([a-z0-9-]+)\/"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const [, path, inner] of html.matchAll(pattern)) {
    if (path === "anzeige") continue;
    const text = inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const name = text.replace(/\s*\(\s*[\d.]+\s*\)\s*$/, "");
    const make = resolveMake(name) ?? resolveMake(path.replace(/-/g, " "));
    if (!make) continue;
    const count = Number(text.match(/\(\s*([\d.]+)\s*\)\s*$/)?.[1]?.replace(/\./g, "") ?? NaN);
    const entry = { make: make.slug, path, count: Number.isFinite(count) ? count : null };
    const known = lists.get(make.slug);
    // Some makes have more than one path ("mercedes" and "mercedes-benz"): keep the bigger one.
    if (!known || (entry.count ?? 0) > (known.count ?? 0)) lists.set(make.slug, entry);
  }
  return [...lists.values()];
}

/** What an ad page shows once the ad expired or was deleted. */
const TAKEN_DOWN = /Anzeige (?:ist )?nicht mehr (?:verfügbar|aktiv|online)|Anzeige wurde (?:bereits )?(?:deaktiviert|gelöscht|entfernt)/i;

/**
 * What an ad's own page says. Led to a page that is no ad (the category, the start page): taken
 * down. The ad itself: taken down when it says so, else online.
 */
export function quokaVerdict(ref: ListingRef, page: FetchedPage): CheckOutcome {
  const id = detailId(new URL(page.url));
  if (id === null) return "gone";
  if (id !== ref.externalId) return "unclear";
  return TAKEN_DOWN.test(page.text) ? "gone" : "active";
}

/** Quoka sends ads that are gone to its "not found" or archive pages, which robots.txt forbids. */
export function quokaDisallowedRedirect(_ref: ListingRef, target: string): CheckOutcome {
  return /^\/Detailansicht-(?:AdNotFound|Archiv)\//i.test(new URL(target).pathname) ? "gone" : "unclear";
}

export function normalizeQuoka(raw: RawListing): NormalizedListing | null {
  return normalizeCard(raw.payload as unknown as QuokaItem, {
    sourceId: QUOKA.id,
    sellerType: null,
    sellerName: null,
    imageHost: "quoka.de",
    requireVehicleFacts: true,
  });
}

export interface QuokaOptions {
  fetcher: PoliteFetcher;
  /** Our make slugs whose lists are read. Defaults to every make of the taxonomy Quoka links. */
  makes?: string[];
  /** Newest pages per list and run. */
  pagesPerList?: number;
  staleAfterDays?: number;
  log?: (message: string) => void;
}

export function createQuokaAdapter(options: QuokaOptions): SourceAdapter {
  const log = options.log ?? (() => undefined);
  const wanted = new Set(options.makes ?? MAKES.map((make) => make.slug));
  const pagesPerList = Math.min(options.pagesPerList ?? 5, MAX_PAGES);

  return {
    source: QUOKA,
    fullSnapshot: false,
    staleAfterDays: options.staleAfterDays ?? 2,
    normalize: normalizeQuoka,
    checkListings: (due) =>
      checkListingPages(due, { fetcher: options.fetcher, log, verdict: quokaVerdict, disallowedRedirect: quokaDisallowedRedirect }),
    async *fetch(context?: FetchContext): AsyncGenerator<RawListing> {
      const loader = new PageLoader(QUOKA.id, options.fetcher, log, context?.db);
      const seen = new Set<string>();
      try {
        const first = await loader.load(listUrl(null));
        if (!first) throw new Error(`Quoka: category page ${listUrl(null)} not available`);
        const categoryItems = parseQuokaPage(first.text, first.url);
        if (categoryItems.length === 0) throw await loader.formatError(first, "no listings found; did the page change?");
        let makes = parseMakeLinks(first.text).filter((list) => wanted.has(list.make));
        if (makes.length === 0) {
          // Quoka sometimes sends a lighter page without the make menu. Its make paths are our
          // slugs ("volkswagen", "mercedes-benz"); a path it does not know just answers 404.
          log("no make links on the category page, using our make slugs as paths");
          makes = [...wanted].map((make) => ({ make, path: make, count: null }));
        }

        // Makes first, so their listings keep the make of the list; the whole category last.
        for (const list of makes) {
          for await (const item of readList({
            loader,
            seen,
            maxPages: pagesPerList,
            pageUrl: (n) => listUrl(list.path, n),
            parse: (page: FetchedPage) => parseQuokaPage(page.text, page.url, list.make),
          })) {
            yield toRaw(item);
          }
        }
        for (const item of categoryItems) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          yield toRaw(item);
        }
        for await (const item of readList({
          loader,
          seen,
          // Page 1 was read above.
          maxPages: pagesPerList - 1,
          pageUrl: (n) => listUrl(null, n + 1),
          parse: (page: FetchedPage) => parseQuokaPage(page.text, page.url),
        })) {
          yield toRaw(item);
        }
      } catch (error) {
        if (!(error instanceof BudgetExceededError)) throw error;
      } finally {
        log(`requests: ${loader.requestsMade}, listings: ${seen.size}`);
      }
    },
  };
}
