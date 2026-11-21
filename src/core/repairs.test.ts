import { describe, expect, it } from "vitest";
import { DAMAGE_KINDS } from "./damage";
import { DAMAGE_JOBS, estimateRepairs, findJob, REPAIR_JOBS, scaledParts, vehicleClass, type VehicleFacts } from "./repairs";

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
