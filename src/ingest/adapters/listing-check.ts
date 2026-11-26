import type { CheckOutcome, CheckResult, ListingRef, PageFacts } from "../adapter";
import {
  BlockedError,
  BudgetExceededError,
  DisallowedError,
  HttpStatusError,
  type FetchedPage,
  type PoliteFetcher,
} from "../http/fetcher";

/**
 * Checks stored listings on their own page, one request each, through the same PoliteFetcher as
 * the lists (robots.txt, pacing, stop at blocks). Used for portals whose robots.txt lets us read
 * only the newest result pages, so a listing that dropped out of them is never seen in a list again.
 *
 * Only the outcome leaves this module: pages hold the seller's description and, for private
 * sellers, their name, so they are neither stored nor logged.
 */

export interface ListingCheckOptions {
  fetcher: PoliteFetcher;
  log: (message: string) => void;
  /** What a page that loaded (after any redirects) says about the listing. */
  verdict: (ref: ListingRef, page: FetchedPage) => CheckOutcome;
  /**
   * What it means that the listing's address redirects to a page robots.txt forbids, e.g. the
   * portal's "ad not found" page. Without it such a redirect is unclear.
   */
  disallowedRedirect?: (ref: ListingRef, target: string) => CheckOutcome;
  /**
   * Facts the page shows besides the listing being online, such as its price now. Read only from
   * pages the verdict calls online; the page itself is not kept.
   */
  facts?: (ref: ListingRef, page: FetchedPage) => PageFacts;
}

/** Network or server errors in a row that end the checks: the site is probably down. */
const MAX_FAILURES_IN_A_ROW = 3;
/** Unclear pages in a row that end the checks: the page format probably changed. */
export const MAX_UNCLEAR_IN_A_ROW = 20;
/**
 * Outcomes are handed on in groups. A group in which nearly every listing is gone is not believed:
 * even among old listings most are still online, so such a group means the portal answers
 * differently than expected (a block page, a redirect for bots), and the checks stop without it.
 */
export const CHECK_GROUP = 25;
export const MAX_GONE_IN_GROUP = 22;
/**
 * Sellers change a price now and then, so in a group in which many pages show another price than
 * the stored one the price was probably misread (the page changed): the group keeps its outcomes
 * but hands on none of its prices.
 */
export const MAX_PRICE_CHANGES_IN_GROUP = 10;
/**
 * Ads that turn out to offer no car (dealers buying up cars) are rare, so a group with more of them
 * means the rule misreads the pages: the group keeps its outcomes but drops that finding.
 */
export const MAX_NOT_FOR_SALE_IN_GROUP = 5;

type Attempt = { outcome: CheckOutcome; facts?: PageFacts } | "stop";

const VEHICLE_FACTS = ["fuel", "transmission", "powerKw", "bodyType", "sellerType"] as const satisfies readonly (keyof PageFacts)[];

/**
 * Elements the seller writes or the portal fills from the seller's text: scripts and meta tags
 * (JSON-LD, og:description) and any element whose id, class or itemprop names the description.
 */
const SELLER_TEXT = [
  /<script\b[\s\S]*?<\/script\s*>/gi,
  /<style\b[\s\S]*?<\/style\s*>/gi,
  /<meta\b[^>]*>/gi,
  /<(\w+)\b[^>]*\b(?:id|class|itemprop)\s*=\s*["'][^"']*(?:description|beschreibung)[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi,
];

/**
 * A page without the parts a seller writes, for looking for the portal's own "taken down"
 * notices: a description saying "my old ad was deleted" must not take the listing down.
 */
export function portalText(html: string): string {
  return SELLER_TEXT.reduce((text, pattern) => text.replace(pattern, " "), html);
}

export async function* checkListingPages(due: ListingRef[], options: ListingCheckOptions): AsyncGenerator<CheckResult> {
  const { fetcher, log } = options;
  const counts: Record<CheckOutcome, number> = { active: 0, gone: 0, unclear: 0 };
  const storedPrice = new Map(due.map((ref) => [ref.externalId, ref.priceEur]));
  let newPrices = 0;
  /** Online pages that showed vehicle facts: none at all means the page layout probably changed. */
  let withVehicleFacts = 0;
  let failures = 0;
  let unclearInARow = 0;
  let group: CheckResult[] = [];

  const attempt = async (ref: ListingRef): Promise<Attempt> => {
    try {
      const page = await fetcher.getText(ref.url);
      failures = 0;
      const outcome = options.verdict(ref, page);
      return outcome === "active" && options.facts ? { outcome, facts: options.facts(ref, page) } : { outcome };
    } catch (error) {
      if (error instanceof BudgetExceededError) return "stop";
      if (error instanceof BlockedError) throw error;
      if (error instanceof HttpStatusError && error.status < 500) {
        failures = 0;
        // Taken down; anything else (400, 405 …) says nothing about the listing.
        return { outcome: error.status === 404 || error.status === 410 ? "gone" : "unclear" };
      }
      if (error instanceof DisallowedError) {
        if (error.url === ref.url) {
          log(`checks stopped: robots.txt forbids the listing pages (${error.message})`);
          return "stop";
        }
        failures = 0;
        return { outcome: options.disallowedRedirect?.(ref, error.url) ?? "unclear" };
      }
      failures += 1;
      log(`check failed: ${ref.url}: ${error instanceof Error ? error.message : String(error)}`);
      return failures >= MAX_FAILURES_IN_A_ROW ? "stop" : { outcome: "unclear" };
    }
  };

  /** False when the group is not plausible and the checks must stop. */
  const plausible = (results: CheckResult[]) => {
    const gone = results.filter((r) => r.outcome === "gone").length;
    if (results.length >= CHECK_GROUP && gone > MAX_GONE_IN_GROUP) {
      log(`checks stopped: ${gone} of ${results.length} listings in a row look taken down; the portal probably answers differently now`);
      return false;
    }
    return true;
  };

  /** The group as handed on: without its prices when too many of them changed, likewise for ads that offer no car. */
  const handOn = (results: CheckResult[]) => {
    const notForSale = results.filter((r) => r.notForSale).length;
    if (notForSale > MAX_NOT_FOR_SALE_IN_GROUP) {
      log(`buyer ads ignored: ${notForSale} of ${results.length} listing pages look like dealers buying up cars; did the page change?`);
      results = results.map((r) => {
        const kept = { ...r };
        delete kept.notForSale;
        return kept;
      });
    }
    const changed = results.filter((r) => r.priceEur !== undefined && r.priceEur !== storedPrice.get(r.externalId));
    if (changed.length > MAX_PRICE_CHANGES_IN_GROUP) {
      log(`prices ignored: ${changed.length} of ${results.length} listing pages show another price than stored; did the price on the page change?`);
      return results.map((r) => {
        const kept = { ...r };
        delete kept.priceEur;
        return kept;
      });
    }
    newPrices += changed.length;
    return results;
  };

  try {
    for (const ref of due) {
      if (fetcher.requestsLeft < 1) break;
      let tried: Attempt;
      try {
        tried = await attempt(ref);
      } catch (error) {
        // A block ends the run, but the listings checked before it still count.
        if (plausible(group)) yield* handOn(group);
        throw error;
      }
      if (tried === "stop") break;
      const { outcome, facts } = tried;
      counts[outcome] += 1;
      if (facts && VEHICLE_FACTS.some((key) => facts[key] !== undefined)) withVehicleFacts += 1;
      group.push({ externalId: ref.externalId, outcome, ...withoutEmpty(facts) });
      if (outcome === "unclear") {
        unclearInARow += 1;
        if (unclearInARow >= MAX_UNCLEAR_IN_A_ROW) {
          log(`checks stopped: ${unclearInARow} unclear pages in a row; did the listing page change?`);
          break;
        }
      } else {
        unclearInARow = 0;
      }
      if (group.length >= CHECK_GROUP) {
        if (!plausible(group)) return;
        yield* handOn(group);
        group = [];
      }
    }
    if (group.length > 0 && plausible(group)) yield* handOn(group);
  } finally {
    log(
      `checked ${counts.active + counts.gone + counts.unclear} listing pages: ${counts.active} online, ${counts.gone} taken down, ${counts.unclear} unclear` +
        (options.facts ? `, ${newPrices} new prices, ${withVehicleFacts} with vehicle facts` : ""),
    );
  }
}

/** The facts the page showed, without keys for those it did not. */
function withoutEmpty(facts: PageFacts | undefined): PageFacts {
  const result: PageFacts = {};
  if (!facts) return result;
  for (const [key, value] of Object.entries(facts) as [keyof PageFacts, PageFacts[keyof PageFacts]][]) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    (result as Record<string, unknown>)[key] = value;
  }
  return result;
}
