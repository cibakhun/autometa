import { describe, expect, it } from "vitest";
import { filtersToQuery, parseFilters } from "./filters";

describe("parseFilters", () => {
  it("parses valid values and repeated keys", () => {
    const f = parseFilters(new URLSearchParams("make=volkswagen&model=golf&priceMax=15000&fuel=diesel&fuel=petrol&zip=10115&radius=25&sort=price_asc&page=2"));
    expect(f).toMatchObject({ make: "volkswagen", model: "golf", priceMax: 15000, fuel: ["diesel", "petrol"], zip: "10115", radius: 25, sort: "price_asc", page: 2 });
  });

  it("drops invalid and empty values instead of failing", () => {
    const f = parseFilters({ priceMax: "", yearMin: "1800", fuel: ["diesel", "kerosin"], sort: "best", page: "-3", zip: "1011", make: "VW!" });
    expect(f.priceMax).toBeUndefined();
    expect(f.yearMin).toBeUndefined();
    expect(f.fuel).toEqual(["diesel"]);
    expect(f.sort).toBe("newest");
    expect(f.page).toBe(1);
    expect(f.zip).toBeUndefined();
    expect(f.make).toBeUndefined();
  });

  it("ignores a model without make, a radius without zip and distance sort without zip", () => {
    const f = parseFilters({ model: "golf", radius: "100", sort: "distance" });
    expect(f.model).toBeUndefined();
    expect(f.radius).toBeUndefined();
    expect(f.sort).toBe("newest");
  });

  it("defaults the radius to 50 km when a zip is given", () => {
    expect(parseFilters({ zip: "10115" }).radius).toBe(50);
  });

  it("round-trips through the query string", () => {
    const f = parseFilters(new URLSearchParams("make=bmw&fuel=diesel&fuel=electric&page=3"));
    expect(filtersToQuery(f)).toBe("?make=bmw&page=3&fuel=diesel&fuel=electric");
    expect(filtersToQuery(f, { page: 1 })).toBe("?make=bmw&fuel=diesel&fuel=electric");
    expect(parseFilters(new URLSearchParams(filtersToQuery(f).slice(1)))).toEqual(f);
  });
});
