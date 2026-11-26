import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("filters by condition", async () => {
    for (const price of [5000, 6000, 7000, 8000, 9000, 10_000]) await addCar({ price });
    const broken = await addCar({ title: "VW Golf springt nicht an", price: 1000, damage: ["not_running"] });
    await updateMarketValues(pool);

    const defekt = await searchListings(pool, parseFilters({ zustand: "defekt" }), null);
    expect(defekt.items.map((item) => item.id)).toEqual([broken]);
    expect(defekt.items[0]).toMatchObject({ damage: ["not_running"], marketPriceEur: 7500, marketComps: 6 });

    const intakt = await searchListings(pool, parseFilters({ zustand: "intakt" }), null);
    expect(intakt.total).toBe(6);
  });

  const deal = async (id: number) =>
    (await pool.query("select market_confidence, deal_pct from listings where id = $1", [id])).rows[0];

  it("ranks deals by percent below a trusted market value, never damaged, unsure or too cheap ones", async () => {
    // 20 comparable cars from 9,000 to 10,900 €: a close market (median about 10,000 €).
    for (let i = 0; i < 20; i++) await addCar({ price: 9000 + i * 100 });
    const good = await addCar({ price: 8000 });
    const better = await addCar({ price: 7000 });
    const pricey = await addCar({ price: 12_000 });
    // More than half below: a scam, a leasing fee or hidden damage, not a deal.
    const tooCheap = await addCar({ price: 4500 });
    const broken = await addCar({ title: "VW Golf Motorschaden", price: 2000, damage: ["engine"] });
    await updateMarketValues(pool);

    // As dealPercent: the percent below the listing's own market value, rounded.
    for (const id of [good, better, pricey]) {
      const { market_price_eur: value } = await market(id);
      const { rows } = await pool.query("select price_eur from listings where id = $1", [id]);
      expect(await deal(id)).toEqual({ market_confidence: "high", deal_pct: Math.round(((value - rows[0].price_eur) * 100) / value) });
    }
    expect((await deal(good)).deal_pct).toBeGreaterThan(15);
    expect((await deal(pricey)).deal_pct).toBeLessThan(-15);
    expect(await deal(tooCheap)).toEqual({ market_confidence: "high", deal_pct: null });
    expect((await deal(broken)).deal_pct).toBeNull();

    const sorted = await searchListings(pool, parseFilters({ sort: "below_market" }), null);
    expect(sorted.items.slice(0, 2).map((item) => item.id)).toEqual([better, good]);
    // Without a credible deal at the end (the 25 listings fill one page and one more).
    const second = await searchListings(pool, parseFilters({ sort: "below_market", page: "2" }), null);
    const order = [...sorted.items, ...second.items].map((item) => item.id);
    expect(order.slice(-2).sort()).toEqual([tooCheap, broken].sort());

    const deals = await searchListings(pool, parseFilters({ deal: "10" }), null);
    expect(deals.items.map((item) => item.id).sort()).toEqual([good, better].sort());
    expect((await searchListings(pool, parseFilters({ deal: "20" }), null)).items.map((item) => item.id)).toEqual([better]);
  });

  it("calls a market value unsure with few comparable cars or a wide price range", async () => {
    // Six cars: enough for a value, too few to trust it.
    for (const price of [9000, 9500, 10_000, 10_500, 11_000, 11_500]) await addCar({ price, year: 2012 });
    const fewComps = await addCar({ price: 7000, year: 2012 });
    // Twenty cars spread from 3,000 to 22,000 €: the middle half spans most of the median.
    for (let i = 0; i < 20; i++) await addCar({ price: 3000 + i * 1000, year: 2018 });
    const wide = await addCar({ price: 9000, year: 2018 });
    await updateMarketValues(pool);

    expect(await deal(fewComps)).toEqual({ market_confidence: "low", deal_pct: null });
    expect(await deal(wide)).toEqual({ market_confidence: "low", deal_pct: null });
    const listing = await getListing(pool, wide);
    expect(listing?.marketConfidence).toBe("low");
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

  it("rechecks the titles the old detector misread for \"ohne\" and \"Export T1\"", async () => {
    // Damage as the detector stored it before; the migration marks only these titles unchecked.
    const titles: [string, string[]][] = [
      ["Toyota Land Cruiser 300+PREMIUM+EXPORT_T1+READY", ["project"]],
      ["Toyota Land Cruiser HYBRID_EXPORT_T1_READY", ["project"]],
      ["VW Crafter Kasten NAV AHK oh.Schäden 5J.Gar", ["defect"]],
      ["VW Golf o Unfall", ["accident"]],
      ["VW Golf nur Export", ["project"]],
      ["VW Golf 6 Getriebeschaden", ["gearbox"]],
    ];
    const ids: number[] = [];
    for (const [title, damage] of titles) ids.push(await addCar({ title, price: 5000, damage }));
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261124020000_damage_recheck_ohne_export.sql"), "utf8");
    await pool.query(sql);
    const unchecked = async () =>
      (await pool.query("select id, damage from listings where id = any($1) order by id", [ids])).rows.map((row) => row.damage);
    expect(await unchecked()).toEqual([null, null, null, null, ["project"], ["gearbox"]]);
    expect(await backfillDamage(pool)).toBe(4);
    expect(await unchecked()).toEqual([[], [], [], [], ["project"], ["gearbox"]]);
  });

  it("rechecks intact titles with words the detector learnt for the deal lists", async () => {
    const titles: [string, string[]][] = [
      ["Beschädigte BMW X1", []],
      ["BMW 218i Gran Tourer MOTORSTÖRUNG", []],
      ["Ford S-Max Getriebe Problem", []],
      ["Ford Transit Injektor def.", []],
      ["BMW 216d beschaedigt, auch TEILEVERKAUF", []],
      ["VW Golf 7 Defender-Grau", []],
      ["VW Golf 7 TÜV neu", []],
      ["VW Golf Motorschaden", ["engine"]],
    ];
    const ids: number[] = [];
    for (const [title, damage] of titles) ids.push(await addCar({ title, price: 5000, damage }));
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261126220100_damage_recheck_beschaedigt.sql"), "utf8");
    await pool.query(sql);
    const damage = async () =>
      (await pool.query("select id, damage from listings where id = any($1) order by id", [ids])).rows.map((row) => row.damage);
    expect(await damage()).toEqual([null, null, null, null, null, [], [], ["engine"]]);
    expect(await backfillDamage(pool)).toBe(5);
    expect(await damage()).toEqual([["defect"], ["engine"], ["gearbox"], ["defect"], ["project"], [], [], ["engine"]]);
  });
});
