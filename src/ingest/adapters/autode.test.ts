import { describe, expect, it } from "vitest";
import { PoliteFetcher } from "../http/fetcher";
import { createAutoDeAdapter, normalizeAutoDe, offerPages, parseAutoDePage, SITEMAP_URL } from "./autode";

const uuid = (n: number) => `aeef28b2-156a-4ff4-81d6-${String(n).padStart(12, "0")}`;

// Shaped like the schema.org data on auto.de's offer pages.
const car = (n: number, extra: Record<string, unknown> = {}) => ({
  "@type": "Car",
  url: `https://www.auto.de/search/vehicle/${uuid(n)}`,
  name: "Volkswagen Golf VIII 1.5 eHybrid Style, Navi, Kamera",
  vehicleIdentificationNumber: "WVWZZZCD5TW410178",
  brand: { "@type": "Brand", name: "Volkswagen" },
  manufacturer: "Volkswagen",
  model: "Golf",
  vehicleConfiguration: "VIII 1.5 eHybrid Style, Navi, Kamera",
  description: "Hybrid (Elektro / Benzin), Limousine, Automatik, Händler Müller GmbH, Tel. 0171 1234567",
  color: "Grau",
  bodyType: "Limousine",
  fuelType: "Hybrid (Elektro / Benzin)",
  vehicleTransmission: "Automatik",
  // 1 March 2021, 00:00 in Germany, in Unix seconds.
  dateVehicleFirstRegistered: 1614553200,
  vehicleModelDate: 2021,
  itemCondition: "https://schema.org/UsedCondition",
  mileageFromOdometer: { "@type": "QuantitativeValue", value: 38500, unitCode: "KMT" },
  vehicleEngine: { "@type": "EngineSpecification", enginePower: { "@type": "QuantitativeValue", value: 150, unitCode: "KWT" } },
  offers: { "@type": "Offer", price: "27990.00", priceCurrency: "EUR", url: `https://www.auto.de/search/vehicle/${uuid(n)}` },
  image: `https://images.auto.de/carimage/${uuid(n)}/0AlhRxz3Ino8/small`,
  ...extra,
});

const page = (cars: unknown[]) => `<html><head>
  <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", name: "auto.de" })}</script>
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: cars.map((item, i) => ({ "@type": "ListItem", position: i + 1, item })),
  })}</script>
</head><body></body></html>`;

describe("auto.de offer pages", () => {
  it("reads the facts of each used car, never the VIN or the description", () => {
    const items = parseAutoDePage(
      page([
        car(1),
        car(2, { itemCondition: "https://schema.org/NewCondition" }),
        car(3, {
          brand: "BMW",
          model: "3er",
          name: "BMW 320d Touring",
          vehicleConfiguration: null,
          dateVehicleFirstRegistered: null,
          vehicleModelDate: "2018",
          vehicleEngine: { enginePower: { value: 190, unitCode: "N12" } },
          mileageFromOdometer: { value: "120000" },
          offers: { price: 18990 },
          image: [{ "@type": "ImageObject", url: "https://images.auto.de/carimage/bmw/1/small" }, "https://images.auto.de/carimage/bmw/2/small"],
        }),
        car(4, { url: "https://www.auto.de/angebot/volkswagen/golf/", offers: { price: 1 } }),
        car(5, { offers: {} }),
      ]),
    );
    expect(items).toEqual([
      {
        id: uuid(1),
        url: `https://www.auto.de/search/vehicle/${uuid(1)}`,
        title: "Volkswagen Golf VIII 1.5 eHybrid Style, Navi, Kamera",
        make: "Volkswagen",
        model: "Golf",
        variant: "VIII 1.5 eHybrid Style, Navi, Kamera",
        price: 27990,
        mileageKm: 38500,
        firstRegistration: "03/2021",
        fuel: "Hybrid (Elektro / Benzin)",
        transmission: "Automatik",
        powerKw: 150,
        bodyType: "Limousine",
        color: "Grau",
        image: `https://images.auto.de/carimage/${uuid(1)}/0AlhRxz3Ino8/small`,
      },
      expect.objectContaining({ id: uuid(3), make: "BMW", model: "3er", variant: null, firstRegistration: "2018", powerKw: 140, mileageKm: 120000, image: "https://images.auto.de/carimage/bmw/1/small" }),
    ]);
    expect(JSON.stringify(items)).not.toMatch(/WVWZZZ|Müller|0171/);
  });

  it("takes the offer pages from the sitemap, on https", () => {
    const xml = `<urlset>
      <url><loc>http://www.auto.de/angebot/volkswagen/golf/</loc></url>
      <url><loc>https://www.auto.de/angebot/bmw/</loc></url>
      <url><loc>https://www.auto.de/search/?make=bmw</loc></url>
      <url><loc>https://example.com/angebot/bmw/</loc></url>
    </urlset>`;
    expect(offerPages(xml)).toEqual(["https://www.auto.de/angebot/volkswagen/golf/", "https://www.auto.de/angebot/bmw/"]);
  });

  it("normalizes a car as a dealer car, with the model from the variant when needed", () => {
    const [golf] = parseAutoDePage(page([car(1)]));
    expect(normalizeAutoDe({ externalId: golf.id, payload: { ...golf } })).toMatchObject({
      sourceId: "autode",
      makeSlug: "volkswagen",
      modelSlug: "golf",
      priceEur: 27990,
      mileageKm: 38500,
      firstRegistration: "2021-03-01",
      fuel: "hybrid",
      transmission: "automatic",
      powerKw: 150,
      sellerType: "dealer",
      sellerName: null,
      zip: null,
      imageUrl: `https://images.auto.de/carimage/${uuid(1)}/0AlhRxz3Ino8/small`,
    });
    const [tiguan] = parseAutoDePage(page([car(6, { model: "Sonstige", vehicleConfiguration: "Tiguan 2.0 TDI" })]));
    expect(normalizeAutoDe({ externalId: tiguan.id, payload: { ...tiguan } })).toMatchObject({ makeSlug: "volkswagen", modelSlug: "tiguan" });
    expect(normalizeAutoDe({ externalId: "x", payload: { ...golf, price: 99 } })).toBeNull();
  });
});

describe("auto.de adapter", () => {
  function fakeSite(routes: Record<string, string>) {
    const requested: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      requested.push(url);
      const body = routes[url];
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
    }) as typeof fetch;
    return { fetcher: new PoliteFetcher({ fetchImpl, sleep: async () => undefined, minDelayMs: 0, random: () => 0 }), requested };
  }
  const offerUrl = (path: string) => `https://www.auto.de/angebot/${path}/`;
  const sitemap = (paths: string[]) => `<urlset>${paths.map((path) => `<url><loc>${offerUrl(path)}</loc></url>`).join("")}</urlset>`;
  const robots = "User-agent: *\nDisallow: /search/\n";

  it("reads this hour's share of the offer pages and yields each car once", async () => {
    const site = fakeSite({
      "https://www.auto.de/robots.txt": robots,
      [SITEMAP_URL]: sitemap(["vw/golf", "vw/polo", "bmw/3er"]),
      [offerUrl("vw/golf")]: page([car(1), car(2)]),
      [offerUrl("vw/polo")]: page([car(2), car(3)]),
      [offerUrl("bmw/3er")]: page([car(4)]),
    });
    const adapter = createAutoDeAdapter({ fetcher: site.fetcher, pagesPerRun: 2, now: () => 0 });
    const ids = [];
    for await (const raw of adapter.fetch()) ids.push(raw.externalId);
    expect(ids).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(site.requested).not.toContain(offerUrl("bmw/3er"));
    // The detail pages under /search/ are never loaded.
    expect(site.requested.some((url) => url.includes("/search/"))).toBe(false);
  });

  it("stops with a clear error when the first ten offer pages have no cars", async () => {
    const paths = Array.from({ length: 12 }, (_, i) => `make/model-${i}`);
    const site = fakeSite({
      "https://www.auto.de/robots.txt": robots,
      [SITEMAP_URL]: sitemap(paths),
      ...Object.fromEntries(paths.map((path) => [offerUrl(path), "<html><body>Neues Design</body></html>"])),
    });
    const adapter = createAutoDeAdapter({ fetcher: site.fetcher, pagesPerRun: 12, now: () => 0 });
    await expect(async () => {
      for await (const raw of adapter.fetch()) void raw;
    }).rejects.toThrow(/autode: unexpected page .* no cars on 10 offer pages/);
  });
});
