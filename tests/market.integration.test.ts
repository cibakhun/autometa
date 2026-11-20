import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { backfillDamage, updateMarketValues } from "@/ingest/market";
import { migrate } from "@/ingest/migrate";
import { seedReferenceData } from "@/ingest/seed";
import { parseFilters } from "@/search/filters";
import { getListing, searchListings } from "@/search/query";
import { emptyTestDatabase } from "./test-database";

/**
 * Market values, damage hints and price history against a real Postgres. Set TEST_DATABASE_URL
 * to a database whose name contains "test"; its public schema is wiped before the run.
 */
const url = process.env.TEST_DATABASE_URL;

interface Car {
  title?: string;
  price: number;
  km?: number | null;
  year?: number;
  fuel?: string;
  damage?: string[] | null;
  status?: "active" | "gone";
  huBasis?: string | null;
  huUntil?: string | null;
  cluster?: number | null;
}

let next = 0;

describe.skipIf(!url)("market values against Postgres", () => {
  let pool: Pool;

  async function addCar(car: Car): Promise<number> {
    next += 1;
    const { rows } = await pool.query<{ id: string }>(
      `insert into listings (source_id, external_id, url, title, make_slug, model_slug, make_raw, model_raw, price_eur,
                             mileage_km, first_registration, fuel, transmission, power_kw, seller_type, damage, status,
                             hu_basis, hu_until, cluster_id)
       values ('market-test', $1, 'https://example.org/' || $1, $2, 'volkswagen', 'golf', 'VW', 'Golf', $3,
               $4, make_date($5::int, 6, 1), $6, 'manual', 90, 'private', $7, $8, $9, $10, $11)
       returning id`,
      [
        `car-${next}`,
        car.title ?? "VW Golf 1.4 TSI",
        car.price,
        car.km === undefined ? 100_000 : car.km,
        car.year ?? 2015,
        car.fuel ?? "petrol",
        car.damage === undefined ? [] : car.damage,
        car.status ?? "active",
        car.huBasis ?? null,
        car.huUntil ?? null,
        car.cluster ?? null,
      ],
    );
    return Number(rows[0].id);
  }

  const market = async (id: number) =>
    (
      await pool.query(
        "select market_price_eur, market_low_eur, market_high_eur, market_comps from listings where id = $1",
        [id],
      )
    ).rows[0];

  beforeAll(async () => {
    pool = await emptyTestDatabase();
    await migrate(pool);
    await seedReferenceData(pool);
    await pool.query("insert into sources (id, name, kind) values ('market-test', 'Testbörse', 'scrape')");
  }, 60_000);

  beforeEach(async () => {
    await pool.query("delete from listings");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("values a damaged car at the median of comparable intact cars", async () => {
    for (const price of [5000, 5500, 6000, 6500, 7000, 9000]) await addCar({ price, km: 95_000 + price });
    const broken = await addCar({ title: "VW Golf Motorschaden", price: 1500, damage: ["engine"] });

    const result = await updateMarketValues(pool);
    // The broken car and each intact one (five other intact cars each) have a value.
    expect(result.valued).toBe(7);
    expect(await market(broken)).toEqual({ market_price_eur: 6250, market_low_eur: 5600, market_high_eur: 6900, market_comps: 6 });
  });

  it("leaves out damaged, HU-expired, cheap and different cars, and counts a vehicle on two portals once", async () => {
    for (const price of [5000, 6000, 7000, 8000]) await addCar({ price });
    // Not comparable: damage, expired HU (said so or by date), a giveaway, other fuel, far more km,
    // other year, no km.
    await addCar({ price: 4000, damage: ["gearbox"] });
    await addCar({ price: 4000, huBasis: "expired" });
    await addCar({ price: 4000, huBasis: "stated", huUntil: "2020-01-01" });
    await addCar({ price: 0 });
    await addCar({ price: 4000, fuel: "diesel" });
    await addCar({ price: 4000, km: 200_000 });
    await addCar({ price: 4000, year: 2019 });
    await addCar({ price: 4000, km: null });
    // The same car on two portals counts once.
    const first = await addCar({ price: 9000 });
    await pool.query("update listings set cluster_id = $1 where id = $1", [first]);
    await addCar({ price: 9100, cluster: first });
    const target = await addCar({ price: 3000, damage: ["engine"] });

    await updateMarketValues(pool);
    expect(await market(target)).toMatchObject({ market_price_eur: 7000, market_comps: 5 });
  });

  it("gives no value with too few comparable cars, and clears an old one", async () => {
    for (const price of [5000, 6000, 7000, 8000, 9000]) await addCar({ price });
    const target = await addCar({ price: 2000, damage: ["engine"] });
    await updateMarketValues(pool);
    expect((await market(target)).market_price_eur).toBe(7000);

    await pool.query("update listings set status = 'gone', last_seen_at = now() - interval '200 days' where price_eur = 9000");
    await updateMarketValues(pool);
    expect(await market(target)).toMatchObject({ market_price_eur: null, market_comps: null });
  });

  it("filters by condition and sorts by the gap to the market value", async () => {
    for (const price of [5000, 6000, 7000, 8000, 9000, 10_000]) await addCar({ price });
    const broken = await addCar({ title: "VW Golf springt nicht an", price: 1000, damage: ["not_running"] });
    await updateMarketValues(pool);

    const defekt = await searchListings(pool, parseFilters({ zustand: "defekt" }), null);
    expect(defekt.items.map((item) => item.id)).toEqual([broken]);
    expect(defekt.items[0]).toMatchObject({ damage: ["not_running"], marketPriceEur: 7500, marketComps: 6 });

    const intakt = await searchListings(pool, parseFilters({ zustand: "intakt" }), null);
    expect(intakt.total).toBe(6);

    const sorted = await searchListings(pool, parseFilters({ sort: "below_market" }), null);
    expect(sorted.items[0].id).toBe(broken);
  });

  it("keeps every price a listing had", async () => {
    const id = await addCar({ price: 4000 });
    await pool.query("update listings set price_eur = 3500 where id = $1", [id]);
    // Writing the same price again adds nothing.
    await pool.query("update listings set price_eur = 3500, title = 'VW Golf VB' where id = $1", [id]);

    // Two changes in one transaction are two entries.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("update listings set price_eur = 3200 where id = $1", [id]);
      await client.query("update listings set price_eur = 3000 where id = $1", [id]);
      await client.query("commit");
    } finally {
      client.release();
    }

    const listing = await getListing(pool, id);
    expect(listing?.priceHistory.map((point) => point.priceEur)).toEqual([4000, 3500, 3200, 3000]);
  });

  it("fills in damage hints of listings stored before detection", async () => {
    const old = await addCar({ title: "VW Golf 6 Getriebeschaden", price: 900, damage: null });
    const fine = await addCar({ title: "VW Golf 6 TÜV neu", price: 6000, damage: null });
    expect(await backfillDamage(pool)).toBe(2);
    const { rows } = await pool.query("select id, damage from listings where id = any($1) order by id", [[old, fine]]);
    expect(rows.map((row) => row.damage)).toEqual([["gearbox"], []]);
    expect(await backfillDamage(pool)).toBe(0);
  });
});
