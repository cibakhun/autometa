import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FLIP_SETTINGS } from "@/core/flip";
import { migrate } from "@/ingest/migrate";
import { updateRepairEstimates } from "@/ingest/repairs";
import { seedReferenceData } from "@/ingest/seed";
import { parseFilters } from "@/search/filters";
import { getListing, searchListings } from "@/search/query";
import { emptyTestDatabase } from "./test-database";

/**
 * Repair estimates and the flip list against a real Postgres. Set TEST_DATABASE_URL to a
 * database whose name contains "test"; its public schema is wiped before the run.
 */
const url = process.env.TEST_DATABASE_URL;

interface Car {
  price: number;
  market?: number | null;
  damage?: string[];
  powerKw?: number;
}

let next = 0;

describe.skipIf(!url)("repair estimates and flip list against Postgres", () => {
  let pool: Pool;

  async function addCar(car: Car): Promise<number> {
    next += 1;
    const { rows } = await pool.query<{ id: string }>(
      `insert into listings (source_id, external_id, url, title, make_slug, model_slug, make_raw, model_raw, price_eur,
                             mileage_km, first_registration, fuel, transmission, power_kw, seller_type, damage, market_price_eur)
       values ('flip-test', $1, 'https://example.org/' || $1, 'VW Golf', 'volkswagen', 'golf', 'VW', 'Golf', $2,
               120000, make_date(2014, 6, 1), 'petrol', 'manual', $3, 'private', $4, $5)
       returning id`,
      [`car-${next}`, car.price, car.powerKw ?? 85, car.damage ?? [], car.market === undefined ? 6000 : car.market],
    );
    return Number(rows[0].id);
  }

  const estimate = async (id: number) =>
    (
      await pool.query(
        `select vehicle_class, repair_parts_min_eur, repair_parts_max_eur, repair_hours_min, repair_hours_max,
                repair_difficulty, repair_confidence, repair_needs_tow
           from listings where id = $1`,
        [id],
      )
    ).rows[0];

  beforeAll(async () => {
    pool = await emptyTestDatabase();
    await migrate(pool);
    await seedReferenceData(pool);
    await pool.query("insert into sources (id, name, kind) values ('flip-test', 'Testbörse', 'scrape')");
  }, 60_000);

  beforeEach(async () => {
    await pool.query("delete from listings");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("estimates listings with damage hints, only once, and clears an estimate whose damage went away", async () => {
    const clutch = await addCar({ price: 3000, damage: ["clutch"] });
    const intact = await addCar({ price: 6000 });

    expect(await updateRepairEstimates(pool)).toBe(1);
    expect(await estimate(clutch)).toEqual({
      vehicle_class: "compact",
      repair_parts_min_eur: 230,
      repair_parts_max_eur: 530,
      repair_hours_min: 8,
      repair_hours_max: 15,
      repair_difficulty: 3,
      repair_confidence: "high",
      repair_needs_tow: false,
    });
    expect((await estimate(intact)).repair_difficulty).toBeNull();
    expect(await updateRepairEstimates(pool)).toBe(0);

    // An HU whose stated month has passed adds the HU preparation (1–3 h, 30–150 €).
    await pool.query("update listings set hu_basis = 'stated', hu_until = '2020-05-01' where id = $1", [clutch]);
    expect(await updateRepairEstimates(pool)).toBe(1);
    expect(await estimate(clutch)).toMatchObject({ repair_parts_min_eur: 260, repair_parts_max_eur: 680, repair_hours_min: 9, repair_hours_max: 18 });

    await pool.query("update listings set damage = '{}' where id = $1", [clutch]);
    expect(await updateRepairEstimates(pool)).toBe(1);
    expect((await estimate(clutch)).repair_difficulty).toBeNull();
  });

  it("sorts and filters the flip list by margin per hour, difficulty and minimum margin", async () => {
    // Market 6000 × 0.93 = 5580; side costs 140 + 60 + 150 (drivable) or 300 (towed).
    const clutch = await addCar({ price: 3000, damage: ["clutch"] }); // 5580 − 3000 − 350 − 380 = 1850 in 11.5 h
    const turbo = await addCar({ price: 2500, damage: ["turbo"] }); // 5580 − 2500 − 350 − 855 = 1875 in 9.5 h
    // 92 % below market: the discount beyond 3000 for labor and hassle and the 1755 in parts (745) is
    // the risk of a worse damage than the title names.
    const engine = await addCar({ price: 500, damage: ["engine"] }); // 5580 − 500 − 500 − 1755 − 750 = 2075 in 22.5 h
    const unvalued = await addCar({ price: 1000, damage: ["clutch"], market: null });
    await addCar({ price: 4000 });
    await updateRepairEstimates(pool);

    const search = (query: string) => searchListings(pool, parseFilters(new URLSearchParams(query)), null);
    const byHour = await search("zustand=defekt&sort=flip");
    expect(byHour.total).toBe(4);
    expect(byHour.items.map((item) => item.id)).toEqual([turbo, clutch, engine, unvalued]);
    expect(byHour.items[0].flip).toMatchObject({ marginEur: 1880, hours: 9.5, perHourEur: 197 });
    expect(byHour.items[3].flip).toBeNull();

    expect((await search("zustand=defekt&sort=margin")).items.map((item) => item.id)).toEqual([engine, turbo, clutch, unvalued]);
    expect((await search("sort=flip&schwierigkeit=3")).items.map((item) => item.id)).toEqual([turbo, clutch, unvalued]);
    const minimum = await search("sort=flip&margeMin=1860");
    expect(minimum.items.map((item) => item.id)).toEqual([turbo, engine]);
    expect(minimum.total).toBe(2);
    // The turbo margin of 1875 shows as 1.880 €, so it passes a minimum of exactly that.
    expect((await search("sort=flip&margeMin=1880")).items.map((item) => item.id)).toEqual([turbo, engine]);

    // The visitor's settings change the margin: a 20 % discount sells for 4800, so the clutch job
    // (4800 − 3000 − 350 − 380 = 1070) drops below 1080 while turbo (1095) and engine (1295) stay.
    const strict = await searchListings(pool, parseFilters({ sort: "flip", margeMin: "1080" }), null, { ...DEFAULT_FLIP_SETTINGS, discountPct: 20 });
    expect(strict.items.map((item) => item.id)).toEqual([turbo, engine]);
    expect((await getListing(pool, engine, { ...DEFAULT_FLIP_SETTINGS, discountPct: 20 }))?.flip?.marginEur).toBe(1300);
  });
});
