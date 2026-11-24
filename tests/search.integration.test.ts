import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { haversineKm } from "@/core/geo";
import { createDemoAdapter } from "@/ingest/adapters/demo";
import { migrate } from "@/ingest/migrate";
import { prepareData } from "@/ingest/prepare";
import { runIngest } from "@/ingest/run";
import { seedReferenceData } from "@/ingest/seed";
import { parseFilters } from "@/search/filters";
import { ageBucketSql, findTown, getMakeFacets, recommendationScore, recordClick, resolveZip, searchListings } from "@/search/query";
import { emptyTestDatabase } from "./test-database";

/**
 * Runs against a real Postgres. Set TEST_DATABASE_URL to a database whose name contains "test";
 * its public schema is wiped before the run.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("search against Postgres", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await emptyTestDatabase();
    await migrate(pool);
    await seedReferenceData(pool);
    await runIngest(pool, createDemoAdapter({ count: 600, seed: 3 }));
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("is idempotent when migrations run again", async () => {
    expect(await migrate(pool)).toEqual([]);
  });

  it("accepts scraped portals as a source kind", async () => {
    await pool.query("insert into sources (id, name, kind) values ('scrape-probe', 'Probe', 'scrape')");
    await pool.query("delete from sources where id = 'scrape-probe'");
    await expect(pool.query("insert into sources (id, name, kind) values ('bad-probe', 'Probe', 'crawl')")).rejects.toThrow(
      /sources_kind_check/,
    );
  });

  it("applies a migration once when two runs start at the same time", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "autometa-migrations-"));
    try {
      // The sleep keeps the first run busy while the second starts; without "if not exists",
      // a second application of this file would fail.
      await writeFile(path.join(dir, "99990101000000_lock_probe.sql"), "select pg_sleep(0.3); create table lock_probe (id int);");
      const [a, b] = await Promise.all([migrate(pool, dir), migrate(pool, dir)]);
      expect([...a, ...b]).toEqual(["99990101000000_lock_probe"]);
    } finally {
      await pool.query("drop table if exists lock_probe; delete from autometa_migrations where version = '99990101000000_lock_probe'");
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("applies every filter", async () => {
    const filters = parseFilters({ make: "volkswagen", priceMax: "20000", yearMin: "2015", fuel: ["diesel", "petrol"], transmission: "manual" });
    const result = await searchListings(pool, filters, null);
    expect(result.total).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.makeSlug).toBe("volkswagen");
      expect(item.priceEur).toBeLessThanOrEqual(20000);
      expect(Number(item.firstRegistration!.slice(0, 4))).toBeGreaterThanOrEqual(2015);
      expect(["diesel", "petrol"]).toContain(item.fuel);
      expect(item.transmission).toBe("manual");
    }
  });

  it("finds listings whose price dropped, the latest drop first", async () => {
    const { rows } = await pool.query<{ id: string; price_eur: number }>(
      "select id, price_eur from listings where status = 'active' order by id limit 3",
    );
    const [recent, older, raised] = rows.map((row) => ({ id: Number(row.id), price: row.price_eur }));
    try {
      for (const car of [recent, older, raised]) await pool.query("update listings set price_eur = $2 where id = $1", [car.id, car.price - 500]);
      await pool.query("update listings set price_dropped_at = now() - interval '10 days' where id = $1", [older.id]);
      // A rise after the drop: the last change is no drop any more.
      await pool.query("update listings set price_eur = $2 where id = $1", [raised.id, raised.price]);

      const ids = async (query: Record<string, string>) => (await searchListings(pool, parseFilters(query), null)).items.map((item) => item.id);
      expect(await ids({ gesenkt: "3" })).toEqual([recent.id]);
      expect((await ids({ gesenkt: "30" })).sort()).toEqual([recent.id, older.id].sort());
      expect((await ids({ gesenkt: "ja", sort: "price_drop" }))).toEqual([recent.id, older.id]);
      expect((await ids({ sort: "price_drop" })).slice(0, 2)).toEqual([recent.id, older.id]);
      const [item] = (await searchListings(pool, parseFilters({ gesenkt: "3" }), null)).items;
      expect(item).toMatchObject({ priceEur: recent.price - 500, priceBeforeDropEur: recent.price });
      expect(parseFilters({ gesenkt: "14" }).gesenkt).toBeUndefined();
    } finally {
      for (const car of [recent, older, raised]) {
        await pool.query("update listings set price_eur = $2, price_dropped_at = null, price_before_drop_eur = null where id = $1", [car.id, car.price]);
      }
    }
  });

  it("sorts by price and pages through results", async () => {
    const first = await searchListings(pool, parseFilters({ sort: "price_asc" }), null);
    const prices = first.items.map((i) => i.priceEur);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    const second = await searchListings(pool, parseFilters({ sort: "price_asc", page: "2" }), null);
    expect(second.items[0].priceEur).toBeGreaterThanOrEqual(prices.at(-1)!);
    expect(first.total).toBe(600);
  });

  it("shows a vehicle on several portals once, with its cheapest matching listing, in every sort", async () => {
    // Fixtures and searches in one transaction that is rolled back, so the shared listings stay as they were.
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Three listings of the most common model, searched by that model.
      const { rows } = await client.query<{ id: string; make_slug: string; model_slug: string }>(
        `select id, make_slug, model_slug from listings
          where status = 'active' and (make_slug, model_slug) = (
           select make_slug, model_slug from listings where status = 'active' and model_slug is not null
            group by make_slug, model_slug order by count(*) desc, make_slug, model_slug limit 1)
          order by id limit 3`,
      );
      const [a, b, c] = rows.map((row) => Number(row.id));
      const model = { make: rows[0].make_slug, model: rows[0].model_slug };
      // One vehicle: b is the cheapest, c costs the same as a. Repair estimates and a market value
      // give it a flip margin, so the flip sorts place it too.
      await client.query(
        `update listings set cluster_id = $1, market_price_eur = 9000, damage = '{engine}', vehicle_class = 'compact',
                repair_parts_min_eur = 500, repair_parts_max_eur = 900, repair_hours_min = 4, repair_hours_max = 8,
                repair_difficulty = 2, repair_confidence = 'medium', repair_needs_tow = false,
                price_eur = case id when $1 then 5000 when $2 then 4000 else 5000 end
          where id = any($3::int8[])`,
        [a, b, [a, b, c]],
      );

      const { rows: count } = await client.query<{ n: number }>(
        `select count(distinct coalesce(cluster_id, id))::int as n from listings
          where status = 'active' and make_slug = $1 and model_slug = $2`,
        [model.make, model.model],
      );
      // The listings of the group shown over all pages of the model's search.
      const shown = async (query: Record<string, string>) => {
        const ids: number[] = [];
        const first = await searchListings(client, parseFilters({ ...model, ...query }), null);
        for (let page = 1; page <= first.pageCount; page++) {
          const result = page === 1 ? first : await searchListings(client, parseFilters({ ...model, ...query, page: String(page) }), null);
          ids.push(...result.items.map((item) => item.id));
        }
        // Every vehicle once over all pages, and as many as the total says.
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBe(first.total);
        if (Object.keys(query).every((key) => key === "sort")) expect(first.total).toBe(count[0].n);
        return ids.filter((id) => [a, b, c].includes(id));
      };

      for (const sort of ["newest", "price_asc", "price_desc", "km_asc", "year_desc", "below_market", "price_drop", "flip", "margin", "empfehlung"]) {
        expect(await shown({ sort }), sort).toEqual([b]);
      }
      // Above b's price: the cheaper of the other two, a and c at the same price by id.
      expect(await shown({ priceMin: "4500", sort: "price_asc" })).toEqual([Math.min(a, c)]);
      // The group is counted once.
      const all = await searchListings(client, parseFilters({}), null);
      expect(all.total).toBe(598);
      const item = (await searchListings(client, parseFilters({ priceMax: "4000", sort: "price_desc" }), null)).items.find((i) => i.id === b)!;
      expect(item.otherOffers.map((offer) => offer.id).sort()).toEqual([a, c].sort());
    } finally {
      await client.query("rollback");
      client.release();
    }
  }, 30_000);

  it("keeps radius results inside the radius and sorts by distance", async () => {
    const filters = parseFilters({ zip: "10115", radius: "100", sort: "distance" });
    const origin = await resolveZip(pool, "10115");
    const result = await searchListings(pool, filters, origin);
    expect(result.total).toBeGreaterThan(0);
    const distances = result.items.map((i) => i.distanceKm!);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(Math.max(...distances)).toBeLessThanOrEqual(100);
  });

  it("falls back to a nearby postal code", async () => {
    expect(await resolveZip(pool, "10999")).toMatchObject({ city: "Berlin Kreuzberg", exact: true });
    // 10875 belongs to a single company and is not in the list; the numerically closest code in the region is used.
    const origin = await resolveZip(pool, "10875");
    expect(origin).toMatchObject({ zip: "10829", city: "Berlin", exact: false });
    expect(haversineKm(origin!.lat, origin!.lng, 52.52, 13.405)).toBeLessThan(10);
    // No German postal code starts with 05.
    expect(await resolveZip(pool, "05999")).toBeNull();
  });

  it("escapes LIKE wildcards in the free-text search", async () => {
    const result = await searchListings(pool, parseFilters({ q: "%" }), null);
    expect(result.total).toBe(0);
  });

  it("finds every word of the search term in the title, in any order", async () => {
    const { rows } = await pool.query<{ title: string }>("select title from listings where title ~ '^\\S+ \\S+ \\S+' limit 1");
    const [first, second] = rows[0].title.split(" ");
    const result = await searchListings(pool, parseFilters({ q: `${second} ${first}` }), null);
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((item) => item.title.includes(first) && item.title.includes(second))).toBe(true);
  });

  it("finds towns by name for the search in own words", async () => {
    const munich = await findTown(pool, "München");
    expect(munich?.city).toBe("München");
    expect(munich?.zip).toMatch(/^8/);
    expect(await findTown(pool, "muenchen")).toEqual(munich);
    expect((await findTown(pool, "frankfurt"))?.city).toBe("Frankfurt am Main");
    expect(await findTown(pool, "Gibtsnichtstadt")).toBeNull();
    expect(await findTown(pool, "%")).toBeNull();
  });

  it("sorts by recommendation: models with fewer HU defects than cars of their age first", async () => {
    // Fixtures and searches in one transaction that is rolled back, so the shared listings stay as they were.
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Two models in the age group with the most listings: one gets 20 % defects, the other 60 % (average 40 %).
      const { rows } = await client.query<{ make_slug: string; model_slug: string; bucket: number }>(
        `with cars as (
           select make_slug, model_slug, ${ageBucketSql("first_registration")} as bucket
             from listings where status = 'active' and model_slug is not null)
         select make_slug, model_slug, bucket from cars
          where bucket = (select bucket from cars where bucket is not null group by bucket order by count(*) desc, bucket limit 1)
          group by 1, 2, 3 order by count(*) desc, 1, 2 limit 2`,
      );
      const [good, bad] = rows;
      await client.query(
        `insert into model_defect_profiles (make_slug, model_slug, age_bucket, sample, any_defect, window_months)
         values ($1, $2, $3, 200, 40, 24), ($4, $5, $6, 200, 120, 24)`,
        [good.make_slug, good.model_slug, good.bucket, bad.make_slug, bad.model_slug, bad.bucket],
      );
      const result = await searchListings(client, parseFilters({ sort: "empfehlung" }), null);
      const scores = result.items.map(recommendationScore);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
      expect(result.total).toBe(600);

      const worse = await searchListings(client, parseFilters({ sort: "empfehlung", make: bad.make_slug, model: bad.model_slug }), null);
      expect(worse.items.some((item) => item.reliabilityRatio !== null && Math.abs(item.reliabilityRatio - 1.5) < 1e-9)).toBe(true);
      // Other sorts leave the comparison out.
      const newest = await searchListings(client, parseFilters({}), null);
      expect(newest.items.every((item) => item.reliabilityRatio === null)).toBe(true);

      // Without market values only the Modell-Akte counts: the better model first, the worse one last.
      await client.query("update listings set market_price_eur = null");
      const reliable = await searchListings(client, parseFilters({ sort: "empfehlung" }), null);
      expect(reliable.items[0]).toMatchObject({ makeSlug: good.make_slug, modelSlug: good.model_slug });
      expect(reliable.items[0].reliabilityRatio).toBeCloseTo(0.5);
      const last = await searchListings(client, parseFilters({ sort: "empfehlung", page: String(reliable.pageCount) }), null);
      expect(last.items.at(-1)).toMatchObject({ makeSlug: bad.make_slug, modelSlug: bad.model_slug });
      expect(last.items.at(-1)!.reliabilityRatio).toBeCloseTo(1.5);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("counts makes and models for the filter form", async () => {
    const facets = await getMakeFacets(pool);
    const total = facets.reduce((sum, f) => sum + f.count, 0);
    expect(total).toBe(600);
  });

  it("records click-outs and returns the original URL", async () => {
    const { items } = await searchListings(pool, parseFilters({}), null);
    expect(await recordClick(pool, items[0].id)).toMatch(/^\/demo\//);
    expect(await recordClick(pool, 987654321)).toBeNull();
  });

  it("marks listings as gone only after two missed full runs", async () => {
    const smaller = createDemoAdapter({ count: 550, seed: 3 });
    const firstRun = await runIngest(pool, smaller);
    expect(firstRun.gone).toBe(0);
    const secondRun = await runIngest(pool, smaller);
    expect(secondRun.gone).toBe(50);
    const result = await searchListings(pool, parseFilters({}), null);
    expect(result.total).toBe(550);

    // A listing that comes back is active again.
    await runIngest(pool, createDemoAdapter({ count: 600, seed: 3 }));
    expect((await searchListings(pool, parseFilters({}), null)).total).toBe(600);
  });
});

describe.skipIf(!url)("preparing a fresh database", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await emptyTestDatabase();
    await migrate(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("imports the demo listings into an empty database, then leaves them alone", async () => {
    const demo = () => createDemoAdapter({ count: 40, seed: 7 });

    const first = await prepareData(pool, demo);
    expect(first.reference.makes).toBeGreaterThan(0);
    expect(first.demo?.upserted).toBe(40);
    expect(await resolveZip(pool, "10115")).not.toBeNull();

    const second = await prepareData(pool, demo);
    expect(second.demo).toBeNull();
    const { rows } = await pool.query<{ count: string }>("select count(*) from ingest_runs");
    expect(Number(rows[0].count)).toBe(1);
  });
});
