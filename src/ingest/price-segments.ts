import type { PoolClient } from "pg";
import type { RawListing } from "./adapter";
import { SegmentStore, type Segment, type SegmentDraft } from "./segments";

/**
 * Reading a large inventory in parts: one result list per make, cut into price ranges small
 * enough that the source lets us page through all of them. Used by every source whose search
 * stops after a fixed number of results (AutoScout24 pages, the mobile.de Search-API).
 *
 * Each run does two things within the request budget:
 * 1. "Newest": the first result pages per make, newest first, so fresh listings appear quickly.
 * 2. "Sweep": whole segments (make and price range) in rotation, page by page. A segment with more
 *    results than the source lets us page through is split into smaller price ranges. Once a
 *    segment was read to the end, every listing it reported came in and its counts did not change
 *    while we read, listings of that segment we did not see count as missed.
 */

export interface PriceSegment {
  make: string;
  /** Lowest price, inclusive. */
  priceFrom: number;
  /** Highest price, exclusive; null means no upper limit. */
  priceTo: number | null;
}

export interface PriceRange {
  from: number;
  to: number | null;
}

/** One result page of a source: its items and the counts it reports for the whole list. */
export interface ListPage<T> {
  items: T[];
  total: number;
  pages: number;
}

/** First split of a whole make into price ranges (EUR); later splits halve a range. */
const PRICE_LADDER = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 14000, 16000, 18000, 20000, 23000, 26000, 30000, 35000, 40000, 50000, 60000, 80000, 100000];
/** Ranges narrower than this are not split any further. */
const MIN_RANGE_EUR = 200;

export function segmentKey({ make, priceFrom, priceTo }: PriceSegment): string {
  return `${make}:${priceFrom}-${priceTo ?? ""}`;
}

/** Smaller price ranges replacing one that has too many results, or [] when it cannot be split. */
export function splitSegment(params: PriceSegment): PriceSegment[] {
  const { make, priceFrom, priceTo } = params;
  if (isRoot(params)) {
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

export function inPriceRange(price: number | null, { priceFrom, priceTo }: PriceSegment): boolean {
  return price !== null && price >= priceFrom && (priceTo === null || price < priceTo);
}

function isRoot({ priceFrom, priceTo }: PriceSegment): boolean {
  return priceFrom === 0 && priceTo === null;
}

function rootSegment(make: string): SegmentDraft<PriceSegment> {
  const params = { make, priceFrom: 0, priceTo: null };
  return { key: segmentKey(params), params };
}

export interface PriceSegmentCrawlOptions<T> {
  sourceId: string;
  /** The import's own connection (see FetchContext); the crawl plan is kept in crawl_segments. */
  db: PoolClient;
  makes: string[];
  /** Items per result page. */
  pageSize: number;
  /** Most pages the source lets us read of one list. */
  maxPagesPerSegment: number;
  /** Newest pages per make and run. */
  newestPages: number;
  /** Requests still allowed in this run. */
  requestsLeft: () => number;
  /**
   * One result page of a make, newest first, limited to a price range when one is given.
   * Null when this page is skipped (not allowed, missing, temporary error).
   */
  loadPage: (make: string, page: number, price?: PriceRange) => Promise<ListPage<T> | null>;
  itemId: (item: T) => string;
  itemPrice: (item: T) => number | null;
  /** False for ads a source mixes into a list regardless of the filters. */
  isOrganic?: (item: T) => boolean;
  toRaw: (item: T, segment?: string) => RawListing;
  log?: (message: string) => void;
}

/**
 * Gives listings still tagged with a retired segment the smaller range their price falls into, so
 * complete reads of the new ranges count their misses, too. Stored prices are whole euros, cents
 * cut off, and range bounds are whole euros, so the stored price decides the range exactly.
 */
async function moveListingsToRanges(db: PoolClient, sourceId: string, from: string, ranges: PriceSegment[]): Promise<void> {
  await db.query(
    `update listings set segment = r.key
       from unnest($3::text[], $4::bigint[], $5::bigint[]) as r (key, price_from, price_to)
      where listings.source_id = $1 and listings.segment = $2
        and listings.price_eur >= r.price_from and (r.price_to is null or listings.price_eur < r.price_to)`,
    [sourceId, from, ranges.map(segmentKey), ranges.map((r) => r.priceFrom), ranges.map((r) => r.priceTo)],
  );
}

/**
 * Runs the newest pass and then the sweep until the request budget is used up or every segment
 * was read once. Keys of segments read completely are pushed to `completed` as they finish.
 */
export async function* crawlPriceSegments<T>(options: PriceSegmentCrawlOptions<T>, completed: string[]): AsyncGenerator<RawListing> {
  const { makes, pageSize, maxPagesPerSegment, newestPages, requestsLeft, loadPage, toRaw } = options;
  const log = options.log ?? (() => undefined);
  const isOrganic = options.isOrganic ?? (() => true);
  const store = new SegmentStore<PriceSegment>(options.db, options.sourceId);

  // The newest pass may use at most half of the run's requests, so the sweep always moves on.
  const sweepShare = Math.ceil(requestsLeft() / 2);
  newest: for (const make of makes) {
    for (let page = 1; page <= newestPages; page += 1) {
      if (requestsLeft() < 1) return;
      if (requestsLeft() <= sweepShare) {
        log(`newest pass stopped at ${make}: half of the run's requests are kept for the sweep`);
        break newest;
      }
      const result = await loadPage(make, page);
      if (!result) break;
      for (const item of result.items) yield toRaw(item);
      if (page >= result.pages) break;
    }
  }

  /**
   * Requests a segment will likely take, from the count it reported last time: one when page 1 will
   * split it, two when the count is unknown (page 1, then page 2 or a split).
   */
  const requestsFor = ({ lastTotal }: Segment<PriceSegment>): number => {
    if (lastTotal === null) return 2;
    const pages = Math.ceil(lastTotal / pageSize);
    return pages > maxPagesPerSegment ? 1 : Math.max(1, pages);
  };

  await store.ensure(makes.map(rootSegment));
  const wanted = new Set(makes);
  const done = new Set<string>();
  const postponed = new Set<string>();
  // Read the plan again after every segment: a split adds smaller segments to read next.
  for (;;) {
    if (requestsLeft() < 1) break;
    const candidates = (await store.active()).filter((s) => wanted.has(s.params.make) && !done.has(s.key));
    // A segment the remaining requests cannot read to the end is left untouched, so it keeps its
    // place at the front and is read first, with the whole sweep share, in the next run.
    const next = candidates.find((s) => requestsFor(s) <= requestsLeft());
    for (const skipped of candidates.slice(0, next ? candidates.indexOf(next) : candidates.length)) {
      if (!postponed.has(skipped.key)) log(`${skipped.key} needs about ${requestsFor(skipped)} requests; it is read first in the next run`);
      postponed.add(skipped.key);
    }
    if (!next) break;
    done.add(next.key);
    yield* sweep(next);
  }

  async function* sweep(segment: Segment<PriceSegment>): AsyncGenerator<RawListing> {
    const params = segment.params;
    const price = { from: params.priceFrom, to: params.priceTo };
    // Recorded before the request, so a segment whose first page fails still moves to the back.
    await store.attempted(segment.key);
    const first = await loadPage(params.make, 1, price);
    if (!first) return;
    await store.counted(segment.key, first.total);

    const reachablePages = Math.min(first.pages, maxPagesPerSegment);
    if (first.total > reachablePages * pageSize) {
      const children = splitSegment(params);
      if (children.length > 0) {
        await store.split(
          segment.key,
          children.map((child) => ({ key: segmentKey(child), params: child })),
          (db) => moveListingsToRanges(db, options.sourceId, segment.key, children),
        );
        log(`split ${segment.key} (${first.total} results) into ${children.length} price ranges`);
        // The page is still useful; its listings get their segment once the smaller ranges are read.
        for (const item of first.items) yield toRaw(item);
        return;
      }
    }

    // The whole make has no price filter, so it also lists cars without a price.
    const whole = isRoot(params);
    const seen = new Set<string>();
    const emit = function* (items: T[]) {
      for (const item of items) {
        const own = isOrganic(item) && (whole || inPriceRange(options.itemPrice(item), params));
        if (own) seen.add(options.itemId(item));
        yield toRaw(item, own ? segment.key : undefined);
      }
    };
    yield* emit(first.items);

    const lastPage = Math.min(reachablePages, Math.ceil(first.total / pageSize));
    let unchanged = true;
    for (let page = 2; page <= lastPage; page += 1) {
      if (requestsLeft() < 1) return;
      const result = await loadPage(params.make, page, price);
      if (!result) return;
      if (result.total !== first.total || result.pages !== first.pages) unchanged = false;
      yield* emit(result.items);
      if (result.items.length === 0) break;
    }
    if (!unchanged) log(`${segment.key} changed while it was read; it is read again in a later run`);

    // Only a read that saw exactly the reported listings may count the others as sold. Listings that
    // moved between pages, or a list that grew or shrank while we read, leave the segment incomplete
    // for this run; it stays in the plan and is read again. A shift that keeps every count the same
    // can still hide a listing for one read; it is gone only after two complete reads without it.
    if (unchanged && first.total <= reachablePages * pageSize && seen.size === first.total) {
      completed.push(segment.key);
      await store.completed(segment.key);
    }
  }
}
