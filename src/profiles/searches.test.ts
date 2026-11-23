import { describe, expect, it } from "vitest";
import { parseFilters } from "@/search/filters";
import { describeSearch, normalizeSearchQuery } from "./searches";

const filters = (query: string) => parseFilters(new URLSearchParams(query));

describe("normalizeSearchQuery", () => {
  it("keeps filters and sort, drops page, 'seit' and junk, in a fixed order", () => {
    expect(normalizeSearchQuery("?page=3&priceMax=3000&make=volkswagen&sort=price_asc&seit=2026-11-22T10:00:00Z&foo=bar")).toBe(
      "make=volkswagen&priceMax=3000&sort=price_asc",
    );
    expect(normalizeSearchQuery("model=golf&make=volkswagen")).toBe(normalizeSearchQuery("make=volkswagen&model=golf"));
    expect(normalizeSearchQuery("")).toBe("");
  });
});

describe("describeSearch", () => {
  it("names make, model and the main filters", () => {
    expect(describeSearch(filters("make=volkswagen&model=golf&priceMax=3000&kmMax=150000&yearMin=2008&fuel=diesel"))).toBe(
      "Volkswagen Golf · bis 3.000 € · bis 150.000 km · ab 2008 · Diesel",
    );
  });

  it("recognizes the flip list", () => {
    expect(describeSearch(filters("zustand=defekt&schwierigkeit=3&margeMin=1000&sort=flip"))).toBe(
      "Flip-Liste · Schwierigkeit bis 3 · Marge ab 1.000 €",
    );
  });

  it("covers giveaways, places and sources", () => {
    expect(describeSearch(filters("priceMax=0&zip=10115&radius=25&source=kleinanzeigen"), { kleinanzeigen: "Kleinanzeigen" })).toBe(
      "zu verschenken · nur Kleinanzeigen · 25 km um 10115",
    );
    expect(describeSearch(filters("priceMin=1000&priceMax=2000&yearMin=2005&yearMax=2010"))).toBe("1.000–2.000 € · 2005–2010");
  });

  it("falls back to all listings and stays short", () => {
    expect(describeSearch(filters(""))).toBe("Alle Angebote");
    const long = describeSearch(filters(`q=${"x".repeat(80)}&make=volkswagen&model=golf`));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
  });
});
