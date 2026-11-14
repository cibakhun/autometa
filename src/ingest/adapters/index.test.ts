import { describe, expect, it } from "vitest";
import { demoListingCount } from "./index";

describe("demoListingCount", () => {
  it("defaults to 3000 when unset or blank", () => {
    expect(demoListingCount(undefined)).toBe(3000);
    expect(demoListingCount(" ")).toBe(3000);
  });

  it("accepts whole numbers of 0 or more", () => {
    expect(demoListingCount("0")).toBe(0);
    expect(demoListingCount("250")).toBe(250);
  });

  it("rejects values that are not whole numbers of 0 or more", () => {
    for (const value of ["abc", "-1", "12.5", "NaN"]) {
      expect(() => demoListingCount(value)).toThrow(/DEMO_LISTING_COUNT/);
    }
  });
});
