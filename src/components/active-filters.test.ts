import { describe, expect, it } from "vitest";
import { parseFilters } from "@/search/filters";
import { activeFilters } from "./active-filters";

describe("activeFilters", () => {
  it("has no chips for the plain search, sort and page", () => {
    expect(activeFilters(parseFilters({ sort: "price_asc", page: "3" }))).toEqual([]);
  });

  it("labels ranges, names and lists, each with a link to the search without it", () => {
    const filters = parseFilters(
      new URLSearchParams("make=volkswagen&model=golf&priceMin=2000&priceMax=8000&yearMax=1999&fuel=diesel&fuel=petrol&source=autoscout24&sort=price_asc&page=4"),
    );
    const chips = activeFilters(filters, {
      makes: [{ slug: "volkswagen", name: "VW", models: [{ slug: "golf", name: "Golf" }] }],
      sources: [{ id: "autoscout24", name: "AutoScout24" }],
    });
    expect(chips.map((chip) => chip.label)).toEqual(["VW Golf", "2.000–8.000\u00a0€", "EZ bis 1999", "Diesel", "Benzin", "AutoScout24"]);
    const byKey = Object.fromEntries(chips.map((chip) => [chip.key, chip.href]));
    expect(byKey.make).toBe("/?priceMin=2000&priceMax=8000&yearMax=1999&sort=price_asc&fuel=diesel&fuel=petrol&source=autoscout24");
    expect(byKey["fuel-diesel"]).toBe("/?make=volkswagen&model=golf&priceMin=2000&priceMax=8000&yearMax=1999&sort=price_asc&fuel=petrol&source=autoscout24");
  });

  it("falls back to slugs, drops the sentence of a search in own words and the distance sort with the zip", () => {
    const chips = activeFilters(parseFilters({ make: "porsche", zip: "10115", radius: "25", sort: "distance", ki: "Porsche um Berlin" }));
    expect(chips.map((chip) => chip.label)).toEqual(["Porsche", "25\u00a0km um 10115"]);
    expect(chips[0].href).toBe("/?zip=10115&radius=25&sort=distance");
    expect(chips[1].href).toBe("/?make=porsche");
  });

  it("keeps one-sided ranges readable", () => {
    const chips = activeFilters(parseFilters({ priceMax: "500", yearMin: "2015", kmMax: "150000", margeMin: "1000", schwierigkeit: "3" }));
    expect(chips.map((chip) => chip.label)).toEqual(["bis 500\u00a0€", "EZ ab 2015", "bis 150.000\u00a0km", "Schwierigkeit bis 3/5", "Flip-Marge ab 1.000\u00a0€"]);
  });
});
