import { describe, expect, it } from "vitest";
import type { ListingSummary } from "@/search/query";
import { favoritesAlert, isQuietTime, listingLine, searchAlert } from "./messages";

/** German money formats put a no-break space before "€". */
const nb = (text: string) => text.replace(/ €/g, "\u00a0€");

const listing = (overrides: Partial<ListingSummary>): ListingSummary => ({
  id: 1,
  title: "VW Golf 1.4",
  makeSlug: "volkswagen",
  modelSlug: "golf",
  priceEur: 2500,
  mileageKm: 180_000,
  firstRegistration: "2010-03-01",
  firstRegistrationYearOnly: false,
  fuel: "petrol",
  transmission: "manual",
  powerKw: 59,
  bodyType: "small",
  sellerType: "private",
  zip: "10115",
  city: "Berlin",
  sourceId: "kleinanzeigen",
  sourceName: "Kleinanzeigen",
  distanceKm: null,
  otherOffers: [],
  imageUrl: null,
  huUntil: null,
  huBasis: null,
  damage: [],
  marketPriceEur: null,
  marketComps: null,
  repair: null,
  flip: null,
  checkedAt: "2026-11-23T10:00:00.000Z",
  firstSeenAt: "2026-11-23T09:00:00.000Z",
  priceDroppedAt: null,
  priceBeforeDropEur: null,
  reliabilityRatio: null,
  ...overrides,
});

describe("isQuietTime", () => {
  it("is quiet from 22:00 to 7:00 German time, summer and winter", () => {
    expect(isQuietTime(new Date("2026-11-23T20:59:00Z"))).toBe(false); // 21:59 CET
    expect(isQuietTime(new Date("2026-11-23T21:00:00Z"))).toBe(true); // 22:00 CET
    expect(isQuietTime(new Date("2026-11-24T05:59:00Z"))).toBe(true); // 6:59 CET
    expect(isQuietTime(new Date("2026-11-24T06:00:00Z"))).toBe(false); // 7:00 CET
    expect(isQuietTime(new Date("2026-07-01T04:59:00Z"))).toBe(true); // 6:59 CEST
    expect(isQuietTime(new Date("2026-07-01T05:00:00Z"))).toBe(false); // 7:00 CEST
  });
});

describe("searchAlert", () => {
  const since = "2026-11-23T08:00:00.000Z";

  it("opens the listing itself when there is one", () => {
    const alert = searchAlert({ id: 7, name: "VW Golf · bis 3.000 €" }, 1, [listing({ id: 42 })], since);
    expect(alert).toEqual({
      title: "1 neu: VW Golf · bis 3.000 €",
      body: nb("VW Golf 1.4 · 2.500 € · 180.000 km · Berlin"),
      url: "/angebot/42",
      tag: "suche-7",
    });
  });

  it("opens the new ones of the search when there are several, naming three", () => {
    const items = [1, 2, 3, 4].map((id) => listing({ id, title: `Golf ${id}` }));
    const alert = searchAlert({ id: 7, name: "Golf" }, 12, items, since);
    expect(alert.title).toBe("12 neu: Golf");
    expect(alert.body.split("\n")).toEqual([
      nb("Golf 1 · 2.500 € · 180.000 km · Berlin"),
      nb("Golf 2 · 2.500 € · 180.000 km · Berlin"),
      nb("Golf 3 · 2.500 € · 180.000 km · Berlin"),
      "und 9 weitere",
    ]);
    expect(alert.url).toBe(`/suchauftraege/7/neu?ab=${encodeURIComponent(since)}`);
  });

  it("says cheaper when the vehicles were known before and only the price went down", () => {
    const item = listing({ firstSeenAt: "2026-11-01T00:00:00.000Z", priceDroppedAt: "2026-11-23T09:30:00.000Z", priceBeforeDropEur: 2900 });
    const alert = searchAlert({ id: 7, name: "Golf" }, 1, [item], since);
    expect(alert.title).toBe("1 günstiger: Golf");
    expect(alert.body).toBe(nb("VW Golf 1.4 · 2.500 € (vorher 2.900 €) · 180.000 km · Berlin"));
  });
});

describe("listingLine", () => {
  it("adds the flip margin when there is one, and leaves out unknowns", () => {
    const line = listingLine(
      listing({ mileageKm: null, city: null, priceEur: 0, flip: { marginEur: 1200 } as ListingSummary["flip"] }),
    );
    expect(line).toBe(nb("VW Golf 1.4 · Zu verschenken · Flip +1.200 €"));
  });
});

describe("favoritesAlert", () => {
  it("names one price drop and opens the listing", () => {
    expect(favoritesAlert([{ listingId: 5, title: "Polo", priceEur: 1800, previousEur: 2100, gone: false }])).toEqual({
      title: "Merkliste: Preis gesenkt",
      body: nb("Polo: 2.100 € → 1.800 €"),
      url: "/angebot/5",
      tag: "merkliste",
    });
  });

  it("sums up several changes and opens the list", () => {
    const alert = favoritesAlert([
      { listingId: 5, title: "Polo", priceEur: 1800, previousEur: 2100, gone: false },
      { listingId: 6, title: "Corsa", priceEur: 900, previousEur: 900, gone: true },
    ]);
    expect(alert.title).toBe("Merkliste: 2 Änderungen");
    expect(alert.body).toBe(nb("Polo: 2.100 € → 1.800 €\nCorsa: nicht mehr online"));
    expect(alert.url).toBe("/merkliste");
  });
});
