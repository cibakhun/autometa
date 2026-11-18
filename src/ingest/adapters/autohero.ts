import type { NormalizedListing } from "@/core/types";
import type { FetchContext, RawListing, SourceAdapter, SourceInfo } from "../adapter";
import { cardFacts, readCards } from "../http/cards";
import { BudgetExceededError, type PoliteFetcher } from "../http/fetcher";
import { normalizeCard, PageLoader, readSitemapLocs, rotate, toRaw, type CardItem } from "./list-crawler";

/**
 * Autohero (www.autohero.com/de), a dealer selling its own used cars. Its robots.txt allows the
 * search and the model pages. The search page shows only its first cars to a bot; the model
 * pages listed in the make-model sitemap ("/de/auto/volkswagen-passat-kombi/") show up to about
 * 25 cars each. Each run reads the search page and a rotating share of the model pages, so a few
 * runs cover them all. Facts come from the cards: price, year, fuel, mileage and gearbox.
 * Autohero sells nationwide, so listings have no place.
 */

export const AUTOHERO: SourceInfo = {
  id: "autohero",
  name: "Autohero",
  kind: "scrape",
  websiteUrl: "https://www.autohero.com/de/",
};

const ORIGIN = "https://www.autohero.com";
export const SEARCH_URL = `${ORIGIN}/de/search/`;
export const SITEMAP_URL = `${ORIGIN}/de/sitemap_make-model-tree.xml`;

const DETAIL = /^\/de\/[a-z0-9-]+\/id\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/;

export function detailId(url: URL): string | null {
  return url.hostname.endsWith("autohero.com") ? (url.pathname.match(DETAIL)?.[1] ?? null) : null;
}

/** "Volkswagen Passat - 1.4 GTE - 18.430 €" -> "Volkswagen Passat 1.4 GTE". */
export function titleFromLabel(label: string | null): string | null {
  if (!label) return null;
  const parts = label.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1 && /\d\s*(€|EUR)$/i.test(parts[parts.length - 1])) parts.pop();
  return parts.join(" ") || null;
}

export function parseAutoheroPage(html: string, url: string): CardItem[] {
  return readCards(html, url, detailId).flatMap((card) => {
    const title = titleFromLabel(card.label) ?? card.title;
    if (!title) return [];
    return [{ id: card.id, url: card.url, title: title.slice(0, 200), listMake: null, ...cardFacts(card.pieces) }];
  });
}

/** The model pages of the make-model sitemap, without the branch pages ("standorte"). */
export function modelPages(xml: string): string[] {
  return readSitemapLocs(xml).filter((loc) => {
    try {
      const url = new URL(loc);
      return url.hostname.endsWith("autohero.com") && /^\/de\/auto\/[a-z0-9-]+\/$/.test(url.pathname);
    } catch {
      return false;
    }
  });
}

export function normalizeAutohero(raw: RawListing): NormalizedListing | null {
  return normalizeCard(raw.payload as unknown as CardItem, {
    sourceId: AUTOHERO.id,
    sellerType: "dealer",
    sellerName: "Autohero",
    requireVehicleFacts: true,
  });
}

export interface AutoheroOptions {
  fetcher: PoliteFetcher;
  /** Model pages read per run; the rest follow in the next runs. */
  pagesPerRun?: number;
  staleAfterDays?: number;
  log?: (message: string) => void;
  now?: () => number;
}

export function createAutoheroAdapter(options: AutoheroOptions): SourceAdapter {
  const log = options.log ?? (() => undefined);
  const pagesPerRun = options.pagesPerRun ?? 300;
  const now = options.now ?? Date.now;

  return {
    source: AUTOHERO,
    fullSnapshot: false,
    // About 1,000 model pages at 300 per hourly run: every page comes round within a few hours.
    staleAfterDays: options.staleAfterDays ?? 3,
    normalize: normalizeAutohero,
    async *fetch(context?: FetchContext): AsyncGenerator<RawListing> {
      const loader = new PageLoader(AUTOHERO.id, options.fetcher, log, context?.db);
      const seen = new Set<string>();
      const fresh = function* (items: CardItem[]) {
        for (const item of items) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          yield toRaw(item);
        }
      };
      try {
        const search = await loader.load(SEARCH_URL);
        if (!search) throw new Error(`Autohero: search page ${SEARCH_URL} not available`);
        const first = parseAutoheroPage(search.text, search.url);
        if (first.length === 0) throw await loader.formatError(search, "no listings found; did the page change?");
        yield* fresh(first);

        const sitemap = await loader.load(SITEMAP_URL);
        const pages = sitemap ? modelPages(sitemap.text) : [];
        if (pages.length === 0) {
          log(`no model pages in ${SITEMAP_URL}`);
          return;
        }
        const share = rotate(pages, pagesPerRun, now());
        log(`model pages: ${share.length} of ${pages.length}`);
        for (const url of share) {
          if (loader.requestsLeft < 1) return;
          const page = await loader.load(url);
          if (page) yield* fresh(parseAutoheroPage(page.text, page.url));
        }
      } catch (error) {
        if (!(error instanceof BudgetExceededError)) throw error;
      } finally {
        log(`requests: ${loader.requestsMade}, listings: ${seen.size}`);
      }
    },
  };
}
