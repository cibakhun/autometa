import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedListing } from "@/core/types";
import type { RawListing, SourceAdapter, SourceInfo } from "@/ingest/adapter";
import { createAutoScout24Adapter, listUrl } from "@/ingest/adapters/autoscout24";
import { createDemoAdapter } from "@/ingest/adapters/demo";
import { createMobileDeAdapter, MobileDeApi, searchUrl } from "@/ingest/adapters/mobilede";
import { updateDuplicates } from "@/ingest/duplicates";
import { PoliteFetcher } from "@/ingest/http/fetcher";
import { migrate } from "@/ingest/migrate";
import { removeDemoData } from "@/ingest/pipeline";
import { IngestBusyError, runIngest } from "@/ingest/run";
import { seedReferenceData } from "@/ingest/seed";
import { parseFilters } from "@/search/filters";
import { getListing, getMakeFacets, getSourceFacets, getSourceStatus, searchListings } from "@/search/query";
import { emptyTestDatabase } from "./test-database";

/**
 * Import of scraped portals against a real Postgres. Set TEST_DATABASE_URL to a database whose
 * name contains "test"; its public schema is wiped before the run.
 */
const url = process.env.TEST_DATABASE_URL;

/** An empty, migrated and seeded test database (see emptyTestDatabase for the safety check). */
async function freshTestDatabase(): Promise<Pool> {
  const pool = await emptyTestDatabase();
  await migrate(pool);
  await seedReferenceData(pool);
  return pool;
}

const PORTAL_A: SourceInfo = { id: "portal-a", name: "Portal A", kind: "scrape", websiteUrl: "https://a.example" };
const PORTAL_B: SourceInfo = { id: "portal-b", name: "Portal B", kind: "scrape", websiteUrl: "https://b.example" };

function car(source: SourceInfo, externalId: string, overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    sourceId: source.id,
    externalId,
    url: `${source.websiteUrl}/angebot/${externalId}`,
    title: "Volkswagen Golf 1.5 TSI",
    makeSlug: "volkswagen",
    modelSlug: "golf",
    makeRaw: "Volkswagen",
    modelRaw: "Golf",
    variant: "1.5 TSI",
    priceEur: 20000,
    mileageKm: 50000,
    firstRegistration: "2020-03-01",
    fuel: "petrol",
    transmission: "manual",
    powerKw: 96,
    bodyType: null,
    color: null,
    sellerType: null,
    sellerName: null,
    zip: "10115",
    city: "Berlin",
    lat: null,
    lng: null,
    ...overrides,
  };
}

interface Sighting {
  listing: NormalizedListing;
  segment?: string;
}

/** An adapter that returns the given listings, as a scraper would after parsing. */
function fakePortal(
  source: SourceInfo,
  sightings: Sighting[],
  options: { completedSegments?: string[]; staleAfterDays?: number; beforeEnd?: () => Promise<void> } = {},
): SourceAdapter {
  return {
    source,
    fullSnapshot: false,
    staleAfterDays: options.staleAfterDays,
    completedSegments: () => options.completedSegments ?? [],
    normalize: (raw: RawListing) => ({ ...(raw.payload as unknown as NormalizedListing) }),
    async *fetch() {
      for (const { listing, segment } of sightings) {
        yield { externalId: listing.externalId, payload: listing as unknown as Record<string, unknown>, segment };
      }
      await options.beforeEnd?.();
    },
  };
}

describe.skipIf(!url)("importing scraped portals", () => {
  let pool: Pool;

  const statusOf = async (source: SourceInfo, externalId: string) => {
    const { rows } = await pool.query<{ status: string; missed_runs: number; segment: string | null }>(
      "select status, missed_runs, segment from listings where source_id = $1 and external_id = $2",
      [source.id, externalId],
    );
    return rows[0];
  };

  beforeAll(async () => {
    pool = await freshTestDatabase();
  }, 60_000);

  beforeEach(async () => {
    await pool.query("delete from sources");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("stores listings without seller type and places them by postal code", async () => {
    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "1", { zip: "80331", city: "München" }) }]));
    const { items } = await searchListings(pool, parseFilters({}), null);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sellerType: null, sourceName: "Portal A", city: "München" });
    const { rows } = await pool.query("select lat, lng from listings");
    expect(rows[0].lat).toBeCloseTo(48.13, 1);
  });

  it("counts misses only in segments that were read completely", async () => {
    const all: Sighting[] = [
      { listing: car(PORTAL_A, "1"), segment: "vw:0-1000" },
      { listing: car(PORTAL_A, "2"), segment: "vw:0-1000" },
      { listing: car(PORTAL_A, "3"), segment: "vw:1000-2000" },
      { listing: car(PORTAL_A, "4") },
    ];
    await runIngest(pool, fakePortal(PORTAL_A, all, { completedSegments: ["vw:0-1000", "vw:1000-2000"] }));

    // Listings 2 and 3 are not seen again; only segment vw:0-1000 is read to the end.
    const later = fakePortal(PORTAL_A, [all[0], all[3]], { completedSegments: ["vw:0-1000"] });
    expect((await runIngest(pool, later)).gone).toBe(0);
    expect(await statusOf(PORTAL_A, "2")).toMatchObject({ status: "active", missed_runs: 1 });
    expect(await statusOf(PORTAL_A, "3")).toMatchObject({ status: "active", missed_runs: 0 });

    expect((await runIngest(pool, later)).gone).toBe(1);
    expect(await statusOf(PORTAL_A, "2")).toMatchObject({ status: "gone" });
    expect(await statusOf(PORTAL_A, "3")).toMatchObject({ status: "active", missed_runs: 0 });
    expect(await statusOf(PORTAL_A, "4")).toMatchObject({ status: "active", missed_runs: 0 });
    expect((await searchListings(pool, parseFilters({}), null)).total).toBe(3);
  });

  it("keeps a listing's segment when it is seen outside the segment, e.g. in the newest list", async () => {
    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "1"), segment: "vw:0-1000" }]));
    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "1") }]));
    expect(await statusOf(PORTAL_A, "1")).toMatchObject({ segment: "vw:0-1000" });
  });

  it("drops a listing's segment when a sighting outside it shows a new price", async () => {
    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "1", { priceEur: 900 }), segment: "vw:0-1000" }]));
    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "1", { priceEur: 1500 }) }]));
    expect(await statusOf(PORTAL_A, "1")).toMatchObject({ segment: null });

    // A complete read of its old segment no longer counts it as missed; the next sweep places it again.
    await runIngest(pool, fakePortal(PORTAL_A, [], { completedSegments: ["vw:0-1000"] }));
    expect(await statusOf(PORTAL_A, "1")).toMatchObject({ status: "active", missed_runs: 0 });
    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "1", { priceEur: 1500 }), segment: "vw:1000-2000" }]));
    expect(await statusOf(PORTAL_A, "1")).toMatchObject({ segment: "vw:1000-2000" });
  });

  it("drops the segment when a later sighting in the same run shows a new price", async () => {
    const sightings: Sighting[] = [
      { listing: car(PORTAL_A, "1", { priceEur: 900 }), segment: "vw:0-1000" },
      { listing: car(PORTAL_A, "1", { priceEur: 1500 }) },
      { listing: car(PORTAL_A, "2", { priceEur: 800 }), segment: "vw:0-1000" },
      { listing: car(PORTAL_A, "2", { priceEur: 800 }) },
    ];
    await runIngest(pool, fakePortal(PORTAL_A, sightings));
    expect(await statusOf(PORTAL_A, "1")).toMatchObject({ segment: null });
    expect(await statusOf(PORTAL_A, "2")).toMatchObject({ segment: "vw:0-1000" });
  });

  it("takes out listings not seen for staleAfterDays", async () => {
    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "1") }, { listing: car(PORTAL_A, "2") }]));
    await pool.query("update listings set last_seen_at = now() - interval '15 days' where external_id = '1'");
    const result = await runIngest(pool, fakePortal(PORTAL_A, [], { staleAfterDays: 14 }));
    expect(result.gone).toBe(1);
    expect(await statusOf(PORTAL_A, "1")).toMatchObject({ status: "gone" });
    expect(await statusOf(PORTAL_A, "2")).toMatchObject({ status: "active" });
  });

  it("refuses a second import of the same source while one is running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const slow = fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "1") }], {
      beforeEnd: async () => {
        started();
        await gate;
      },
    });
    const first = runIngest(pool, slow);
    try {
      await running;
      await expect(runIngest(pool, fakePortal(PORTAL_A, []))).rejects.toBeInstanceOf(IngestBusyError);
      // Other sources are not blocked.
      await expect(runIngest(pool, fakePortal(PORTAL_B, []))).resolves.toMatchObject({ fetched: 0 });
    } finally {
      release();
    }
    await expect(first).resolves.toMatchObject({ upserted: 1 });
    // The lock is released afterwards.
    await expect(runIngest(pool, fakePortal(PORTAL_A, []))).resolves.toMatchObject({ fetched: 0 });
  });

  it("shows a vehicle listed on two portals once, with the other offer", async () => {
    await runIngest(
      pool,
      fakePortal(PORTAL_A, [
        { listing: car(PORTAL_A, "a1", { priceEur: 20500, mileageKm: 50200 }) },
        { listing: car(PORTAL_A, "a2", { modelSlug: "polo", modelRaw: "Polo", priceEur: 9000 }) },
      ]),
    );
    await runIngest(
      pool,
      fakePortal(PORTAL_B, [
        // The same Golf, a little cheaper, a few km away, gearbox unknown.
        { listing: car(PORTAL_B, "b1", { priceEur: 19900, mileageKm: 50000, transmission: null, zip: "10117" }) },
        // Another Golf: too different in mileage.
        { listing: car(PORTAL_B, "b2", { mileageKm: 80000 }) },
      ]),
    );

    expect(await updateDuplicates(pool)).toEqual({ clusters: 1, listings: 2 });

    const result = await searchListings(pool, parseFilters({ make: "volkswagen", model: "golf" }), null);
    expect(result.total).toBe(2);
    const golf = result.items.find((item) => item.otherOffers.length > 0)!;
    // The cheaper listing represents the vehicle; the other portal is offered next to it.
    expect(golf).toMatchObject({ priceEur: 19900, sourceName: "Portal B" });
    expect(golf.otherOffers).toEqual([expect.objectContaining({ sourceName: "Portal A", priceEur: 20500 })]);

    const facets = await getMakeFacets(pool);
    expect(facets.find((f) => f.slug === "volkswagen")?.count).toBe(3);

    const detail = await getListing(pool, golf.id);
    expect(detail?.otherOffers.map((offer) => offer.sourceName)).toEqual(["Portal A"]);

    // Filtering by portal shows that portal's listing of the vehicle.
    const onlyA = await searchListings(pool, parseFilters({ make: "volkswagen", model: "golf", source: "portal-a" }), null);
    expect(onlyA.items.map((item) => item.priceEur)).toEqual([20500]);

    expect((await getSourceFacets(pool)).map((s) => s.id).sort()).toEqual(["portal-a", "portal-b"]);

    // A sold listing leaves its group.
    await pool.query("update listings set status = 'gone' where external_id = 'b1'");
    expect(await updateDuplicates(pool)).toEqual({ clusters: 0, listings: 0 });
  });

  it("never groups two listings of the same portal", async () => {
    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "a1") }, { listing: car(PORTAL_A, "a2") }]));
    expect(await updateDuplicates(pool)).toEqual({ clusters: 0, listings: 0 });
  });

  it("removes the demo data once real listings are in", async () => {
    await runIngest(pool, createDemoAdapter({ count: 20, seed: 1 }));
    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "1") }]));
    expect((await getSourceStatus(pool)).map((s) => s.kind).sort()).toEqual(["demo", "scrape"]);

    expect(await removeDemoData(pool)).toBe(20);
    expect((await searchListings(pool, parseFilters({}), null)).total).toBe(1);
    expect((await getSourceStatus(pool)).map((s) => s.id)).toEqual(["portal-a"]);
  });
});

describe.skipIf(!url)("crawling AutoScout24 result lists", () => {
  let pool: Pool;

  interface Car {
    id: string;
    price: number;
    ad?: boolean;
  }

  /** Cars named prefix-0, prefix-1, ... with the given prices. */
  const cars = (prefix: string, prices: number[]): Car[] => prices.map((price, i) => ({ id: `${prefix}-${i}`, price }));

  /** A synthetic result list page; ads are marked as such. */
  const page = (list: Car[], total: number, pages: number) => {
    const listings = list.map(({ id, price, ad }) => ({
      id,
      url: `/angebote/bmw-320d-${id}`,
      vehicle: { make: "BMW", model: "320", modelGroup: "3er", mileageInKm: "120.000 km", fuel: "Diesel" },
      price: { priceFormatted: `€ ${price.toLocaleString("de-DE")},-` },
      vehicleDetails: [{ iconName: "calendar", data: "05/2015" }],
      seller: { type: "Private" },
      location: { zip: "50667", city: "Köln", countryCode: "DE" },
      searchResultType: ad ? "TopSpot" : "Organic",
    }));
    const data = { props: { pageProps: { listings, numberOfResults: total, numberOfPages: pages } } };
    return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
  };

  function fakeSite(routes: Map<string, string>) {
    const requested: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      const href = String(input);
      requested.push(href);
      if (href.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /angebote/\nAllow: /lst/\n");
      // Price ranges we did not set up are empty.
      return new Response(routes.get(href) ?? page([], 0, 1));
    }) as typeof fetch;
    return { fetcher: new PoliteFetcher({ fetchImpl, sleep: async () => undefined, minDelayMs: 0, random: () => 0 }), requested };
  }

  const range = (from: number, to: number | null) => ({ from, to });

  beforeAll(async () => {
    pool = await freshTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("splits large segments by price, reads small ones to the end and counts misses there", async () => {
    const routes = new Map<string, string>([
      // Newest pass and the whole make: more results than 2 pages can show.
      [listUrl("bmw", 1), page(cars("new", [25000, 31000]), 100, 5)],
      // 0-1000: three cars and an ad from another price range.
      [listUrl("bmw", 1, range(0, 1000)), page([...cars("cheap", [500, 700, 900]), { id: "ad-0", price: 30000, ad: true }], 3, 1)],
      // 1000-2000: too many for 2 pages, split again.
      [listUrl("bmw", 1, range(1000, 2000)), page(cars("mid", [1100, 1600]), 50, 3)],
      // 1000-1500: 25 results on two pages.
      [listUrl("bmw", 1, range(1000, 1500)), page(cars("low", Array.from({ length: 20 }, (_, i) => 1000 + i * 10)), 25, 2)],
      [listUrl("bmw", 2, range(1000, 1500)), page(cars("low2", Array.from({ length: 5 }, (_, i) => 1300 + i * 10)), 25, 2)],
      // 1500-2000: three results reported, but one listing shows up twice and another not at all.
      [listUrl("bmw", 1, range(1500, 2000)), page([...cars("dup", [1600, 1700]), { id: "dup-0", price: 1600 }], 3, 1)],
    ]);
    const crawl = () => {
      const site = fakeSite(routes);
      return { site, adapter: createAutoScout24Adapter({ fetcher: site.fetcher, makes: ["bmw"], maxPagesPerSegment: 2 }) };
    };

    const first = crawl();
    const result = await runIngest(pool, first.adapter);
    expect(result.gone).toBe(0);
    expect(first.adapter.completedSegments!()).toEqual(expect.arrayContaining(["bmw:0-1000", "bmw:1000-1500"]));
    expect(first.adapter.completedSegments!()).not.toContain("bmw:1000-2000");
    // Not every reported listing came in: nothing there may count as sold.
    expect(first.adapter.completedSegments!()).not.toContain("bmw:1500-2000");
    // Detail pages are never requested.
    expect(first.site.requested.some((href) => href.includes("/angebote/"))).toBe(false);

    const segments = await pool.query<{ key: string; retired: boolean; last_total: number | null; last_completed_at: Date | null }>(
      "select key, retired, last_total, last_completed_at from crawl_segments where source_id = 'autoscout24'",
    );
    const byKey = new Map(segments.rows.map((row) => [row.key, row]));
    expect(byKey.get("bmw:0-")).toMatchObject({ retired: true, last_total: 100 });
    expect(byKey.get("bmw:1000-2000")).toMatchObject({ retired: true });
    expect(byKey.get("bmw:1000-1500")).toMatchObject({ retired: false, last_total: 25 });
    expect(byKey.get("bmw:1000-1500")!.last_completed_at).not.toBeNull();
    expect(byKey.get("bmw:1500-2000")).toMatchObject({ retired: false });

    const stored = await pool.query<{ external_id: string; segment: string | null; model_slug: string; seller_type: string; seller_name: string | null }>(
      "select external_id, segment, model_slug, seller_type, seller_name from listings order by external_id",
    );
    const segmentOf = new Map(stored.rows.map((row) => [row.external_id, row.segment]));
    expect(segmentOf.get("cheap-0")).toBe("bmw:0-1000");
    expect(segmentOf.get("low2-4")).toBe("bmw:1000-1500");
    // The ad belongs to no segment it was shown in.
    expect(segmentOf.get("ad-0")).toBeNull();
    expect(stored.rows.every((row) => row.model_slug === "3er" && row.seller_type === "private" && row.seller_name === null)).toBe(true);

    // The 700 EUR car is sold: it is gone after two complete reads of its segment without it.
    routes.set(listUrl("bmw", 1, range(0, 1000)), page(cars("cheap", [500, 700, 900]).filter((c) => c.id !== "cheap-1"), 2, 1));
    await runIngest(pool, crawl().adapter);
    const missedOnce = await pool.query("select status, missed_runs from listings where external_id = 'cheap-1'");
    expect(missedOnce.rows[0]).toEqual({ status: "active", missed_runs: 1 });
    await runIngest(pool, crawl().adapter);
    const gone = await pool.query("select external_id from listings where status = 'gone'");
    expect(gone.rows.map((row) => row.external_id)).toEqual(["cheap-1"]);
  });

  it("does not count a segment as read completely when its list changed between pages", async () => {
    const routes = new Map<string, string>([
      [listUrl("skoda", 1), page(cars("p1", Array.from({ length: 20 }, (_, i) => 5000 + i)), 30, 2)],
      // Page 2 sees one more listing than page 1 did: something moved while we read.
      [listUrl("skoda", 2), page(cars("p2", Array.from({ length: 10 }, (_, i) => 6000 + i)), 31, 2)],
    ]);
    const site = fakeSite(routes);
    const adapter = createAutoScout24Adapter({ fetcher: site.fetcher, makes: ["skoda"], maxPagesPerSegment: 2 });
    await runIngest(pool, adapter);
    expect(adapter.completedSegments!()).not.toContain("skoda:0-");

    // The same list with steady counts is complete.
    routes.set(listUrl("skoda", 2), page(cars("p2", Array.from({ length: 10 }, (_, i) => 6000 + i)), 30, 2));
    const steady = createAutoScout24Adapter({ fetcher: fakeSite(routes).fetcher, makes: ["skoda"], maxPagesPerSegment: 2 });
    await runIngest(pool, steady);
    expect(steady.completedSegments!()).toContain("skoda:0-");
  });

  it("keeps to the request budget, leaves half of it for the sweep and keeps what it read", async () => {
    await pool.query("delete from sources");
    const requested: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      requested.push(String(input));
      return String(input).endsWith("/robots.txt")
        ? new Response("User-agent: *\nAllow: /\n")
        : new Response(page(cars(String(input), [5000, 6000]), 2, 1));
    }) as typeof fetch;
    const fetcher = new PoliteFetcher({ fetchImpl, sleep: async () => undefined, minDelayMs: 0, random: () => 0, maxRequests: 6 });
    const adapter = createAutoScout24Adapter({ fetcher, makes: ["bmw", "audi", "opel", "ford"] });
    const result = await runIngest(pool, adapter);
    expect(result.upserted).toBeGreaterThan(0);
    // robots.txt and the newest pages of BMW and Audi use half; the sweep reads two whole makes.
    // One request stays unused: a segment is only started with two left.
    expect(requested.filter((href) => href.endsWith("/robots.txt"))).toHaveLength(1);
    expect(fetcher.requestsMade).toBe(5);
    expect(adapter.completedSegments!()).toEqual(["audi:0-", "bmw:0-"]);
  });

  it("needs only the import's own database connection", async () => {
    const single = new Pool({ connectionString: url, max: 1 });
    try {
      const site = fakeSite(new Map([[listUrl("bmw", 1), page(cars("one", [5000]), 1, 1)]]));
      const adapter = createAutoScout24Adapter({ fetcher: site.fetcher, makes: ["bmw"] });
      await expect(runIngest(single, adapter)).resolves.toMatchObject({ upserted: 1 });
    } finally {
      await single.end();
    }
  });
});

describe.skipIf(!url)("reading the mobile.de Search-API", () => {
  let pool: Pool;
  const PAGE = 2;

  /** Ads in the Search-API's JSON format, named prefix-0, prefix-1, ... with the given prices. */
  const ads = (prefix: string, prices: number[]) =>
    prices.map((price, i) => ({
      mobileAdId: `${prefix}-${i}`,
      make: "BMW",
      model: "320",
      modelDescription: "320d Touring",
      detailPageUrl: `https://suchen.mobile.de/auto-inserat/bmw-320/${prefix}-${i}.html?source=api`,
      mileage: 120000,
      firstRegistration: "201505",
      fuel: "DIESEL",
      gearbox: "AUTOMATIC_GEAR",
      seller: { type: "DEALER", companyName: "Autohaus Köln", phones: [{ number: "0221 1" }], address: { zipcode: "50667", city: "Köln", country: "DE" } },
      price: { consumerPriceGross: `${price}.00`, currency: "EUR" },
    }));
  const answer = (list: unknown[], total: number, maxPages: number) => JSON.stringify({ total, currentPage: 1, maxPages, pageSize: PAGE, ads: list });
  const range = (from: number, to: number | null) => ({ from, to });
  const search = (page: number, price?: { from: number; to: number | null }, make = "bmw") => searchUrl(make, page, price, PAGE);

  function fakeApi(routes: Map<string, string>, status = 200) {
    const requests: { url: string; authorization: string }[] = [];
    const api = new MobileDeApi({
      user: "test-user",
      password: "test-password",
      minDelayMs: 0,
      sleep: async () => undefined,
      fetchImpl: (async (input: string | URL, init?: RequestInit) => {
        requests.push({ url: String(input), authorization: (init?.headers as Record<string, string>).authorization });
        return new Response(routes.get(String(input)) ?? answer([], 0, 0), { status });
      }) as typeof fetch,
    });
    return { api, requests };
  }

  const adapterFor = (make: string, routes: Map<string, string>, status = 200) =>
    createMobileDeAdapter({ api: fakeApi(routes, status).api, makes: [make], pageSize: PAGE });

  beforeAll(async () => {
    pool = await freshTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("reads newest ads and price segments and counts misses only in segments read completely", async () => {
    const routes = new Map<string, string>([
      // Newest changes and the whole make: more than the API pages through, so it is split.
      [search(1), answer(ads("new", [25000, 31000]), 2500, 1250)],
      // 0-1000: three ads on two pages.
      [search(1, range(0, 1000)), answer(ads("cheap", [500, 900]), 3, 2)],
      [search(2, range(0, 1000)), answer(ads("cheap2", [700]), 3, 2)],
      // 1000-2000: the list grows while it is read, so it does not count as complete.
      [search(1, range(1000, 2000)), answer(ads("mid", [1100, 1200]), 3, 2)],
      [search(2, range(1000, 2000)), answer(ads("mid2", [1300, 1400]), 4, 2)],
    ]);
    const crawl = () => {
      const fake = fakeApi(routes);
      return { ...fake, adapter: createMobileDeAdapter({ api: fake.api, makes: ["bmw"], pageSize: PAGE }) };
    };

    const first = crawl();
    await runIngest(pool, first.adapter);
    expect(first.adapter.completedSegments!()).toContain("bmw:0-1000");
    expect(first.adapter.completedSegments!()).not.toContain("bmw:1000-2000");
    expect(first.adapter.completedSegments!()).not.toContain("bmw:0-");
    // Only the API is asked, always with the API account.
    expect(first.requests.every((r) => r.url.startsWith("https://services.mobile.de/search-api/search?"))).toBe(true);
    expect(first.requests.every((r) => r.authorization.startsWith("Basic "))).toBe(true);

    const source = await pool.query("select name, kind from sources where id = 'mobilede'");
    expect(source.rows[0]).toEqual({ name: "mobile.de", kind: "api" });
    const stored = await pool.query<{ external_id: string; segment: string | null; model_slug: string | null; seller_name: string | null; fuel: string; zip: string }>(
      "select external_id, segment, model_slug, seller_name, fuel, zip from listings where source_id = 'mobilede' order by external_id",
    );
    const byId = new Map(stored.rows.map((row) => [row.external_id, row]));
    expect(byId.get("cheap-1")).toMatchObject({ segment: "bmw:0-1000", seller_name: "Autohaus Köln", fuel: "diesel", zip: "50667" });
    expect(byId.get("new-0")?.segment).toBeNull();
    const raw = await pool.query("select payload::text as payload from raw_listings where source_id = 'mobilede'");
    expect(raw.rows.some((row) => row.payload.includes("0221"))).toBe(false);

    // The 900 EUR car is sold: gone after two complete reads of its segment without it.
    routes.set(search(1, range(0, 1000)), answer([...ads("cheap", [500]), ...ads("cheap2", [700])], 2, 1));
    await runIngest(pool, crawl().adapter);
    const once = await pool.query("select status, missed_runs from listings where external_id = 'cheap-1'");
    expect(once.rows[0]).toEqual({ status: "active", missed_runs: 1 });
    await runIngest(pool, crawl().adapter);
    const gone = await pool.query("select external_id from listings where source_id = 'mobilede' and status = 'gone'");
    expect(gone.rows.map((row) => row.external_id)).toEqual(["cheap-1"]);
    // The segment that changed while it was read never takes anything out.
    expect((await pool.query("select status from listings where external_id = 'mid-0'")).rows[0].status).toBe("active");
  });
  it("moves listings of a split range to the smaller ranges, so their misses still count", async () => {
    const routes = new Map<string, string>([
      [search(1, undefined, "audi"), answer(ads("a-new", [30000]), 2500, 1250)],
      [search(1, range(1000, 2000), "audi"), answer(ads("a", [1100, 1600]), 2, 1)],
    ]);
    await runIngest(pool, adapterFor("audi", routes));
    const tagged = await pool.query("select segment from listings where external_id = 'a-1'");
    expect(tagged.rows[0].segment).toBe("audi:1000-2000");

    // The range grew too large and is split; the 1600 EUR car was sold meanwhile.
    routes.set(search(1, range(1000, 2000), "audi"), answer(ads("a", [1100]), 2500, 1250));
    routes.set(search(1, range(1000, 1500), "audi"), answer(ads("a", [1100]), 1, 1));
    const second = adapterFor("audi", routes);
    await runIngest(pool, second);
    expect(second.completedSegments!()).toEqual(expect.arrayContaining(["audi:1000-1500", "audi:1500-2000"]));
    const sold = await pool.query("select segment, missed_runs from listings where external_id = 'a-1'");
    expect(sold.rows[0]).toEqual({ segment: "audi:1500-2000", missed_runs: 1 });
  });

  it("counts cars without a price when it reads a whole make", async () => {
    const unpriced = { ...ads("o-np", [1000])[0], price: {} };
    const routes = new Map([[search(1, undefined, "opel"), answer([...ads("o", [5000]), unpriced], 2, 1)]]);
    const adapter = adapterFor("opel", routes);
    await runIngest(pool, adapter);
    expect(adapter.completedSegments!()).toContain("opel:0-");
  });

  it("fails a run in which every search is rejected, and takes nothing out", async () => {
    await pool.query("update listings set last_seen_at = now() - interval '40 days' where external_id = 'a-0'");
    const before = (await pool.query<{ now: Date }>("select now()")).rows[0].now;
    await expect(runIngest(pool, adapterFor("audi", new Map(), 400))).rejects.toThrow(/none of \d+ searches succeeded/);
    expect((await pool.query("select status from listings where external_id = 'a-0'")).rows[0].status).toBe("active");

    // Every segment's attempt was recorded although its first page failed, so it moves to the back.
    const untried = await pool.query(
      "select key from crawl_segments where source_id = 'mobilede' and key like 'audi:%' and not retired and (last_started_at is null or last_started_at < $1)",
      [before],
    );
    expect(untried.rows).toEqual([]);
  });
});
