import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ageBucket, coveredComponents, hiddenDefectRisk } from "@/core/defects";
import { DEFAULT_FLIP_SETTINGS } from "@/core/flip";
import { countedJobs, estimateRepairs, unclearDamageRisk } from "@/core/repairs";
import { refreshDefectProfiles } from "@/ingest/defects/refresh";
import { RdwClient } from "@/ingest/defects/rdw";
import { PoliteFetcher } from "@/ingest/http/fetcher";
import { migrate } from "@/ingest/migrate";
import { updateRepairEstimates } from "@/ingest/repairs";
import { seedReferenceData } from "@/ingest/seed";
import { getDefectDataStatus, getModelFile } from "@/search/defects";
import { getListing } from "@/search/query";
import { emptyTestDatabase } from "./test-database";

/** Pacing without real waiting: sleeping moves a fake clock forward. */
function virtualClock() {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
}

/**
 * Defect profiles from a fake RDW API, and the risk buffer they give the flip estimate, against
 * a real Postgres. Set TEST_DATABASE_URL to a database whose name contains "test".
 */
const url = process.env.TEST_DATABASE_URL;
const now = new Date("2026-11-21T10:00:00Z");

/** Plates are "P<number>"; which defects a plate had follows from its number. */
const plateNumber = (plate: string) => Number(plate.slice(1));
const DEFECTS: [number, string][] = [
  [4, "AC1"], // brake disc: every 4th car
  [10, "RA1"], // rust: every 10th
  [5, "ZZ9"], // seat belt, in no group: every 5th
];

function fakeRdw(polos = 50) {
  const queries: URL[] = [];
  const fetcher = new PoliteFetcher({
    respectRobots: false,
    minDelayMs: 1000,
    ...virtualClock(),
    fetchImpl: (async (input: string | URL) => {
      const request = new URL(String(input));
      queries.push(request);
      const dataset = request.pathname.split("/").pop();
      const select = request.searchParams.get("$select");
      const where = request.searchParams.get("$where") ?? "";
      let body: unknown;
      if (dataset === "hx2c-gt7k.json") {
        body = [
          { gebrek_identificatie: "AC1", gebrek_omschrijving: "Remschijf versleten" },
          { gebrek_identificatie: "RA1", gebrek_omschrijving: "Corrosie dragende constructie" },
          { gebrek_identificatie: "ZZ9", gebrek_omschrijving: "Veiligheidsgordel defect" },
        ];
      } else if (dataset === "m9d7-ebf2.json" && select === "handelsbenaming,count(*) AS n") {
        body = [
          { handelsbenaming: "GOLF", n: "50000" },
          { handelsbenaming: "GOLF VARIANT", n: "8000" },
          { handelsbenaming: "POLO", n: "30000" },
          { handelsbenaming: "PASSAT", n: "10" },
        ];
      } else if (dataset === "m9d7-ebf2.json" && select === "count(*) AS n") {
        body = [{ n: where.includes("'POLO'") ? String(polos) : "1000" }];
      } else if (dataset === "m9d7-ebf2.json" && select === "kenteken") {
        const offset = Number(request.searchParams.get("$offset"));
        const limit = Number(request.searchParams.get("$limit"));
        body = Array.from({ length: limit }, (_, i) => ({ kenteken: `P${offset + i}` }));
      } else if (dataset === "a34c-vvps.json") {
        const plates = [...where.matchAll(/'(P\d+)'/g)].map((match) => match[1]);
        body = plates.flatMap((plate) =>
          DEFECTS.filter(([every]) => plateNumber(plate) % every === 0).map(([, code]) => ({ kenteken: plate, gebrek_identificatie: code })),
        );
      } else {
        return new Response(JSON.stringify({ message: `unexpected query ${request}` }), { status: 400 });
      }
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch,
  });
  return { client: new RdwClient(fetcher), queries };
}

describe.skipIf(!url)("defect profiles and risk buffer against Postgres", () => {
  let pool: Pool;
  let next = 0;

  async function addCar(model: "golf" | "polo", year: number, price: number, damage: string[] = [], market: number | null = 6000) {
    next += 1;
    const { rows } = await pool.query<{ id: string }>(
      `insert into listings (source_id, external_id, url, title, make_slug, model_slug, make_raw, model_raw, price_eur,
                             mileage_km, first_registration, fuel, transmission, power_kw, seller_type, damage, market_price_eur)
       values ('defect-test', $1, 'https://example.org/' || $1, 'VW', 'volkswagen', $2, 'VW', $2, $3,
               150000, make_date($4, 6, 1), 'petrol', 'manual', 85, 'private', $5, $6)
       returning id`,
      [`car-${next}`, model, price, year, damage, market],
    );
    return Number(rows[0].id);
  }

  beforeAll(async () => {
    pool = await emptyTestDatabase();
    await migrate(pool);
    await seedReferenceData(pool);
    await pool.query("insert into sources (id, name, kind) values ('defect-test', 'Testbörse', 'scrape')");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("samples each due model and age group, counts defects per component and prices them into the flip", async () => {
    const accident = await addCar("golf", 2014, 1500, ["accident"]);
    for (let i = 0; i < 3; i++) await addCar("golf", 2014, 6000);
    await addCar("polo", 2014, 900, ["clutch"]);
    // Too young for a profile, and a model with few intact listings and no damaged one.
    await addCar("golf", 2024, 20000, ["clutch"]);
    for (let i = 0; i < 3; i++) await addCar("polo", 2009, 3000);

    const { client, queries } = fakeRdw();
    const result = await refreshDefectProfiles(pool, { client, now, random: () => 0, log: () => undefined });
    expect(result).toMatchObject({ profiles: 2, pending: 0, error: null });

    const bucket = ageBucket("2014-06-01", now)!;
    const { rows } = await pool.query(
      "select model_slug, age_bucket, sample, any_defect, components, rdw_names from model_defect_profiles order by model_slug",
    );
    // Slices of 150 from each half of 1,000 cars: P0–P149 and P500–P649.
    const plates = [...Array.from({ length: 150 }, (_, i) => i), ...Array.from({ length: 150 }, (_, i) => 500 + i)];
    const count = (every: number) => plates.filter((n) => n % every === 0).length;
    expect(rows).toEqual([
      {
        model_slug: "golf",
        age_bucket: bucket,
        sample: 300,
        any_defect: plates.filter((n) => n % 4 === 0 || n % 5 === 0).length,
        components: { brakes: count(4), rust: count(10) },
        rdw_names: ["GOLF", "GOLF VARIANT"],
      },
      // Only 50 Polos of that age in the fake register: too few, kept empty.
      { model_slug: "polo", age_bucket: bucket, sample: 0, any_defect: 0, components: {}, rdw_names: ["POLO"] },
    ]);

    const golfCount = queries.find((q) => q.searchParams.get("$select") === "count(*) AS n")!;
    expect(golfCount.searchParams.get("$where")).toBe(
      "voertuigsoort='Personenauto' AND merk in('VOLKSWAGEN','VW') AND handelsbenaming in('GOLF','GOLF VARIANT') " +
        "AND datum_eerste_toelating_dt between '2013-01-01T00:00:00' and '2015-12-31T23:59:59' " +
        "AND vervaldatum_apk_dt >= '2026-11-21T00:00:00'",
    );
    const defectQuery = queries.find((q) => q.pathname.endsWith("a34c-vvps.json"))!;
    expect(defectQuery.searchParams.get("$where")).toContain("meld_datum_door_keuringsinstantie_dt >= '2024-11-21T00:00:00'");

    // The risk buffer: inspection defects of such a Golf plus the likely heavy accident at 75 % below market.
    expect(await updateRepairEstimates(pool, now)).toBeGreaterThan(0);
    const facts = { makeSlug: "volkswagen", powerKw: 85, bodyType: null, fuel: "petrol" as const };
    const estimate = estimateRepairs(["accident"], facts, now);
    const jobIds = estimate.jobs.map((j) => j.job.id);
    const profile = { sample: 300, anyDefect: 0, components: { brakes: count(4), rust: count(10) } };
    const hidden = hiddenDefectRisk(profile, estimate.vehicleClass, coveredComponents(jobIds))!.eur;
    const unclear = unclearDamageRisk(["accident"], { fuel: "petrol", vehicleClass: estimate.vehicleClass }, 1500, 6000, countedJobs(estimate))!.eur;
    const stored = await pool.query("select repair_risk_hidden_eur, repair_risk_unclear_eur from listings where id = $1", [accident]);
    expect(stored.rows[0]).toEqual({ repair_risk_hidden_eur: hidden, repair_risk_unclear_eur: unclear });
    expect(hidden).toBeGreaterThan(0);

    const listing = await getListing(pool, accident, DEFAULT_FLIP_SETTINGS);
    expect(listing!.flip!.riskEur).toBe(hidden + unclear);

    const file = await getModelFile(pool, "volkswagen", "golf", "2014-06-01", now);
    expect(file).toMatchObject({ bucket, rdwNames: ["GOLF", "GOLF VARIANT"], profile: { sample: 300 } });
    // Only the Golf has enough cars, so it is also the average.
    expect(file!.average).toEqual(file!.profile);

    // Everything is fresh now: the next run asks RDW nothing.
    const again = fakeRdw();
    expect(await refreshDefectProfiles(pool, { client: again.client, now, log: () => undefined })).toMatchObject({ profiles: 0, error: null });
    expect(again.queries).toHaveLength(0);

    expect(await getDefectDataStatus(pool)).toMatchObject({ profiles: 1, cars: 300, lastError: null });
  });

  it("says so when another refresh holds the lock, and repair estimates wait for each other", async () => {
    const other = await pool.connect();
    try {
      await other.query("select pg_advisory_lock(hashtext('autometa-defect-profiles'))");
      const blocked = fakeRdw();
      expect(await refreshDefectProfiles(pool, { client: blocked.client, now, log: () => undefined })).toMatchObject({ skipped: true, profiles: 0 });
      expect(blocked.queries).toHaveLength(0);
    } finally {
      await other.query("select pg_advisory_unlock(hashtext('autometa-defect-profiles'))");
      other.release();
    }
  });

  it("lets repair estimates wait for a running writer and then use the newest profiles", async () => {
    const accident = await addCar("golf", 2014, 1500, ["accident"]);
    const bucket = ageBucket("2014-06-01", now)!;
    await pool.query(
      `insert into model_defect_profiles (make_slug, model_slug, age_bucket, sample, any_defect, components, window_months, rdw_names, refreshed_at)
       values ('volkswagen', 'golf', $1, 300, 60, '{"brakes": 30}', 24, '{GOLF}', $2)
       on conflict (make_slug, model_slug, age_bucket) do update set components = excluded.components, refreshed_at = excluded.refreshed_at`,
      [bucket, now],
    );
    const hiddenOf = async () =>
      (await pool.query("select repair_risk_hidden_eur as eur from listings where id = $1", [accident])).rows[0].eur as number | null;

    const other = await pool.connect();
    let writer: Promise<number> | undefined;
    try {
      await other.query("select pg_advisory_lock(hashtext('autometa-repair-estimates'))");
      let done = false;
      writer = updateRepairEstimates(pool, now).finally(() => {
        done = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(done).toBe(false);
      expect(await hiddenOf()).toBeNull();
      // Newer profiles arrive while the writer waits: it must load them after it got the lock.
      await pool.query(`update model_defect_profiles set components = '{"brakes": 30, "rust": 90}' where model_slug = 'golf'`);
    } finally {
      await other.query("select pg_advisory_unlock(hashtext('autometa-repair-estimates'))");
      other.release();
    }
    expect(await writer).toBeGreaterThan(0);
    const estimate = estimateRepairs(["accident"], { makeSlug: "volkswagen", powerKw: 85, bodyType: null, fuel: "petrol" }, now);
    const covered = coveredComponents(estimate.jobs.map((j) => j.job.id));
    const newest = hiddenDefectRisk({ sample: 300, anyDefect: 60, components: { brakes: 30, rust: 90 } }, estimate.vehicleClass, covered)!.eur;
    const older = hiddenDefectRisk({ sample: 300, anyDefect: 60, components: { brakes: 30 } }, estimate.vehicleClass, covered)!.eur;
    expect(newest).not.toBe(older);
    expect(await hiddenOf()).toBe(newest);
  });

  it("needs only one database connection", async () => {
    await pool.query("delete from model_defect_profiles");
    const single = new Pool({ connectionString: url, max: 1 });
    try {
      const result = await refreshDefectProfiles(single, { client: fakeRdw().client, now, random: () => 0, log: () => undefined });
      expect(result).toMatchObject({ profiles: 2, error: null });
    } finally {
      await single.end();
    }
  });

  it("records a refused query as the run's error and keeps what it wrote before", async () => {
    await pool.query("delete from model_defect_profiles");
    const fetcher = new PoliteFetcher({
      respectRobots: false,
      ...virtualClock(),
      fetchImpl: (async () => new Response(JSON.stringify({ message: "No such column: vervaldatum_apk_dt" }), { status: 400 })) as unknown as typeof fetch,
    });
    const result = await refreshDefectProfiles(pool, { client: new RdwClient(fetcher), now, log: () => undefined });
    expect(result.error).toContain("No such column: vervaldatum_apk_dt");
    expect((await getDefectDataStatus(pool)).lastError).toContain("No such column");
  });
});
