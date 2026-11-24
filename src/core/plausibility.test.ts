import { describe, expect, it } from "vitest";
import {
  builtUntil,
  isImplausiblePrice,
  isPlaceholderPrice,
  judgeListing,
  type ListingFacts,
  plausibleListing,
  isPlaceholderMileage,
  plausibleMileage,
  plausibleRegistration,
} from "./plausibility";
import type { NormalizedListing } from "./types";

const NOW = new Date("2026-11-24T10:00:00Z");

const facts = (overrides: Partial<ListingFacts> = {}): ListingFacts => ({
  title: "Volkswagen Golf 1.5 TSI",
  priceEur: 18_000,
  mileageKm: 40_000,
  firstRegistration: "2021-03-01",
  powerKw: 96,
  makeSlug: "volkswagen",
  modelSlug: "golf",
  ...overrides,
});

describe("isPlaceholderPrice", () => {
  it.each([1234, 12_345, 123_456, 1_234_567, 12_345_678, 1_111_111, 9_999_999, 99_999_999, 999_999, 111_111])("%i € is a placeholder", (price) =>
    expect(isPlaceholderPrice(price)).toBe(true),
  );

  it.each([0, 123, 1111, 8888, 9999, 19_999, 99_999, 12_346, 1_250_000, 3_350_000])("%i € may be a real price", (price) =>
    expect(isPlaceholderPrice(price)).toBe(false),
  );

  it("takes six equal digits for real on a car that may cost that much", () => {
    expect(isPlaceholderPrice(999_999, true)).toBe(false);
    expect(isPlaceholderPrice(9_999_999, true)).toBe(true);
  });
});

describe("isImplausiblePrice", () => {
  // Live examples from AutoScout24's "Preis absteigend".
  it("drops millions for new everyday cars", () => {
    // Ford Puma 1.0 EcoBoost, new: 29,926.61 € typed without the comma.
    expect(isImplausiblePrice(facts({ priceEur: 2_992_661, mileageKm: 0, firstRegistration: null, powerKw: 124 }), NOW)).toBe(true);
    // Hyundai BAYON 1.0 T-GDI with 15 km: 24,990 €.
    expect(isImplausiblePrice(facts({ priceEur: 2_499_000, mileageKm: 15, firstRegistration: null, powerKw: 66 }), NOW)).toBe(true);
    expect(isImplausiblePrice(facts({ priceEur: 1_500_000, mileageKm: 30_000, firstRegistration: "2025-02-01", powerKw: 110 }), NOW)).toBe(true);
    expect(isImplausiblePrice(facts({ priceEur: 1_500_000, mileageKm: 900, firstRegistration: "2015-02-01", powerKw: 110 }), NOW)).toBe(true);
  });

  it.each<[string, Partial<ListingFacts>]>([
    ["Mercedes-AMG ONE", { priceEur: 3_350_000, powerKw: 782, firstRegistration: "2023-06-01", mileageKm: 500 }],
    ["Porsche 918 Spyder", { priceEur: 2_950_000, powerKw: 652, firstRegistration: "2015-03-01", mileageKm: 3000 }],
    ["Porsche 959", { priceEur: 2_400_000, powerKw: 330, firstRegistration: "1990-01-01", mileageKm: 21_000 }],
    ["BMW 507 Roadster, restored", { priceEur: 2_190_000, powerKw: 110, firstRegistration: "1959-05-01", mileageKm: 1200 }],
    ["Lexus LFA", { priceEur: 1_600_000, powerKw: 412, firstRegistration: "2012-01-01", mileageKm: 4000 }],
    ["Ford GT", { priceEur: 1_250_000, powerKw: 485, firstRegistration: "2018-05-01", mileageKm: 2000 }],
    ["a young car whose power is not known", { priceEur: 1_500_000, powerKw: null, firstRegistration: null, mileageKm: 0 }],
    ["a used car of middle age", { priceEur: 1_200_000, powerKw: 110, firstRegistration: "2015-02-01", mileageKm: 80_000 }],
    ["a young car under a million", { priceEur: 999_000, powerKw: 110, firstRegistration: null, mileageKm: 0 }],
  ])("keeps %s", (_, overrides) => expect(isImplausiblePrice(facts(overrides), NOW)).toBe(false));
});

describe("plausibleRegistration", () => {
  const registration = (title: string, firstRegistration: string, overrides: Partial<ListingFacts> = {}) =>
    plausibleRegistration(facts({ title, firstRegistration, ...overrides }), NOW);

  it("drops a first registration after next month", () => {
    expect(registration("Hyundai IONIQ 3 Trend", "2027-01-01", { makeSlug: "hyundai", modelSlug: null })).toBeNull();
    expect(registration("Mercedes-Benz C 250 C 220 d T AMG", "2027-02-01", { makeSlug: "mercedes-benz", modelSlug: "c-klasse" })).toBeNull();
    expect(registration("Hyundai IONIQ 3 Trend", "2026-12-01", { makeSlug: "hyundai", modelSlug: null })).toBe("2026-12-01");
  });

  it("drops a first registration that is the HU date of the title", () => {
    expect(registration("Ford Focus Turnier, HU/AU 03/2025", "2025-03-01", { priceEur: 4500 })).toBeNull();
    expect(registration("Ford Focus Turnier TÜV bis 3.25", "2025-03-01", { priceEur: 4500 })).toBeNull();
    expect(registration("Ford Focus Turnier, TÜV 03/2027", "2025-03-01", { priceEur: 4500 })).toBe("2025-03-01");
  });

  it("drops a first registration years after the model or generation was built", () => {
    const porsche = { makeSlug: "porsche", modelSlug: "911" };
    expect(registration("Porsche 911 Carrera 4s 997.1", "2025-08-01", porsche)).toBeNull();
    expect(registration("Porsche 911 Carrera 4s 997.1", "2006-05-01", porsche)).toBe("2006-05-01");
    expect(registration("Porsche 911 (997) Carrera S", "2012-03-01", porsche)).toBe("2012-03-01");
    const renault = { makeSlug: "renault", modelSlug: "19", priceEur: 600 };
    expect(registration("Renault 19 – Bastlerfahrzeug / Ersatzteilspender", "2019-08-01", renault)).toBeNull();
    expect(registration("Renault 19 – Bastlerfahrzeug / Ersatzteilspender", "1995-08-01", renault)).toBe("1995-08-01");
    expect(registration("BMW 330d E46 Touring", "2018-04-01", { makeSlug: "bmw", modelSlug: "3er" })).toBeNull();
    expect(registration("Mercedes E 220 W124", "2019-06-01", { makeSlug: "mercedes-benz", modelSlug: "e-klasse" })).toBeNull();
    expect(registration("VW Golf 4 1.6 Variant", "2019-06-01")).toBeNull();
    expect(registration("Opel Astra G Caravan", "2021-06-01", { makeSlug: "opel", modelSlug: "astra" })).toBeNull();
  });

  it.each<[string, string, Partial<ListingFacts>]>([
    ["VW Golf 5-Türer 1.4 TSI", "2019-06-01", {}],
    ["VW Golf 2.0 TDI Highline", "2019-06-01", {}],
    ["VW Golf 1. Hand, Garagenwagen", "2019-06-01", {}],
    ["VW Golf 4 Motion Variant", "2019-06-01", {}],
    ["VW Golf 7 GTI Performance", "2019-06-01", {}],
    ["VW Golf 8 GTI, besser als Golf 7", "2024-06-01", {}],
    ["BMW 320d G20, kein E46", "2021-06-01", { makeSlug: "bmw", modelSlug: "3er" }],
    ["Porsche 911 Carrera S, nur 997 km", "2024-06-01", { makeSlug: "porsche", modelSlug: "911" }],
    ["Mercedes-Benz C 220 d T-Modell", "2019-06-01", { makeSlug: "mercedes-benz", modelSlug: "c-klasse" }],
    ["Opel Corsa-e Elegance", "2023-06-01", { makeSlug: "opel", modelSlug: "corsa", priceEur: 16_000 }],
    ["Audi A6 Avant mit B8-Felgen", "2019-06-01", { makeSlug: "audi", modelSlug: "a6" }],
  ])("keeps the first registration of %s", (title, firstRegistration, overrides) =>
    expect(registration(title, firstRegistration, overrides)).toBe(firstRegistration),
  );

  it("drops the first registration of an undamaged young car at a giveaway price", () => {
    const fiesta = { makeSlug: "ford", modelSlug: "fiesta" };
    // Ranked second in "Am weitesten unter Marktwert" with EZ 05/2023 for 1,850 €.
    expect(registration("Ford Fiesta 1.3 | TÜV 11/2028 | Allwette", "2023-05-01", { ...fiesta, priceEur: 1850 })).toBeNull();
    expect(registration("Ford Fiesta 1.25 Unfallwagen", "2023-05-01", { ...fiesta, priceEur: 1850 })).toBe("2023-05-01");
    expect(registration("Ford Fiesta 1.0 EcoBoost", "2023-05-01", { ...fiesta, priceEur: 9500 })).toBe("2023-05-01");
    expect(registration("Ford Fiesta 1.3", "2018-05-01", { ...fiesta, priceEur: 1850 })).toBe("2018-05-01");
    expect(registration("Ford Fiesta 1.3", "2022-10-01", { ...fiesta, priceEur: 1850 })).toBe("2022-10-01");
    expect(registration("Ford Fiesta 1.0 Taxi", "2024-05-01", { ...fiesta, priceEur: 2900, mileageKm: 260_000 })).toBe("2024-05-01");
    // Given away (0 €): nothing to compare.
    expect(registration("Ford Fiesta 1.3", "2023-05-01", { ...fiesta, priceEur: 0 })).toBe("2023-05-01");
  });
});

describe("builtUntil", () => {
  it("reads the model's and the generation's last year", () => {
    expect(builtUntil("renault", "19", "Renault 19 Chamade")).toBe(2000);
    expect(builtUntil("porsche", "911", "Porsche 911 Carrera 4S 997.1")).toBe(2009);
    expect(builtUntil("porsche", "911", "Porsche 911 997 Turbo")).toBe(2013);
    expect(builtUntil("volkswagen", "passat", "VW Passat B6 Variant")).toBe(2012);
    expect(builtUntil("audi", "a4", "Audi A4 Avant B7 S-Line")).toBe(2009);
  });

  it("says nothing for codes of other makes or models, of two generations, or of one still built", () => {
    expect(builtUntil("volkswagen", "golf", "VW Golf B6")).toBeNull();
    expect(builtUntil("bmw", "3er", "BMW E46 Felgen an E36")).toBeNull();
    expect(builtUntil("porsche", "911", "Porsche 911 992 GT3")).toBeNull();
    expect(builtUntil(null, null, "E46")).toBeNull();
  });

  it("does not take an amount for a generation", () => {
    expect(builtUntil("porsche", "911", "Porsche 911 Carrera, Finanzierung ab € 993 monatlich")).toBeNull();
    expect(builtUntil("porsche", "911", "Porsche 911 Carrera ab EUR 993")).toBeNull();
    expect(builtUntil("porsche", "911", "Porsche 911 Carrera 993 mtl.")).toBeNull();
    expect(builtUntil("porsche", "911", "Porsche 911 993 Carrera")).toBe(1998);
  });
});

describe("plausibleMileage", () => {
  it("reads 0 km on a used car as unknown", () => {
    expect(plausibleMileage(0, "2010-05-01", NOW)).toBeNull(); // Ford B-Max
    expect(plausibleMileage(0, "1984-01-01", NOW)).toBeNull(); // Opel Corsa A GSI
    expect(plausibleMileage(0, "2025-10-01", NOW)).toBeNull();
  });

  it("keeps 0 km on new cars and every other mileage", () => {
    expect(plausibleMileage(0, null, NOW)).toBe(0);
    expect(plausibleMileage(0, "2026-06-01", NOW)).toBe(0);
    expect(plausibleMileage(0, "2025-11-01", NOW)).toBe(0);
    expect(plausibleMileage(15, "2010-05-01", NOW)).toBe(15);
    expect(plausibleMileage(null, "2010-05-01", NOW)).toBeNull();
  });

  // Mileages of buyer ads and wanted ads on the live site (2026-11-24), and a BMW 528 with 1,260,900 km.
  it.each([99_999, 999_999, 9_999_999, 222_222, 11_111, 9999, 1234, 12_345, 123_456, 1_260_900, 1_000_000])("reads %i km as unknown", (km) => {
    expect(isPlaceholderMileage(km) || km >= 1_000_000).toBe(true);
    expect(plausibleMileage(km, "2018-06-01", NOW)).toBeNull();
  });

  it.each([199_999, 200_000, 100_000, 99_998, 1111, 8888, 123, 999_000, 12_346])("keeps %i km", (km) => {
    expect(isPlaceholderMileage(km)).toBe(false);
    expect(plausibleMileage(km, "2018-06-01", NOW)).toBe(km);
  });
});

describe("judgeListing", () => {
  it("names why a listing is left out", () => {
    expect(judgeListing(facts({ title: "Mercedes-Benz AMG GT Coupe 2 Türer ab 2015 *Suche*", priceEur: 1234 }), NOW).rejection).toBe("not_for_sale");
    expect(judgeListing(facts({ title: "Porsche 962", priceEur: 9_999_999, mileageKm: 9999, powerKw: 470 }), NOW).rejection).toBe("placeholder_price");
    expect(judgeListing(facts({ title: "Autoankauf Unfallautos Ankauf Kfz Ankauf Wohnmobil Ankauf SUV", priceEur: 2000 }), NOW).rejection).toBe(
      "not_for_sale",
    );
    expect(judgeListing(facts({ title: "Hyundai BAYON 1.0 T-GDI", priceEur: 2_499_000, mileageKm: 15, firstRegistration: null, powerKw: 66 }), NOW).rejection).toBe(
      "implausible_price",
    );
    expect(judgeListing(facts(), NOW)).toEqual({ rejection: null, firstRegistration: "2021-03-01", mileageKm: 40_000 });
  });

  it("judges the price by the corrected first registration and the mileage by the corrected registration", () => {
    // A new car typed with a registration in 2099: young after all, so the million is a typo.
    expect(judgeListing(facts({ priceEur: 2_000_000, firstRegistration: "2099-01-01", mileageKm: 20_000 }), NOW)).toEqual({
      rejection: "implausible_price",
      firstRegistration: null,
      mileageKm: 20_000,
    });
    expect(judgeListing(facts({ mileageKm: 0, firstRegistration: "2099-01-01" }), NOW).mileageKm).toBe(0);
    // A placeholder mileage cannot pass a cheap young car as worn out.
    expect(judgeListing(facts({ title: "VW Golf 1.0", priceEur: 2000, firstRegistration: "2026-01-01", mileageKm: 222_222 }), NOW)).toMatchObject({
      firstRegistration: null,
      mileageKm: null,
    });
  });
});

describe("plausibleListing", () => {
  const listing = (overrides: Partial<NormalizedListing> = {}): NormalizedListing => ({
    sourceId: "kleinanzeigen",
    externalId: "1",
    url: "https://www.kleinanzeigen.de/s-anzeige/x/1-216-1",
    title: "Opel Corsa A GSI",
    makeSlug: "opel",
    modelSlug: "corsa",
    makeRaw: "Opel",
    modelRaw: "Corsa A GSI",
    variant: "A GSI",
    priceEur: 6500,
    mileageKm: 0,
    firstRegistration: "1984-01-01",
    firstRegistrationYearOnly: true,
    fuel: null,
    transmission: null,
    powerKw: null,
    bodyType: null,
    color: null,
    sellerType: null,
    sellerName: null,
    zip: null,
    city: null,
    lat: null,
    lng: null,
    imageUrl: null,
    ...overrides,
  });

  it("corrects what cannot be right and keeps the rest", () => {
    expect(plausibleListing(listing(), NOW)).toEqual(listing({ mileageKm: null }));
    expect(plausibleListing(listing({ firstRegistration: "2099-01-01" }), NOW)).toEqual(
      listing({ firstRegistration: null, firstRegistrationYearOnly: false }),
    );
  });

  it("leaves out what is no car for sale", () => {
    expect(plausibleListing(listing({ title: "iphone 18 pro max weschel gegen eine transporter", priceEur: 100 }), NOW)).toBeNull();
    expect(plausibleListing(listing({ priceEur: 123_456 }), NOW)).toBeNull();
  });
});
