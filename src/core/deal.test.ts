import { describe, expect, it } from "vitest";
import { dealPercent, isTooCheap, marketConfidence } from "./deal";

describe("marketConfidence", () => {
  const facts = (comps: number, low: number, high: number) => ({ marketPriceEur: 10_000, marketLowEur: low, marketHighEur: high, marketComps: comps });

  it("trusts many comparable listings close together", () => {
    expect(marketConfidence(facts(25, 8500, 11_500))).toBe("high");
    expect(marketConfidence(facts(20, 8000, 12_000))).toBe("high");
  });

  it("calls fewer or wider spread ones medium, and few or very wide ones unsure", () => {
    expect(marketConfidence(facts(12, 9000, 11_000))).toBe("medium");
    expect(marketConfidence(facts(50, 7500, 13_000))).toBe("medium");
    expect(marketConfidence(facts(9, 9500, 10_500))).toBe("low");
    expect(marketConfidence(facts(200, 6000, 14_000))).toBe("low");
  });

  it("has none without a market value", () => {
    expect(marketConfidence({ marketPriceEur: null, marketLowEur: null, marketHighEur: null, marketComps: null })).toBeNull();
  });
});

describe("deals", () => {
  const listing = (priceEur: number, extra: Partial<Parameters<typeof dealPercent>[0]> = {}) => ({
    priceEur,
    marketPriceEur: 10_000,
    damage: [],
    confidence: "high" as const,
    ...extra,
  });

  it("is the percent below a trusted market value", () => {
    expect(dealPercent(listing(8000))).toBe(20);
    expect(dealPercent(listing(7650))).toBe(24);
    expect(dealPercent(listing(11_000))).toBe(-10);
    expect(dealPercent(listing(8000, { confidence: "medium" }))).toBe(20);
  });

  it("is none for an unsure market value or a car with damage named", () => {
    expect(dealPercent(listing(8000, { confidence: "low" }))).toBeNull();
    expect(dealPercent(listing(3000, { damage: ["engine"] }))).toBeNull();
    expect(dealPercent(listing(8000, { marketPriceEur: null, confidence: null }))).toBeNull();
  });

  it("treats an intact car at half its market value or less as too cheap to be true", () => {
    // Seen live: "VW Golf 7 bj 2019 fahrbereit FESTPREIS!!!" for 2.500 € against a market value of 16.850 €.
    expect(isTooCheap({ priceEur: 2500, marketPriceEur: 16_850, damage: [] })).toBe(true);
    expect(dealPercent(listing(5000))).toBeNull();
    expect(dealPercent(listing(5001))).toBe(50);
    // A damaged car's market value is that of an intact one: its low price is no warning sign.
    expect(isTooCheap({ priceEur: 1000, marketPriceEur: 10_000, damage: ["engine"] })).toBe(false);
    expect(isTooCheap({ priceEur: 1000, marketPriceEur: null, damage: [] })).toBe(false);
  });
});
