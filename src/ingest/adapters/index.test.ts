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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("knows the demo source, the scraped portals and the mobile.de API", () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(["autoscout24", "demo", "kleinanzeigen", "mobilede"]);
  });

  it("refuses to start mobile.de without an API account", () => {
    vi.stubEnv("MOBILE_DE_API_USER", "");
    vi.stubEnv("MOBILE_DE_API_PASSWORD", "");
    expect(() => ADAPTERS.mobilede({ pool: undefined as never })).toThrow(/MOBILE_DE_API_USER and MOBILE_DE_API_PASSWORD/);
  });

  it("creates the mobile.de adapter once the API account is set", () => {
    vi.stubEnv("MOBILE_DE_API_USER", "test-user");
    vi.stubEnv("MOBILE_DE_API_PASSWORD", "test-password");
    expect(ADAPTERS.mobilede({ pool: undefined as never }).source).toMatchObject({ id: "mobilede", kind: "api" });
  });
});
