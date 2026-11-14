import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { haversineKm } from "@/core/geo";
import { createDemoAdapter } from "@/ingest/adapters/demo";
import { migrate } from "@/ingest/migrate";
import { runIngest } from "@/ingest/run";
import { seedReferenceData } from "@/ingest/seed";
import { parseFilters } from "@/search/filters";
import { getMakeFacets, recordClick, resolveZip, searchListings } from "@/search/query";

/**
 * Runs against a real Postgres. Set TEST_DATABASE_URL to a database whose name contains "test";
 * its public schema is wiped before the run.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("search against Postgres", () => {
  let pool: Pool;

  beforeAll(async () => {
    if (!new URL(url!).pathname.includes("test")) throw new Error("TEST_DATABASE_URL must point to a *test* database");
    pool = new Pool({ connectionString: url });
    await pool.query("drop schema public cascade; create schema public;");
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

  it("sorts by price and pages through results", async () => {
    const first = await searchListings(pool, parseFilters({ sort: "price_asc" }), null);
    const prices = first.items.map((i) => i.priceEur);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    const second = await searchListings(pool, parseFilters({ sort: "price_asc", page: "2" }), null);
    expect(second.items[0].priceEur).toBeGreaterThanOrEqual(prices.at(-1)!);
    expect(first.total).toBe(600);
  });

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
    const origin = await resolveZip(pool, "10999");
    expect(origin).toMatchObject({ city: "Berlin", exact: false });
    expect(haversineKm(origin!.lat, origin!.lng, 52.52, 13.405)).toBeLessThan(1);
    expect(await resolveZip(pool, "27999")).toBeNull();
  });

  it("escapes LIKE wildcards in the free-text search", async () => {
    const result = await searchListings(pool, parseFilters({ q: "%" }), null);
    expect(result.total).toBe(0);
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
