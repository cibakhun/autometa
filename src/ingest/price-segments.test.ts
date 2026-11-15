import { describe, expect, it } from "vitest";
import { inPriceRange, segmentKey, splitSegment } from "./price-segments";

describe("splitSegment", () => {
  it("splits a whole make along the price ladder without gaps", () => {
    const parts = splitSegment({ make: "bmw", priceFrom: 0, priceTo: null });
    expect(parts[0]).toEqual({ make: "bmw", priceFrom: 0, priceTo: 1000 });
    expect(parts.at(-1)).toEqual({ make: "bmw", priceFrom: 100000, priceTo: null });
    for (let i = 1; i < parts.length; i += 1) expect(parts[i].priceFrom).toBe(parts[i - 1].priceTo);
  });

  it("halves a range on round amounts and doubles an open top", () => {
    expect(splitSegment({ make: "bmw", priceFrom: 10000, priceTo: 12000 })).toEqual([
      { make: "bmw", priceFrom: 10000, priceTo: 11000 },
      { make: "bmw", priceFrom: 11000, priceTo: 12000 },
    ]);
    expect(splitSegment({ make: "bmw", priceFrom: 100000, priceTo: null })).toEqual([
      { make: "bmw", priceFrom: 100000, priceTo: 200000 },
      { make: "bmw", priceFrom: 200000, priceTo: null },
    ]);
  });

  it("stops at narrow ranges", () => {
    expect(splitSegment({ make: "bmw", priceFrom: 10000, priceTo: 10100 })).toEqual([]);
    expect(splitSegment({ make: "bmw", priceFrom: 10000, priceTo: 10200 })).toHaveLength(2);
  });

  it("treats the lower bound as inclusive and the upper bound as exclusive", () => {
    const range = { make: "bmw", priceFrom: 5000, priceTo: 6000 };
    expect(inPriceRange(5000, range)).toBe(true);
    expect(inPriceRange(5999.99, range)).toBe(true);
    expect(inPriceRange(6000, range)).toBe(false);
    expect(inPriceRange(null, range)).toBe(false);
    expect(inPriceRange(250000, { make: "bmw", priceFrom: 100000, priceTo: null })).toBe(true);
  });

  it("names segments by make and range", () => {
    expect(segmentKey({ make: "bmw", priceFrom: 5000, priceTo: 6000 })).toBe("bmw:5000-6000");
    expect(segmentKey({ make: "bmw", priceFrom: 0, priceTo: null })).toBe("bmw:0-");
  });
});
