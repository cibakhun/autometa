import { describe, expect, it } from "vitest";
import { MAKES } from "@/core/taxonomy";
import { BlockedError, BudgetExceededError } from "../http/fetcher";
import {
  ApiFormatError,
  MOBILE_DE_MAKE_KEYS,
  MobileDeApi,
  normalizeMobileDe,
  parseMobileDeSearch,
  searchUrl,
  type MobileDeItem,
} from "./mobilede";

/** An ad shaped like the Search-API's "new JSON" format (synthetic values). */
function ad(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mobileAdId: "400123456",
    mobileSellerId: "11",
    creationDate: "2026-10-01T10:00:00+02:00",
    modificationDate: "2026-11-14T16:08:18+01:00",
    vehicleClass: "Car",
    category: "Limousine",
    make: "VW",
    model: "Golf",
    modelDescription: "Golf 1.4 TSI Comfortline",
    condition: "USED",
    firstRegistration: "201905",
    mileage: 64000,
    power: 92,
    fuel: "PETROL",
    gearbox: "MANUAL_GEAR",
    description: "Scheckheftgepflegt, Nichtraucher",
    images: [{ uri: "https://img.example/1.jpg" }],
    detailPageUrl: "https://suchen.mobile.de/auto-inserat/vw-golf-berlin/400123456.html?source=api",
    seller: {
      mobileSellerId: "11",
      type: "DEALER",
      commercial: true,
      companyName: "Autohaus Beispiel GmbH",
      email: "verkauf@example.com",
      phones: [{ number: "030 1234567" }],
      address: { zipcode: "10115", city: "Berlin", country: "DE" },
    },
    price: { consumerPriceGross: "14990.00", type: "FIXED", currency: "EUR" },
    ...overrides,
  };
}

const answer = (ads: unknown[], total = ads.length, maxPages = 1, extra: Record<string, unknown> = {}) => ({
  total,
  currentPage: 1,
  maxPages,
  pageSize: 100,
  ads,
  ...extra,
});

const raw = (item: MobileDeItem) => ({ externalId: item.id, payload: item as unknown as Record<string, unknown> });

describe("searchUrl", () => {
  it("asks for one make, newest changes first, with the price range ending below the next one", () => {
    expect(searchUrl("volkswagen", 2, { from: 5000, to: 6000 })).toBe(
      "https://services.mobile.de/search-api/search?classification=refdata/classes/Car/makes/VW&country=DE&sort.field=modificationTime&sort.order=DESCENDING&page.size=100&page.number=2&price.min=5000&price.max=5999.99",
    );
  });

  it("leaves out open price bounds and encodes make keys with spaces once", () => {
    const url = searchUrl("alfa-romeo", 1, { from: 0, to: null });
    expect(url).toContain("classification=refdata/classes/Car/makes/ALFA%20ROMEO&");
    expect(url).not.toContain("price.");
    expect(searchUrl("bmw", 1)).not.toContain("price.");
  });

  it("knows a mobile.de key for every make of the taxonomy", () => {
    for (const make of MAKES) expect(MOBILE_DE_MAKE_KEYS[make.slug], make.slug).toMatch(/^[A-Z0-9 .-]+$/);
    expect(() => searchUrl("trabant", 1)).toThrow(/No mobile.de make key/);
  });
});

describe("parseMobileDeSearch", () => {
  it("reads ads and the counts of the whole list", () => {
    const page = parseMobileDeSearch(answer([ad()], 250, 3));
    expect(page.total).toBe(250);
    expect(page.pages).toBe(3);
    expect(page.items).toEqual([
      {
        id: "400123456",
        url: "https://suchen.mobile.de/auto-inserat/vw-golf-berlin/400123456.html?source=api",
        make: "VW",
        model: "Golf",
        title: "Golf 1.4 TSI Comfortline",
        price: 14990,
        mileage: 64000,
        firstRegistration: "201905",
        fuel: "PETROL",
        pluginHybrid: false,
        gearbox: "MANUAL_GEAR",
        power: 92,
        category: "Limousine",
        condition: "USED",
        sellerType: "DEALER",
        dealerName: "Autohaus Beispiel GmbH",
        zip: "10115",
        city: "Berlin",
        country: "DE",
      },
    ]);
  });

  it("never keeps descriptions, photos, phone numbers, e-mail addresses or private sellers' names", () => {
    const privateAd = ad({
      mobileAdId: "2",
      seller: { type: "FOR_SALE_BY_OWNER", commercial: false, companyName: "Max Mustermann", phones: [{ number: "0170 1" }], address: { zipcode: "80331", city: "München", country: "DE" } },
    });
    const stored = JSON.stringify(parseMobileDeSearch(answer([ad(), privateAd])).items);
    for (const secret of ["Scheckheft", "img.example", "030 1234567", "verkauf@example.com", "Max Mustermann", "0170"]) {
      expect(stored).not.toContain(secret);
    }
  });

  it("keeps a dealer's headline but never a private seller's free text", () => {
    const owner = { type: "FOR_SALE_BY_OWNER", address: { zipcode: "80331", city: "München", country: "DE" } };
    const { items } = parseMobileDeSearch(
      answer([
        ad({ mobileAdId: "1" }),
        ad({ mobileAdId: "2", modelDescription: "Golf von Erika Musterfrau", seller: owner }),
        ad({ mobileAdId: "3", modelDescription: "Golf von Erika Musterfrau", seller: {} }),
        ad({ mobileAdId: "4", model: null, modelDescription: "Golf von Erika Musterfrau", seller: owner }),
      ]),
    );
    // Without a structured model, a private ad is skipped rather than named after its headline.
    expect(items.map((item) => item.id)).toEqual(["1", "2", "3"]);
    const [dealer, privateAd, unknown] = items;
    expect(dealer.title).toBe("Golf 1.4 TSI Comfortline");
    expect(privateAd).toMatchObject({ model: "Golf", title: null });
    expect(unknown).toMatchObject({ model: "Golf", title: null, sellerType: null });
    expect(JSON.stringify([privateAd, unknown])).not.toContain("Musterfrau");
  });

  it("skips ads without id, make, model or a link to mobile.de", () => {
    const page = parseMobileDeSearch(
      answer([
        ad({ mobileAdId: null }),
        ad({ make: "" }),
        ad({ model: null, modelDescription: null }),
        ad({ detailPageUrl: "https://evil.example/400123456" }),
        ad({ detailPageUrl: "http://suchen.mobile.de/x" }),
        ad({ mobileAdId: "ok", model: null }),
      ]),
    );
    expect(page.items.map((item) => [item.id, item.model])).toEqual([["ok", "Golf 1.4 TSI Comfortline"]]);
  });

  it("stops when no ad of a page has the expected fields, but not on an empty page", () => {
    const renamed = [ad(), ad()].map(({ mobileAdId, ...rest }) => ({ ...rest, adId: mobileAdId }));
    expect(() => parseMobileDeSearch(answer(renamed))).toThrow(/none of 2 ads/);
    expect(parseMobileDeSearch(answer([], 0, 0)).items).toEqual([]);
  });

  it("only takes prices in euros", () => {
    const [chf, number] = parseMobileDeSearch(
      answer([ad({ mobileAdId: "a", price: { consumerPriceGross: "9000.00", currency: "CHF" } }), ad({ mobileAdId: "b", price: { consumerPriceGross: 8500 } })]),
    ).items;
    expect(chf.price).toBeNull();
    expect(number.price).toBe(8500);
  });

  it("stops on query errors and on answers without counts", () => {
    expect(() => parseMobileDeSearch(answer([], 0, 0, { errors: [{ key: "invalid-parameter", args: ["price.max"] }] }))).toThrow(ApiFormatError);
    expect(() => parseMobileDeSearch({ ads: [] })).toThrow(ApiFormatError);
    expect(() => parseMobileDeSearch({ total: 3, maxPages: 1 })).toThrow(ApiFormatError);
    expect(() => parseMobileDeSearch(answer([ad()], 5, 0))).toThrow(ApiFormatError);
    expect(parseMobileDeSearch(answer([], 0, 0)).items).toEqual([]);
  });
});

describe("normalizeMobileDe", () => {
  const item = (overrides: Record<string, unknown> = {}) => parseMobileDeSearch(answer([ad(overrides)])).items[0];

  it("maps an ad to the common format", () => {
    expect(normalizeMobileDe(raw(item()))).toEqual({
      sourceId: "mobilede",
      externalId: "400123456",
      url: "https://suchen.mobile.de/auto-inserat/vw-golf-berlin/400123456.html?source=api",
      title: "Volkswagen Golf 1.4 TSI Comfortline",
      makeSlug: "volkswagen",
      modelSlug: "golf",
      makeRaw: "VW",
      modelRaw: "Golf",
      variant: "1.4 TSI Comfortline",
      priceEur: 14990,
      mileageKm: 64000,
      firstRegistration: "2019-05-01",
      fuel: "petrol",
      transmission: "manual",
      powerKw: 92,
      bodyType: "sedan",
      color: null,
      sellerType: "dealer",
      sellerName: "Autohaus Beispiel GmbH",
      zip: "10115",
      city: "Berlin",
      lat: null,
      lng: null,
    });
  });

  it("maps mobile.de's fuel, gearbox and body type keys", () => {
    expect(normalizeMobileDe(raw(item({ fuel: "ELECTRICITY", gearbox: "AUTOMATIC_GEAR", category: "OffRoad" })))).toMatchObject({
      fuel: "electric",
      transmission: "automatic",
      bodyType: "suv",
    });
    expect(normalizeMobileDe(raw(item({ fuel: "HYBRID", hybridPlugin: true })))!.fuel).toBe("plugin_hybrid");
    expect(normalizeMobileDe(raw(item({ fuel: "HYBRID_DIESEL" })))!.fuel).toBe("hybrid");
    expect(normalizeMobileDe(raw(item({ fuel: "HYDROGENIUM", gearbox: "SEMIAUTOMATIC_GEAR", category: "EstateCar" })))).toMatchObject({
      fuel: "hydrogen",
      transmission: "automatic",
      bodyType: "estate",
    });
  });

  it("knows private sellers but never their names", () => {
    const listing = normalizeMobileDe(raw(item({ seller: { commercial: false, companyName: "Max", address: { zipcode: "80331", city: "München", country: "DE" } } })));
    expect(listing).toMatchObject({ sellerType: "private", sellerName: null, zip: "80331" });
  });

  it("keeps foreign postal codes out of the radius search", () => {
    const listing = normalizeMobileDe(raw(item({ seller: { type: "DEALER", address: { zipcode: "1010", city: "Wien", country: "AT" } } })));
    expect(listing).toMatchObject({ zip: null, city: "Wien" });
  });

  it("skips ads without a usable price and tolerates odd registration dates", () => {
    expect(normalizeMobileDe(raw(item({ price: { consumerPriceGross: "1.00", currency: "EUR" } })))).toBeNull();
    expect(normalizeMobileDe(raw(item({ price: {} })))).toBeNull();
    expect(normalizeMobileDe(raw(item({ firstRegistration: "201913" })))!.firstRegistration).toBeNull();
  });

  it("cuts off cents so a price stays in the range it was found in", () => {
    expect(normalizeMobileDe(raw(item({ price: { consumerPriceGross: "999.80", currency: "EUR" } })))!.priceEur).toBe(999);
    expect(normalizeMobileDe(raw(item({ price: { consumerPriceGross: "1000.20", currency: "EUR" } })))!.priceEur).toBe(1000);
  });

  it("names private sellers' cars by make and model only", () => {
    const listing = normalizeMobileDe(raw(item({ seller: { type: "FOR_SALE_BY_OWNER" }, modelDescription: "Golf 1.4 TSI von Erika" })));
    expect(listing).toMatchObject({ title: "Volkswagen Golf", modelSlug: "golf", variant: null, sellerName: null });
  });

  it("uses the model when the title names no known model", () => {
    const listing = normalizeMobileDe(raw(item({ make: "MERCEDES-BENZ", model: "C 220", modelDescription: "C 220 d T-Modell Avantgarde" })));
    expect(listing).toMatchObject({ makeSlug: "mercedes-benz", title: "Mercedes-Benz C 220 d T-Modell Avantgarde" });
    const plain = normalizeMobileDe(raw(item({ make: "ABARTH", model: "500", modelDescription: "500" })));
    expect(plain).toMatchObject({ title: "Abarth 500", variant: null });
  });
});

describe("MobileDeApi", () => {
  function fakeApi(responses: Array<() => Response>, options: { maxRequests?: number } = {}) {
    const calls: { url: string; headers: Record<string, string>; at: number }[] = [];
    let clock = 0;
    const api = new MobileDeApi({
      user: "test-user",
      password: "test-password",
      minDelayMs: 1000,
      maxRequests: options.maxRequests,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string>, at: clock });
        return (responses.shift() ?? (() => Response.json(answer([]))))();
      }) as typeof fetch,
    });
    return { api, calls };
  }

  it("signs in with the API account, asks for the new JSON format and waits between requests", async () => {
    const { api, calls } = fakeApi([() => Response.json(answer([ad()]))]);
    expect(parseMobileDeSearch(await api.getJson("https://services.mobile.de/search-api/search?a=1")).items).toHaveLength(1);
    await api.getJson("https://services.mobile.de/search-api/search?a=2");
    expect(calls[0].headers).toMatchObject({
      authorization: `Basic ${Buffer.from("test-user:test-password").toString("base64")}`,
      accept: "application/vnd.de.mobile.api+json",
    });
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(1000);
    expect(api.requestsMade).toBe(2);
  });

  it("stops at once when the account is rejected or rate-limited", async () => {
    for (const status of [401, 403, 429]) {
      const { api } = fakeApi([() => new Response("nope", { status })]);
      await expect(api.getJson("https://services.mobile.de/search-api/search")).rejects.toBeInstanceOf(BlockedError);
    }
  });

  it("starts the pause after the answer was read to the end", async () => {
    let clock = 0;
    const starts: number[] = [];
    const api = new MobileDeApi({
      user: "u",
      password: "p",
      minDelayMs: 1000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetchImpl: (async () => {
        starts.push(clock);
        // The headers come at once, the body takes five seconds.
        return {
          ok: true,
          status: 200,
          text: async () => {
            clock += 5000;
            return JSON.stringify(answer([]));
          },
        } as unknown as Response;
      }) as typeof fetch,
    });
    await api.getJson("https://services.mobile.de/search-api/search?a=1");
    await api.getJson("https://services.mobile.de/search-api/search?a=2");
    expect(starts).toEqual([0, 6000]);
  });

  it("frees the connection of a refused answer without hiding its status", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const { api } = fakeApi([() => new Response(body, { status: 404 })]);
    await expect(api.getJson("https://services.mobile.de/search-api/search")).rejects.toMatchObject({ status: 404 });
    expect(cancelled).toBe(true);

    const failingCancel = { ok: false, status: 403, body: { cancel: () => Promise.reject(new Error("socket gone")) } } as unknown as Response;
    const refused = fakeApi([() => failingCancel]);
    await expect(refused.api.getJson("https://services.mobile.de/search-api/search")).rejects.toBeInstanceOf(BlockedError);
  });

  it("reports answers that are not JSON and keeps to the request budget", async () => {
    const { api } = fakeApi([() => new Response("<html>Wartung</html>")], { maxRequests: 1 });
    await expect(api.getJson("https://services.mobile.de/search-api/search")).rejects.toBeInstanceOf(ApiFormatError);
    await expect(api.getJson("https://services.mobile.de/search-api/search")).rejects.toBeInstanceOf(BudgetExceededError);
    expect(api.requestsLeft).toBe(0);
  });
});
