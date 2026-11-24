import { describe, expect, it } from "vitest";
import {
  type AutoScout24Item,
  listUrl,
  normalizeAutoScout24,
  paceDelayMs,
  PageFormatError,
  parseAutoScout24Page,
  planPages,
  segmentKey,
  splitSegment,
} from "./autoscout24";

/** A result list entry shaped like the one in AutoScout24's embedded page data (synthetic values). */
export function as24Listing(overrides: Record<string, unknown> = {}) {
  return {
    id: "8f6c2a1e-0000-4000-8000-000000000001",
    url: "/angebote/volkswagen-golf-1-5-tsi-life-benzin-grau-8f6c2a1e-0000-4000-8000-000000000001",
    vehicle: {
      make: "Volkswagen",
      model: "Golf",
      modelGroup: "Golf",
      motorTypeName: "1.5 TSI",
      modelVersionInput: "Life *Navi*LED*ACC*",
      offerType: "U",
      mileageInKm: "45.000 km",
      fuel: "Benzin",
      transmission: "Schaltgetriebe",
    },
    price: { priceFormatted: "€ 21.490,-" },
    vehicleDetails: [
      { iconName: "mileage_odometer", data: "45.000 km" },
      { iconName: "calendar", data: "03/2021" },
      { iconName: "speedometer", data: "96 kW (131 PS)" },
      { iconName: "gearbox", data: "Schaltgetriebe" },
      { iconName: "gas_pump", data: "Benzin" },
    ],
    tracking: { firstRegistration: "03-2021", mileage: "45000" },
    seller: { type: "Dealer", companyName: "Autohaus Beispiel GmbH", contactName: "Max Mustermann" },
    location: { zip: "10115", city: "Berlin", countryCode: "DE" },
    images: ["https://prod.pictures.autoscout24.net/listing-images/8f6c2a1e-0000-4000-8000-000000000001_5e6f0463-7755-4412-be05-56b4fd2fec7a.jpg/250x188.webp", "https://prod.pictures.autoscout24.net/listing-images/second.jpg/250x188.webp"],
    searchResultType: "Organic",
    ...overrides,
  };
}

export function as24Page(listings: unknown[], total = listings.length, pages = Math.max(1, Math.ceil(total / 20))): string {
  const data = { props: { pageProps: { listings, numberOfResults: total, numberOfPages: pages } } };
  return `<!DOCTYPE html><html><head><title>Autos</title></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

describe("parseAutoScout24Page", () => {
  it("reads the facts of each listing and the result count", () => {
    const page = parseAutoScout24Page(as24Page([as24Listing()], 431, 22));
    expect(page.total).toBe(431);
    expect(page.pages).toBe(22);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toEqual<AutoScout24Item>({
      id: "8f6c2a1e-0000-4000-8000-000000000001",
      url: "https://www.autoscout24.de/angebote/volkswagen-golf-1-5-tsi-life-benzin-grau-8f6c2a1e-0000-4000-8000-000000000001",
      make: "Volkswagen",
      model: "Golf",
      modelGroup: "Golf",
      motor: "1.5 TSI",
      version: "Life *Navi*LED*ACC*",
      offerType: "U",
      price: 21490,
      mileage: "45.000 km",
      firstRegistration: "03/2021",
      fuel: "Benzin",
      transmission: "Schaltgetriebe",
      power: "96 kW (131 PS)",
      sellerType: "Dealer",
      dealerName: "Autohaus Beispiel GmbH",
      zip: "10115",
      city: "Berlin",
      countryCode: "DE",
      organic: true,
      image: "https://prod.pictures.autoscout24.net/listing-images/8f6c2a1e-0000-4000-8000-000000000001_5e6f0463-7755-4412-be05-56b4fd2fec7a.jpg/250x188.webp",
    });
  });

  it("never keeps a private seller's name or contact data, and of the photos only the first address", () => {
    const page = parseAutoScout24Page(as24Page([as24Listing({ seller: { type: "Private", companyName: "Erika Musterfrau" } })]));
    expect(page.items[0].dealerName).toBeNull();
    expect(JSON.stringify(page.items[0])).not.toMatch(/Musterfrau|Mustermann|second\.jpg/);
  });

  it("marks ads that are mixed into the list", () => {
    const page = parseAutoScout24Page(as24Page([as24Listing({ searchResultType: "TopSpot" })]));
    expect(page.items[0].organic).toBe(false);
  });

  it("skips entries without id, link, make or model", () => {
    const page = parseAutoScout24Page(as24Page([as24Listing({ id: "" }), as24Listing({ url: null }), as24Listing({ vehicle: {} })]));
    expect(page.items).toEqual([]);
  });

  it("refuses pages without result and page counts, which completeness depends on", () => {
    const data = (props: Record<string, unknown>) =>
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { listings: [as24Listing()], ...props } } })}</script>`;
    expect(() => parseAutoScout24Page(data({}))).toThrow(/no result or page count/);
    expect(() => parseAutoScout24Page(data({ numberOfResults: "12", numberOfPages: 1 }))).toThrow(PageFormatError);
    expect(() => parseAutoScout24Page(data({ numberOfResults: 12, numberOfPages: 0 }))).toThrow(PageFormatError);
    expect(parseAutoScout24Page(data({ numberOfResults: 0, numberOfPages: 0 })).total).toBe(0);
  });

  it("fails loudly when the page structure changed", () => {
    expect(() => parseAutoScout24Page("<html><body>Wartung</body></html>")).toThrow(PageFormatError);
    expect(() => parseAutoScout24Page('<script id="__NEXT_DATA__" type="application/json">{oops</script>')).toThrow(PageFormatError);
    expect(() => parseAutoScout24Page('<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>')).toThrow(/no listings/);
  });
});

describe("normalizeAutoScout24", () => {
  const normalize = (overrides: Record<string, unknown> = {}) => {
    const item = parseAutoScout24Page(as24Page([as24Listing(overrides)])).items[0];
    return normalizeAutoScout24({ externalId: item.id, payload: item as unknown as Record<string, unknown> });
  };

  it("maps the listing onto the common schema", () => {
    expect(normalize()).toMatchObject({
      sourceId: "autoscout24",
      makeSlug: "volkswagen",
      modelSlug: "golf",
      title: "Volkswagen Golf 1.5 TSI Life Navi LED ACC",
      variant: "1.5 TSI Life Navi LED ACC",
      priceEur: 21490,
      mileageKm: 45000,
      firstRegistration: "2021-03-01",
      fuel: "petrol",
      transmission: "manual",
      powerKw: 96,
      sellerType: "dealer",
      sellerName: "Autohaus Beispiel GmbH",
      zip: "10115",
      city: "Berlin",
      imageUrl: "https://prod.pictures.autoscout24.net/listing-images/8f6c2a1e-0000-4000-8000-000000000001_5e6f0463-7755-4412-be05-56b4fd2fec7a.jpg/250x188.webp",
    });
  });

  it("links only photos on AutoScout24's image server", () => {
    expect(normalize({ images: ["https://tracker.example/pixel.gif"] })?.imageUrl).toBeNull();
    expect(normalize({ images: [] })?.imageUrl).toBeNull();
    expect(normalize({ images: undefined })?.imageUrl).toBeNull();
  });

  it("reads the first registration in every format the page uses", () => {
    const at = (calendar: string | null, tracking: string | null) =>
      normalize({
        vehicleDetails: calendar ? [{ iconName: "calendar", data: calendar }] : [],
        tracking: { firstRegistration: tracking },
      })?.firstRegistration;
    expect(at("03/2021", null)).toBe("2021-03-01");
    expect(at(null, "03-2021")).toBe("2021-03-01");
    expect(at(null, "2021-03-01")).toBe("2021-03-01");
  });

  it("knows private sellers but not their names", () => {
    expect(normalize({ seller: { type: "Private" } })).toMatchObject({ sellerType: "private", sellerName: null });
  });

  it("skips listings without a real price", () => {
    expect(normalize({ price: { priceFormatted: "Preis auf Anfrage" } })).toBeNull();
    expect(normalize({ price: { priceFormatted: "€ 1,-" } })).toBeNull();
  });

  // Live listings that topped "Preis absteigend".
  it("skips placeholder prices and millions for new everyday cars", () => {
    const details = (power: string, mileage: string, calendar?: string) => [
      { iconName: "mileage_odometer", data: mileage },
      { iconName: "speedometer", data: power },
      ...(calendar ? [{ iconName: "calendar", data: calendar }] : []),
    ];
    const car = (make: string, model: string, version: string, price: number, power: string, mileage: string, calendar?: string) =>
      normalize({
        vehicle: { make, model, modelGroup: model, modelVersionInput: version, mileageInKm: mileage },
        price: { priceRaw: price },
        vehicleDetails: details(power, mileage, calendar),
        tracking: {},
      });
    expect(car("Porsche", "962", "962 C", 9_999_999, "470 kW (639 PS)", "9.999 km")).toBeNull();
    expect(car("Ford", "Puma", "1.0 EcoBoost Hybrid ST-Line", 2_992_661, "124 kW (169 PS)", "0 km")).toBeNull();
    expect(car("Hyundai", "BAYON", "1.0 T-GDI Trend", 2_499_000, "66 kW (90 PS)", "15 km")).toBeNull();
    expect(car("Mercedes-Benz", "AMG GT", "Coupe 2 Türer ab 2015 *Suche*", 1234, "350 kW (476 PS)", "10.000 km", "01/2016")).toBeNull();
    expect(car("Mercedes-Benz", "AMG GT", "Coupe ab 2015 *Suche*", 45_000, "350 kW (476 PS)", "10.000 km", "01/2016")).toBeNull();
    expect(car("Porsche", "918", "Spyder Weissach", 2_950_000, "652 kW (887 PS)", "3.000 km", "03/2015")).toMatchObject({ priceEur: 2_950_000, modelSlug: "918" });
    expect(car("BMW", "507", "Roadster", 2_190_000, "110 kW (150 PS)", "1.200 km", "05/1959")).toMatchObject({ priceEur: 2_190_000 });
  });

  it("leaves a first registration after next month unknown", () => {
    expect(normalize({ vehicleDetails: [{ iconName: "calendar", data: "01/2099" }], tracking: {} })?.firstRegistration).toBeNull();
  });

  it("drops postal codes of other countries", () => {
    expect(normalize({ location: { zip: "1010", city: "Wien", countryCode: "AT" } })).toMatchObject({ zip: null, city: "Wien" });
  });
});

describe("listUrl", () => {
  it("lists one make, newest first, in Germany", () => {
    expect(listUrl("volkswagen", 1)).toBe("https://www.autoscout24.de/lst/volkswagen?atype=C&cy=D&desc=1&sort=age");
    expect(listUrl("ds", 3)).toBe("https://www.autoscout24.de/lst/ds-automobiles?atype=C&cy=D&desc=1&sort=age&page=3");
  });

  it("adds the price range with an inclusive upper limit", () => {
    expect(listUrl("bmw", 2, { from: 5000, to: 6000 })).toBe(
      "https://www.autoscout24.de/lst/bmw?atype=C&cy=D&desc=1&sort=age&pricefrom=5000&priceto=5999&page=2",
    );
    expect(listUrl("bmw", 1, { from: 0, to: 1000 })).toMatch(/&priceto=999$/);
    expect(listUrl("bmw", 1, { from: 100000, to: null })).toMatch(/&pricefrom=100000$/);
  });
});

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

  it("names segments by make and range", () => {
    expect(segmentKey({ make: "bmw", priceFrom: 5000, priceTo: 6000 })).toBe("bmw:5000-6000");
    expect(segmentKey({ make: "bmw", priceFrom: 0, priceTo: null })).toBe("bmw:0-");
  });
});

describe("pacing the sweep to read everything once a day", () => {
  const pace = { cycleHours: 24, runMinutes: 50, intervalMinutes: 60, minDelayMs: 2000, maxDelayMs: 5000 };

  it("counts the pages a full read of the plan takes", () => {
    expect(planPages([{ lastTotal: null }, { lastTotal: 0 }, { lastTotal: 1 }, { lastTotal: 21 }, { lastTotal: 400 }, { lastTotal: 5000 }], 20)).toBe(
      1 + 1 + 1 + 2 + 20 + 20,
    );
  });

  it("goes as fast as the inventory needs, within its bounds", () => {
    // About 200,000 listings: no need to hurry.
    expect(paceDelayMs(10_000, 45, pace, 500)).toBe(4700);
    // About 440,000 listings: close to the floor.
    expect(paceDelayMs(22_000, 45, pace, 500)).toBe(2000);
    // Far more than a day allows at the floor: stays at the floor.
    expect(paceDelayMs(100_000, 45, pace, 500)).toBe(2000);
    // A small plan: never slower than the relaxed pause.
    expect(paceDelayMs(1_000, 45, pace, 500)).toBe(5000);
    // Slow answers leave less pause.
    expect(paceDelayMs(10_000, 45, pace, 1500)).toBeLessThan(paceDelayMs(10_000, 45, pace, 500));
  });
});
