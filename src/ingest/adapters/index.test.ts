import { afterEach, describe, expect, it, vi } from "vitest";
import { demoListingCount } from "./index";

describe("demoListingCount", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 3000 when unset or blank", () => {
    vi.stubEnv("DEMO_LISTING_COUNT", undefined);
    expect(demoListingCount()).toBe(3000);
    expect(demoListingCount(" ")).toBe(3000);
  });

  it("reads DEMO_LISTING_COUNT from the environment", () => {
    vi.stubEnv("DEMO_LISTING_COUNT", "250");
    expect(demoListingCount()).toBe(250);
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
