import { describe, expect, it } from "vitest";
import { classifyDefect } from "./defect-codes";
import {
  ageBucket,
  bucketYears,
  compareWithAverage,
  coveredComponents,
  DEFECT_COMPONENTS,
  hiddenDefectRisk,
  MIN_SAMPLE,
  poolProfiles,
  type DefectProfile,
} from "./defects";
import { findJob, scaledParts } from "./repairs";

describe("classifyDefect", () => {
  it.each([
    ["Remschijf/remtrommel ernstig gecorrodeerd", "brakes"],
    ["Remblok of remvoering te dun", "brakes"],
    ["Remleiding ernstig gecorrodeerd", "brake_lines"],
    ["Remslang beschadigd", "brake_lines"],
    ["Parkeerrem werking onvoldoende", "brakes"],
    ["Bedrijfsremwerking onvoldoende", "brakes"],
    ["Hoofdremcilinder lekt", "brakes"],
    ["Remlicht werkt niet", "lights"],
    ["Koplamp verkeerd afgesteld", "lights"],
    ["Ruitenwisser werkt onvoldoende", "lights"],
    ["Schokdemper lekt", "suspension"],
    ["Veer gebroken", "suspension"],
    ["Kogelgewricht te veel speling", "steering"],
    ["Draagarm vervormd", "steering"],
    ["Wiellager te veel speling", "wheel_bearing"],
    ["Manchet aandrijfas beschadigd", "driveshaft"],
    ["Uitlaatsysteem lekt", "exhaust"],
    ["CO-gehalte te hoog", "emissions"],
    ["Storingsindicatielamp (MIL) brandt", "emissions"],
    ["Olielekkage motor", "leaks"],
    ["Corrosie dragende constructie", "rust"],
    ["Voorruit beschadigd in zichtveld bestuurder", "glass"],
    ["Bandenprofiel onvoldoende", "tyres"],
    ["Lichtmetalen velg beschadigd", "tyres"],
    ["Elektrische bedrading beschadigd", null],
    ["Veiligheidsgordel defect", null],
    ["Kentekenplaat onleesbaar", null],
    ["Kentekenplaatverlichting werkt niet", "lights"],
  ])("%s -> %s", (description, component) => {
    expect(classifyDefect(description)).toBe(component);
  });
});

describe("age groups", () => {
  const now = new Date("2026-11-21T00:00:00Z");

  it("puts cars by years since first registration", () => {
    expect(ageBucket("2021-03-01", now)).toBe(0); // 5 years
    expect(ageBucket("2014-06-01", now)).toBe(2); // 12 years
    expect(ageBucket("2009", now)).toBe(3); // 17 years
    expect(ageBucket("2001-01-01", now)).toBe(4); // 25 years
  });

  it("leaves out young and very old cars and unknown dates", () => {
    expect(ageBucket("2023-01-01", now)).toBeNull();
    expect(ageBucket("1995-01-01", now)).toBeNull();
    expect(ageBucket(null, now)).toBeNull();
  });

  it("turns a group back into registration years", () => {
    expect(bucketYears(2, now)).toEqual([2013, 2015]);
  });
});

const profile = (sample: number, anyDefect: number, components: DefectProfile["components"]): DefectProfile => ({
  sample,
  anyDefect,
  components,
});

describe("hiddenDefectRisk", () => {
  const golf = profile(300, 150, { brakes: 60, rust: 30, lights: 90 });
  const mid = (id: string, cls: "compact" | "large" = "compact") => {
    const [from, to] = scaledParts(findJob(id)!, cls);
    return (from + to) / 2;
  };

  it("adds share of cars with a defect times the parts it usually takes", () => {
    const risk = hiddenDefectRisk(golf, "compact")!;
    const expected = 0.2 * mid("brakes_front") + 0.1 * mid("rust_welding") + 0.3 * mid("hu_prep");
    expect(risk.eur).toBe(Math.round(expected / 10) * 10);
    expect(risk.items.map((item) => item.component)).toEqual(["brakes", "lights", "rust"]);
  });

  it("leaves out what the repair jobs already cover and scales with the vehicle class", () => {
    const covered = coveredComponents(["rust_welding", "hu_prep"]);
    const risk = hiddenDefectRisk(golf, "large", covered)!;
    expect(risk.items.map((item) => item.component)).toEqual(["brakes"]);
    expect(risk.eur).toBe(Math.round((0.2 * mid("brakes_front", "large")) / 10) * 10);
  });

  it("counts nothing for a project car, whose job covers everything", () => {
    expect(coveredComponents(["prep", "project"]).size).toBe(DEFECT_COMPONENTS.length);
    expect(hiddenDefectRisk(golf, "compact", coveredComponents(["project"]))!.eur).toBe(0);
  });

  it("needs enough sampled cars", () => {
    expect(hiddenDefectRisk(profile(MIN_SAMPLE - 1, 50, { brakes: 20 }), "compact")).toBeNull();
    expect(hiddenDefectRisk(null, "compact")).toBeNull();
  });
});

describe("profiles compared with the average", () => {
  it("pools profiles with enough cars", () => {
    const pooled = poolProfiles([profile(200, 80, { rust: 10 }), profile(300, 90, { rust: 20, brakes: 30 }), profile(50, 40, { rust: 40 })]);
    expect(pooled).toEqual({ sample: 500, anyDefect: 170, components: { rust: 30, brakes: 30 } });
  });

  it("marks components clearly above average as weak points", () => {
    const own = profile(200, 100, { rust: 40, brakes: 20, glass: 2 });
    const average = profile(1000, 400, { rust: 100, brakes: 190, glass: 5 });
    const rows = compareWithAverage(own, average);
    expect(rows[0]).toEqual({ component: "rust", rate: 0.2, averageRate: 0.1, weak: true });
    expect(rows.find((row) => row.component === "brakes")).toMatchObject({ weak: false });
    // Twice the average, but too rare to matter.
    expect(rows.find((row) => row.component === "glass")).toMatchObject({ rate: 0.01, weak: false });
  });

  it("has no weak points without an average", () => {
    expect(compareWithAverage(profile(200, 100, { rust: 40 }), null).every((row) => !row.weak && row.averageRate === null)).toBe(true);
  });
});
