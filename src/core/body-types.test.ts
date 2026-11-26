import { describe, expect, it } from "vitest";
import { defaultBodyType, modelsWithoutBodyType } from "./body-types";
import { plausibleListing } from "./plausibility";
import type { NormalizedListing } from "./types";

describe("defaultBodyType", () => {
  it("knows the usual body of every model but those sold in several equally", () => {
    // BMW 2er: Active Tourer, Gran Tourer, Coupé, Cabrio and Gran Coupé.
    expect(modelsWithoutBodyType()).toEqual(["bmw/2er"]);
  });

  it.each([
    ["volkswagen", "tiguan", "suv"],
    ["volkswagen", "golf", "sedan"],
    ["volkswagen", "polo", "small"],
    ["volkswagen", "touran", "van"],
    ["mercedes-benz", "c-klasse", "sedan"],
    ["audi", "rs6", "estate"],
    ["mazda", "mx-5", "convertible"],
    ["porsche", "911", "coupe"],
  ])("%s %s -> %s", (make, model, body) => {
    expect(defaultBodyType(make, model)).toBe(body);
  });

  it("has none without a known model", () => {
    expect(defaultBodyType("volkswagen", null)).toBeNull();
    expect(defaultBodyType(null, null)).toBeNull();
    expect(defaultBodyType("volkswagen", "unknown")).toBeNull();
  });
});

describe("body type of a stored listing", () => {
  const listing = (overrides: Partial<NormalizedListing>): NormalizedListing => ({
    sourceId: "autoscout24",
    externalId: "1",
    url: "https://example.org/1",
    title: "Volkswagen Tiguan 2.0 TDI",
    makeSlug: "volkswagen",
    modelSlug: "tiguan",
    makeRaw: "Volkswagen",
    modelRaw: "Tiguan",
    variant: null,
    priceEur: 20_000,
    mileageKm: 80_000,
    firstRegistration: "2019-05-01",
    fuel: "diesel",
    transmission: "automatic",
    powerKw: 110,
    bodyType: null,
    color: null,
    sellerType: "dealer",
    sellerName: null,
    zip: null,
    city: null,
    lat: null,
    lng: null,
    imageUrl: null,
    ...overrides,
  });

  it("falls back to the model's usual body", () => {
    expect(plausibleListing(listing({}))?.bodyType).toBe("suv");
  });

  it("keeps what the title or the source said", () => {
    expect(plausibleListing(listing({ title: "Volkswagen Golf Variant", modelSlug: "golf", bodyType: "estate" }))?.bodyType).toBe("estate");
    expect(plausibleListing(listing({ makeSlug: null, modelSlug: null }))?.bodyType).toBeNull();
  });
});
