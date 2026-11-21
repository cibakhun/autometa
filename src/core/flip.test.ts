import { describe, expect, it } from "vitest";
import { calculateFlip, DEFAULT_FLIP_SETTINGS, parseFlipSettings, sideCosts } from "./flip";

const settings = { ...DEFAULT_FLIP_SETTINGS, discountPct: 7, huEur: 100, registrationEur: 50, transportEur: 150, towEur: 300 };

describe("calculateFlip", () => {
  it("subtracts purchase, parts and side costs from the discounted market value", () => {
    const result = calculateFlip({ purchaseEur: 2000, marketEur: 5000, partsEur: [300, 500], hours: [6, 10], needsTow: false }, settings);
    // 5000 × 0.93 = 4650; 4650 − 2000 − 300 side costs − 400 parts = 1950; 1950 / 8 h ≈ 244 €/h.
    expect(result).toEqual({
      salePriceEur: 4650,
      sideCostsEur: 300,
      marginEur: 1950,
      marginRangeEur: [1850, 2050],
      hours: 8,
      perHourEur: 244,
    });
  });

  it("pays for towing a car that does not drive", () => {
    const result = calculateFlip({ purchaseEur: 2000, marketEur: 5000, partsEur: [400, 400], hours: [8, 8], needsTow: true }, settings);
    expect(result.sideCostsEur).toBe(450);
    expect(result.marginEur).toBe(1800);
  });

  it("has no hourly rate without hours and can lose money", () => {
    const result = calculateFlip({ purchaseEur: 6000, marketEur: 5000, partsEur: [0, 0], hours: [0, 0], needsTow: false }, settings);
    expect(result.perHourEur).toBeNull();
    expect(result.marginEur).toBe(-1650);
  });
});

describe("flip settings", () => {
  it("adds HU, registration and the right way home", () => {
    expect(sideCosts(DEFAULT_FLIP_SETTINGS, false)).toBe(140 + 60 + 150);
    expect(sideCosts(DEFAULT_FLIP_SETTINGS, true)).toBe(140 + 60 + 300);
  });

  it("parses form values and falls back to the default for each invalid one", () => {
    expect(parseFlipSettings({ level: "4", discountPct: "5.5", huEur: "-3", towEur: "abc", minMarginEur: "1500" })).toEqual({
      ...DEFAULT_FLIP_SETTINGS,
      level: 4,
      discountPct: 5.5,
      minMarginEur: 1500,
    });
    expect(parseFlipSettings({ level: 9 }).level).toBe(DEFAULT_FLIP_SETTINGS.level);
    expect(parseFlipSettings(null)).toEqual(DEFAULT_FLIP_SETTINGS);
    expect(parseFlipSettings("x")).toEqual(DEFAULT_FLIP_SETTINGS);
  });
});
