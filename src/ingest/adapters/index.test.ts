import { afterEach, describe, expect, it, vi } from "vitest";
import { ADAPTERS, demoListingCount, makesFromEnv } from "./index";

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

describe("makesFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("means all makes when unset", () => {
    vi.stubEnv("AUTOSCOUT24_MAKES", undefined);
    expect(makesFromEnv("AUTOSCOUT24_MAKES")).toBeUndefined();
  });

  it("reads known make slugs", () => {
    vi.stubEnv("AUTOSCOUT24_MAKES", "BMW, volkswagen");
    expect(makesFromEnv("AUTOSCOUT24_MAKES")).toEqual(["bmw", "volkswagen"]);
  });

  it("rejects unknown makes with a helpful message", () => {
    vi.stubEnv("KLEINANZEIGEN_MAKES", "bmw,vw");
    expect(() => makesFromEnv("KLEINANZEIGEN_MAKES")).toThrow(/KLEINANZEIGEN_MAKES has unknown makes: vw/);
  });
});

describe("ADAPTERS", () => {
  it("knows the demo source and the scraped portals", () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(["autoscout24", "demo", "kleinanzeigen"]);
  });
});
