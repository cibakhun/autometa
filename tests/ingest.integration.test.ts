import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedListing } from "@/core/types";
import type { CheckOutcome, ListingRef, RawListing, SourceAdapter, SourceInfo } from "@/ingest/adapter";
import { createAutoScout24Adapter, listUrl, paceDelayMs, planPages } from "@/ingest/adapters/autoscout24";
import { createDemoAdapter } from "@/ingest/adapters/demo";
import { updateDuplicates } from "@/ingest/duplicates";
import { BlockedError, PoliteFetcher } from "@/ingest/http/fetcher";
import { migrate } from "@/ingest/migrate";
import { removeDemoData } from "@/ingest/pipeline";
import { IngestBusyError, runIngest } from "@/ingest/run";
import { seedReferenceData } from "@/ingest/seed";
import { getSourceHealth, updateSourceStats } from "@/ingest/status";
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
    imageUrl: null,
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
  options: {
    completedSegments?: string[];
    staleAfterDays?: number;
    beforeEnd?: () => Promise<void>;
    /** What each listing's own page says, for a portal whose listings are checked one by one. */
    checks?: { outcomes: Record<string, CheckOutcome>; due: ListingRef[]; blockAt?: string };
  } = {},
): SourceAdapter {
  const checks = options.checks;
  return {
    source,
    fullSnapshot: false,
    staleAfterDays: options.staleAfterDays,
    completedSegments: () => options.completedSegments ?? [],
    ...(checks && {
      async *checkListings(due: ListingRef[]) {
        for (const ref of due) {
          if (ref.externalId === checks.blockAt) throw new BlockedError(ref.url, "rate limited (429)");
          checks.due.push(ref);
          const outcome = checks.outcomes[ref.externalId];
          if (outcome) yield { externalId: ref.externalId, outcome };
        }
      },
    }),
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

  it("checks listings not seen for a day on their own page, the longest unchecked first", async () => {
    await runIngest(pool, fakePortal(PORTAL_A, ["1", "2", "3", "4", "5"].map((id) => ({ listing: car(PORTAL_A, id) }))));
    for (const [id, hours] of [["1", 30], ["2", 40], ["3", 25], ["4", 10], ["5", 50]] as const) {
      await pool.query("update listings set last_seen_at = now() - make_interval(hours => $2), missed_runs = 1 where external_id = $1", [id, hours]);
    }
    const checks = { outcomes: { "1": "active", "2": "gone", "3": "unclear", "5": "active" } as Record<string, CheckOutcome>, due: [] as ListingRef[] };
    const result = await runIngest(pool, fakePortal(PORTAL_A, [], { checks }));

    // Listing 4 was seen 10 hours ago and is not due yet.
    expect(checks.due.map((ref) => ref.externalId)).toEqual(["5", "2", "1", "3"]);
    expect(checks.due[0].url).toBe("https://a.example/angebot/5");
    expect(result).toMatchObject({ checked: 4, gone: 1 });
    const { rows } = await pool.query<{ external_id: string; status: string; gone_reason: string | null; gone_at: Date | null; hours: number; missed_runs: number }>(
      `select external_id, status, gone_reason, gone_at, missed_runs,
              round(extract(epoch from now() - last_seen_at) / 3600)::int as hours
         from listings order by external_id`,
    );
    const byId = new Map(rows.map((row) => [row.external_id, row]));
    expect(byId.get("1")).toMatchObject({ status: "active", hours: 0, missed_runs: 0, gone_reason: null });
    expect(byId.get("2")).toMatchObject({ status: "gone", gone_reason: "checked", hours: 40 });
    expect(byId.get("2")!.gone_at).not.toBeNull();
    // Unclear changes nothing.
    expect(byId.get("3")).toMatchObject({ status: "active", hours: 25, missed_runs: 1 });
    expect(byId.get("4")).toMatchObject({ status: "active", hours: 10 });
    expect(byId.get("5")).toMatchObject({ status: "active", hours: 0 });
    const run = await pool.query("select checked, gone from ingest_runs where id = $1", [result.runId]);
    expect(run.rows[0]).toEqual({ checked: 4, gone: 1 });
  });

  it("keeps the checks and the clean-up when the portal blocks a listing page", async () => {
    await runIngest(pool, fakePortal(PORTAL_A, ["1", "2", "3"].map((id) => ({ listing: car(PORTAL_A, id) }))));
    await pool.query("update listings set last_seen_at = now() - make_interval(hours => 30 + id::int % 3)");
    await pool.query("update listings set last_seen_at = now() - interval '3 days' where external_id = '3'");
    const checks = { outcomes: { "3": "active" } as Record<string, CheckOutcome>, due: [] as ListingRef[], blockAt: "1" };
    // Due: 3 (oldest), then 1 and 2; the portal blocks at 1.
    const result = await runIngest(pool, fakePortal(PORTAL_A, [], { checks, staleAfterDays: 2 }));
    expect(result).toMatchObject({ checked: 1, gone: 0 });
    const run = await pool.query("select error, finished_at is not null as finished from ingest_runs where id = $1", [result.runId]);
    expect(run.rows[0].finished).toBe(true);
    expect(run.rows[0].error).toMatch(/^Einzelprüfung abgebrochen: Blocked by a\.example: rate limited \(429\)/);
    // Listing 3 was confirmed before the block, so the clean-up afterwards keeps it.
    const { rows } = await pool.query("select external_id, status from listings order by external_id");
    expect(rows).toEqual([
      { external_id: "1", status: "active" },
      { external_id: "2", status: "active" },
      { external_id: "3", status: "active" },
    ]);
  });

  it("records why a listing left and forgets it when the listing comes back", async () => {
    const reasonOf = async (id: string) =>
      (await pool.query("select status, gone_reason, gone_at is not null as dated from listings where external_id = $1", [id])).rows[0];
    await runIngest(
      pool,
      fakePortal(PORTAL_A, [
        { listing: car(PORTAL_A, "sold"), segment: "vw:0-1000" },
        { listing: car(PORTAL_A, "old") },
      ]),
    );
    await pool.query("update listings set last_seen_at = now() - interval '3 days' where external_id = 'old'");
    const missing = () => fakePortal(PORTAL_A, [], { completedSegments: ["vw:0-1000"], staleAfterDays: 2 });
    await runIngest(pool, missing());
    expect(await reasonOf("old")).toEqual({ status: "gone", gone_reason: "stale", dated: true });
    await runIngest(pool, missing());
    expect(await reasonOf("sold")).toEqual({ status: "gone", gone_reason: "missed", dated: true });

    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "old") }]));
    expect(await reasonOf("old")).toEqual({ status: "active", gone_reason: null, dated: false });

    const health = (await getSourceHealth(pool)).find((source) => source.id === PORTAL_A.id)!;
    expect(health.goneLastDay).toEqual({ missed: 1, checked: 0, stale: 0 });
  });

  it("counts per source how many listings were seen or confirmed in the last 24 hours", async () => {
    await runIngest(pool, fakePortal(PORTAL_A, ["1", "2", "3"].map((id) => ({ listing: car(PORTAL_A, id) }))));
    await runIngest(pool, fakePortal(PORTAL_B, [{ listing: car(PORTAL_B, "1", { modelSlug: "polo" }) }]));
    await pool.query("update listings set last_seen_at = now() - interval '30 hours' where source_id = $1 and external_id = '3'", [PORTAL_A.id]);

    const stats = await updateSourceStats(pool);
    expect(stats).toEqual([
      { sourceId: PORTAL_A.id, active: 3, checked24h: 2 },
      { sourceId: PORTAL_B.id, active: 1, checked24h: 1 },
    ]);
    const status = await getSourceStatus(pool);
    expect(status.find((source) => source.id === PORTAL_A.id)?.checkedShare).toBeCloseTo(2 / 3);
    const health = (await getSourceHealth(pool)).find((source) => source.id === PORTAL_A.id)!;
    expect(health).toMatchObject({ activeListings: 3, checked24h: 2, plan: null });
    expect(new Date(health.oldestCheckAt!).getTime()).toBeLessThan(Date.now() - 29 * 3_600_000);

    const { items } = await searchListings(pool, parseFilters({ source: PORTAL_A.id }), null);
    expect(items.every((item) => typeof item.checkedAt === "string")).toBe(true);
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

  it("links the preview photo, keeps it when a sighting has none, and lends it to a duplicate", async () => {
    const photo = "https://img.a.example/golf.jpg";
    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "a1", { priceEur: 20500, imageUrl: photo }) }]));
    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "a1", { priceEur: 20500, imageUrl: null }) }]));
    // The same Golf on another portal, cheaper and without a photo.
    await runIngest(pool, fakePortal(PORTAL_B, [{ listing: car(PORTAL_B, "b1", { priceEur: 19900 }) }]));
    expect(await updateDuplicates(pool)).toEqual({ clusters: 1, listings: 2 });

    const { items } = await searchListings(pool, parseFilters({}), null);
    expect(items).toEqual([expect.objectContaining({ sourceName: "Portal B", priceEur: 19900, imageUrl: photo })]);
    expect(await getListing(pool, items[0].id)).toMatchObject({ sourceName: "Portal B", imageUrl: photo });

    await pool.query("update listings set status = 'gone' where external_id = 'a1'");
    expect((await getListing(pool, items[0].id))?.imageUrl).toBeNull();
  });

  it("reads the HU from the title or the first registration and filters by it", async () => {
    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    await runIngest(
      pool,
      fakePortal(PORTAL_A, [
        { listing: car(PORTAL_A, "fresh", { title: "VW Golf 1.4 TÜV neu", firstRegistration: "2012-01-01" }) },
        { listing: car(PORTAL_A, "stated", { title: `VW Golf HU 12/${now.getUTCFullYear() + 1}`, firstRegistration: "2012-01-01" }) },
        { listing: car(PORTAL_A, "expired", { title: "VW Golf HU abgelaufen", firstRegistration: "2012-01-01" }) },
        { listing: car(PORTAL_A, "unknown", { title: "VW Golf 1.4", firstRegistration: "2012-01-01" }) },
        { listing: car(PORTAL_A, "young", { title: "VW Golf 1.5 eTSI", firstRegistration: thisMonth, mileageKm: 10 }) },
        // Junk in the car category with a recent first registration gets no HU from it.
        { listing: car(PORTAL_A, "rims", { title: "4 VW Alufelgen mit Reifen", firstRegistration: thisMonth, priceEur: 350, mileageKm: 0 }) },
      ]),
    );
    const ids = async (hu: string) =>
      (await searchListings(pool, parseFilters({ hu }), null)).items.map((item) => item.title).sort();
    expect(await ids("12")).toEqual(["VW Golf 1.4 TÜV neu", "VW Golf 1.5 eTSI", `VW Golf HU 12/${now.getUTCFullYear() + 1}`]);
    expect(await ids("neu")).toEqual(expect.arrayContaining(["VW Golf 1.4 TÜV neu", "VW Golf 1.5 eTSI"]));
    expect(await ids("neu")).not.toContain("VW Golf HU abgelaufen");

    const all = await searchListings(pool, parseFilters({}), null);
    expect(all.items.find((item) => item.title.endsWith("abgelaufen"))).toMatchObject({ huUntil: null, huBasis: "expired" });
    expect(all.items.find((item) => item.title === "VW Golf 1.4")).toMatchObject({ huUntil: null, huBasis: null });
    expect(all.items.find((item) => item.title.includes("Alufelgen"))).toMatchObject({ huUntil: null, huBasis: null });

    // "TÜV neu" counts from the first sighting: a later sighting does not push the date out.
    await pool.query("update listings set hu_until = '2026-01-01' where external_id = 'fresh'");
    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "fresh", { title: "VW Golf 1.4 TÜV neu", firstRegistration: "2012-01-01" }) }]));
    const fresh = await pool.query("select to_char(hu_until, 'YYYY-MM-DD') as until, hu_basis from listings where external_id = 'fresh'");
    expect(fresh.rows[0]).toEqual({ until: "2026-01-01", hu_basis: "relative" });
  });

  it("keeps cars that are given away at 0 € and finds them with a price limit of 0", async () => {
    await runIngest(pool, fakePortal(PORTAL_A, [{ listing: car(PORTAL_A, "gift", { priceEur: 0 }) }, { listing: car(PORTAL_A, "sale") }]));
    const free = await searchListings(pool, parseFilters({ priceMax: "0" }), null);
    expect(free.items.map((item) => item.priceEur)).toEqual([0]);
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

  it("stops quietly when the request budget is used up and keeps what it read", async () => {
    await pool.query("delete from sources");
    const fetchImpl = (async (input: string | URL) =>
      String(input).endsWith("/robots.txt")
        ? new Response("User-agent: *\nAllow: /\n")
        : new Response(page(cars(String(input), [5000, 6000]), 2, 1))) as typeof fetch;
    const fetcher = new PoliteFetcher({ fetchImpl, sleep: async () => undefined, minDelayMs: 0, random: () => 0, maxRequests: 3 });
    const adapter = createAutoScout24Adapter({ fetcher, makes: ["bmw", "audi", "opel", "ford"] });
    const result = await runIngest(pool, adapter);
    expect(fetcher.requestsMade).toBe(3);
    expect(result.upserted).toBeGreaterThan(0);
  });

  it("paces itself to read the whole plan once per cycle", async () => {
    await pool.query("delete from crawl_segments where source_id = 'autoscout24' and key like 'fiat:%'");
    await pool.query(
      `insert into crawl_segments (source_id, key, params, retired) values ('autoscout24', 'fiat:0-', '{"make":"fiat","priceFrom":0,"priceTo":null}', true)`,
    );
    for (let i = 0; i < 30; i += 1) {
      const params = { make: "fiat", priceFrom: i * 100, priceTo: i * 100 + 100 };
      await pool.query(
        "insert into crawl_segments (source_id, key, params, last_total) values ('autoscout24', $1, $2, 400)",
        [`fiat:${params.priceFrom}-${params.priceTo}`, JSON.stringify(params)],
      );
    }
    const pace = { cycleHours: 1, runMinutes: 50, intervalMinutes: 60, minDelayMs: 1000, maxDelayMs: 9000 };
    const lines: string[] = [];
    // A virtual clock: the pauses the pace sets are waited out at once.
    let clock = 0;
    const fetchImpl = (async (input: string | URL) =>
      String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /\n") : new Response(page([], 0, 1))) as typeof fetch;
    const fetcher = new PoliteFetcher({ fetchImpl, now: () => clock, sleep: async (ms) => void (clock += ms), random: () => 0 });
    const adapter = createAutoScout24Adapter({ fetcher, makes: ["fiat"], pace, log: (line) => lines.push(line) });
    await runIngest(pool, adapter);

    // Before reading: 30 segments of 400 listings, 20 pages each.
    const first = paceDelayMs(600, 1, pace, 500);
    expect(first).toBeGreaterThan(pace.minDelayMs);
    expect(first).toBeLessThan(pace.maxDelayMs);
    expect(lines[0]).toBe(`pace: ${(first / 1000).toFixed(1)} s between requests for about 600 pages per 1 h`);
    // All of them turned out empty: one page each, no need to hurry.
    expect(planPages(Array.from({ length: 30 }, () => ({ lastTotal: 0 })), 20)).toBe(30);
    expect(fetcher.delayMs).toBe(pace.maxDelayMs);
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
