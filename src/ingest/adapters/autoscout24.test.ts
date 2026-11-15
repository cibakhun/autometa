import { describe, expect, it } from "vitest";
import {
  listUrl,
  normalizeAutoScout24,
  PageFormatError,
  parseAutoScout24Page,
  type AutoScout24Item,
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
    images: ["https://example.org/photo.jpg"],
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
    });
  });

  it("never keeps a private seller's name, photos or contact data", () => {
    const page = parseAutoScout24Page(as24Page([as24Listing({ seller: { type: "Private", companyName: "Erika Musterfrau" } })]));
    expect(page.items[0].dealerName).toBeNull();
    expect(JSON.stringify(page.items[0])).not.toMatch(/Musterfrau|Mustermann|photo/);
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
    });
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
