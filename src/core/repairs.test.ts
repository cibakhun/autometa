import { describe, expect, it } from "vitest";
import { DAMAGE_KINDS } from "./damage";
import { COMPONENT_INFO, DEFECT_COMPONENTS } from "./defects";
import {
  countedJobs,
  DAMAGE_JOBS,
  estimateRepairs,
  findJob,
  REPAIR_JOBS,
  scaledParts,
  SEVERE_CASES,
  unclearDamageRisk,
  vehicleClass,
  type VehicleFacts,
} from "./repairs";

const golf: VehicleFacts = { makeSlug: "volkswagen", powerKw: 85, bodyType: "sedan", fuel: "petrol" };
const ids = (damage: Parameters<typeof estimateRepairs>[0], facts: Parameters<typeof estimateRepairs>[1] = golf) =>
  estimateRepairs(damage, facts).jobs.map((j) => j.job.id);

describe("repair catalog", () => {
  it("has unique job ids, and every mapping and replacement points at a job", () => {
    expect(new Set(REPAIR_JOBS.map((j) => j.id)).size).toBe(REPAIR_JOBS.length);
    for (const kind of DAMAGE_KINDS) for (const id of DAMAGE_JOBS[kind].jobs) expect(findJob(id), `${kind} → ${id}`).toBeDefined();
    for (const job of REPAIR_JOBS) for (const id of job.replaces ?? []) expect(findJob(id), `${job.id} replaces ${id}`).toBeDefined();
  });

  it("keeps every range in order", () => {
    for (const job of REPAIR_JOBS) {
      expect(job.hours[0], job.id).toBeLessThanOrEqual(job.hours[1]);
      expect(job.partsEur[0], job.id).toBeLessThanOrEqual(job.partsEur[1]);
    }
  });
});

describe("vehicleClass", () => {
  it.each([
    [{ ...golf, powerKw: 50 }, "small"],
    [golf, "compact"],
    [{ ...golf, powerKw: 110 }, "mid"],
    [{ ...golf, powerKw: 150 }, "large"],
    [{ ...golf, makeSlug: "audi" }, "mid"],
    [{ ...golf, makeSlug: "bmw", powerKw: 200 }, "large"],
    [{ ...golf, bodyType: "suv" as const, powerKw: 70 }, "mid"],
    [{ ...golf, powerKw: null, bodyType: "small" as const }, "small"],
    [{ ...golf, powerKw: null, bodyType: "van" as const }, "mid"],
  ])("sorts %j into %s", (facts, cls) => {
    expect(vehicleClass(facts)).toBe(cls);
  });

  it("scales parts prices by class", () => {
    const clutch = findJob("clutch")!;
    expect(scaledParts(clutch, "compact")).toEqual([200, 450]);
    expect(scaledParts(clutch, "mid")).toEqual([260, 590]);
  });
});

describe("estimateRepairs", () => {
  it("adds up a clutch job and preparing the car for sale", () => {
    expect(estimateRepairs(["clutch"], golf)).toMatchObject({
      vehicleClass: "compact",
      partsEur: [230, 530],
      hours: [8, 15],
      difficulty: 3,
      confidence: "high",
      needsTow: false,
    });
    expect(ids(["clutch"])).toEqual(["clutch", "prep"]);
  });

  it("leaves out jobs a bigger one includes", () => {
    expect(ids(["engine", "timing"])).toEqual(["engine_used", "prep"]);
  });

  it("takes the hardest job, the least certain damage and towing from any kind", () => {
    const estimate = estimateRepairs(["turbo", "electrics", "accident"], golf);
    expect(estimate.difficulty).toBe(3);
    expect(estimate.confidence).toBe("low");
    expect(estimate.needsTow).toBe(true);
  });

  it("treats engine damage on an electric car as a high-voltage fault, and has no clutch to fix", () => {
    const tesla = { makeSlug: "tesla", powerKw: 200, bodyType: "sedan" as const, fuel: "electric" as const };
    expect(ids(["engine"], tesla)).toEqual(["high_voltage", "prep"]);
    expect(estimateRepairs(["engine"], tesla).difficulty).toBe(5);
    expect(ids(["clutch"], tesla)).toEqual(["prep"]);
  });

  it("prepares the HU when it has run out, also when its stated month has passed", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    const jobs = (facts: Parameters<typeof estimateRepairs>[1]) => estimateRepairs(["rust"], facts, now).jobs.map((j) => j.job.id);
    expect(jobs({ ...golf, huBasis: "expired" })).toEqual(["rust_welding", "hu_prep", "prep"]);
    expect(jobs({ ...golf, huBasis: "stated", huUntil: "2026-10-01" })).toEqual(["rust_welding", "hu_prep", "prep"]);
    expect(jobs({ ...golf, huBasis: "stated", huUntil: "2026-11-01" })).toEqual(["rust_welding", "prep"]);
    expect(jobs({ ...golf, huBasis: null, huUntil: null })).toEqual(["rust_welding", "prep"]);
  });
});

describe("unclearDamageRisk", () => {
  const compact = { fuel: "petrol" as const, vehicleClass: "compact" as const };
  /** The risk with the jobs of the full estimate for that damage, as the import computes it. */
  const risk = (damage: Parameters<typeof ids>[0], facts: { fuel: "petrol" | "electric"; vehicleClass: "compact" }, price: number, market: number | null) =>
    unclearDamageRisk(damage, facts, price, market, countedJobs(estimateRepairs(damage, { ...golf, fuel: facts.fuel })));
  const mid = (id: string) => {
    const [from, to] = scaledParts(findJob(id)!, "compact");
    return (from + to) / 2;
  };

  it("has worse cases and defect components that point at catalog jobs", () => {
    for (const severe of Object.values(SEVERE_CASES)) for (const id of severe!.jobs) expect(findJob(id), id).toBeDefined();
    for (const component of DEFECT_COMPONENTS) expect(findJob(COMPONENT_INFO[component].job), component).toBeDefined();
  });

  it("expects the heavy accident when the price is far below market", () => {
    const found = risk(["accident"], compact, 1500, 6000)!;
    // 75 % below market: certainly the worse case. Heavy accident instead of panels; paint stays.
    expect(found).toMatchObject({ kind: "accident", probability: 1, belowMarket: 0.75 });
    expect(found.eur).toBe(Math.round((mid("accident_heavy") - mid("body_panels")) / 10) * 10);
  });

  it("scales with how far below market the price is, and is null close to it", () => {
    const half = risk(["accident"], compact, 3000, 6000)!;
    expect(half.probability).toBeCloseTo(0.5);
    expect(half.eur).toBe(Math.round((0.5 * (mid("accident_heavy") - mid("body_panels"))) / 10) * 10);
    expect(risk(["accident"], compact, 4500, 6000)).toBeNull();
    expect(risk(["accident"], compact, 1000, null)).toBeNull();
  });

  it("has no worse case for damage the estimate already assumes at its worst", () => {
    expect(risk(["engine"], compact, 500, 6000)).toBeNull();
    expect(risk(["clutch"], compact, 500, 6000)).toBeNull();
    // "Motorschaden, springt nicht an": the replacement engine is in the estimate already.
    expect(risk(["engine", "not_running"], compact, 600, 6000)).toBeNull();
  });

  it("counts nothing extra for a worse case picked by hand", () => {
    const row = (id: string, partsEur = mid(id)) => ({ id, partsEur });
    expect(unclearDamageRisk(["accident"], compact, 1500, 6000, [row("accident_heavy"), row("paint")])).toBeNull();
    expect(unclearDamageRisk(["accident"], compact, 1500, 6000, [row("body_panels"), row("accident_heavy"), row("paint")])).toBeNull();
  });

  it("credits the replaced jobs at the cost typed for them", () => {
    // The timing chain typed in at 100 € instead of its catalog price: the engine costs that much more.
    const rows = [
      { id: "no_start", partsEur: mid("no_start") },
      { id: "timing_chain", partsEur: 100 },
    ];
    const found = unclearDamageRisk(["not_running"], compact, 600, 6000, rows)!;
    expect(found.eur).toBe(Math.round((mid("engine_used") - mid("no_start") - 100) / 10) * 10);
  });

  it("takes the most expensive worse case of several hints", () => {
    const found = risk(["electrics", "not_running"], compact, 600, 6000)!;
    expect(found.kind).toBe("not_running");
    expect(found.eur).toBe(Math.round((mid("engine_used") - mid("no_start")) / 10) * 10);
  });

  it("expects a high-voltage fault, not an engine, on an electric car", () => {
    const found = risk(["not_running"], { fuel: "electric", vehicleClass: "compact" }, 600, 6000)!;
    expect(found.eur).toBe(Math.round((mid("high_voltage") - mid("no_start")) / 10) * 10);
  });
});
