import { describe, expect, it } from "vitest";
import { PoliteFetcher } from "../http/fetcher";
import { createQuokaAdapter, listUrl, normalizeQuoka, parseMakeLinks, parseQuokaPage } from "./quoka";

interface Ad {
  id: string;
  title: string;
  facts?: string;
  place?: string;
  price?: string;
  oldPrice?: string;
}

const adHtml = (ad: Ad) => `
  <li class="q-ln hlisting">
    <a class="img" href="/anzeigen/auto-motorrad/automarkt/anzeige/${ad.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/${ad.id}.html"><img src="https://s3.quoka.de/quoka/top/20261115/1158/${ad.id}.webp" width="200" height="200"></a>
    <div class="q-col n2">
      <a href="https://www.quoka.de/anzeigen/auto-motorrad/automarkt/anzeige/x/${ad.id}.html"><h2 class="fn">${ad.title}</h2></a>
      ${ad.facts ? `<div class="attributes">${ad.facts}</div>` : ""}
      <div class="description">Ruf an unter 0171 1234567, Herr Müller</div>
      ${ad.place ? `<div class="location">${ad.place}</div>` : ""}
      <div class="date">15 November</div>
    </div>
    <div class="price">${ad.price ? `<strong>${ad.price}</strong>` : ""}${ad.oldPrice ? `<span class="old-price">${ad.oldPrice}</span>` : ""}</div>
  </li>`;

const makeNav = `
  <ul class="cat-nav">
    <li><a href="/anzeigen/auto-motorrad/automarkt/volkswagen/">Volkswagen <span>(196448)</span></a></li>
    <li><a href="https://www.quoka.de/anzeigen/auto-motorrad/automarkt/bmw/">Bmw (91708)</a></li>
    <li><a href="/anzeigen/auto-motorrad/automarkt/mercedes/">Mercedes (121)</a></li>
    <li><a href="/anzeigen/auto-motorrad/automarkt/mercedes-benz/">Mercedes-Benz (120.311)</a></li>
    <li><a href="/anzeigen/auto-motorrad/automarkt/oldtimer/">Oldtimer (512)</a></li>
  </ul>`;

const page = (ads: Ad[], nav = "") => `<html><body>${nav}<ul class="q-lst">${ads.map(adHtml).join("")}</ul></body></html>`;

const tiguan: Ad = {
  id: "92e4gff2117d7g17111d39ig8d094g5f",
  title: "VW Tiguan Allspace 2.0 TDI 190 PS DSG 4Motion Highline",
  facts: "2018 | diesel | 96020 km",
  place: "94351 Feldkirchen Niederbay, Bayern",
  price: "21 990 EUR",
};
const arteon: Ad = { id: "8482gf324d5f7d1515296ei411d668he", title: "VW Arteon 2.0 TSI Elegance", facts: "2017 | benzin | 129833 km", place: "47441 Moers, Nordrhein-Westfalen", price: "15550.0 EUR", oldPrice: "15990.0 EUR" };
const part: Ad = { id: "1781h7hg5334773he7eg702936d8f98i", title: "Fensterheberschalter links für Fiat Panda 2 Neu", place: "10115 Berlin", price: "12 EUR" };

describe("Quoka result pages", () => {
  it("reads the facts of each ad, never the description", () => {
    const items = parseQuokaPage(page([tiguan, arteon, part]), listUrl(null), "volkswagen");
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      id: tiguan.id,
      url: `https://www.quoka.de/anzeigen/auto-motorrad/automarkt/anzeige/vw-tiguan-allspace-2-0-tdi-190-ps-dsg-4motion-highline/${tiguan.id}.html`,
      title: tiguan.title,
      price: 21990,
      mileageKm: 96020,
      firstRegistration: "2018",
      fuel: "diesel",
      zip: "94351",
      city: "Feldkirchen Niederbay",
      listMake: "volkswagen",
    });
    expect(items[1]).toMatchObject({ price: 15550, fuel: "petrol" });
    expect(JSON.stringify(items)).not.toMatch(/Müller|0171/);
  });

  it("maps make links to our makes and keeps the bigger of two paths", () => {
    expect(parseMakeLinks(makeNav)).toEqual([
      { make: "volkswagen", path: "volkswagen", count: 196448 },
      { make: "bmw", path: "bmw", count: 91708 },
      { make: "mercedes-benz", path: "mercedes-benz", count: 120311 },
    ]);
  });

  it("builds list URLs with Quoka's paging parameter", () => {
    expect(listUrl(null)).toBe("https://www.quoka.de/anzeigen/auto-motorrad/automarkt/");
    expect(listUrl("bmw", 3)).toBe("https://www.quoka.de/anzeigen/auto-motorrad/automarkt/bmw/?pag=3");
  });

  it("normalizes cars and drops parts", () => {
    const [car, , accessory] = parseQuokaPage(page([tiguan, arteon, part]), listUrl(null), "volkswagen");
    expect(normalizeQuoka({ externalId: car.id, payload: { ...car } })).toMatchObject({
      sourceId: "quoka",
      makeSlug: "volkswagen",
      modelSlug: "tiguan",
      priceEur: 21990,
      mileageKm: 96020,
      firstRegistration: "2018-01-01",
      fuel: "diesel",
      transmission: "automatic",
      powerKw: 140,
      sellerType: null,
      sellerName: null,
      zip: "94351",
      imageUrl: `https://s3.quoka.de/quoka/top/20261115/1158/${tiguan.id}.webp`,
    });
    expect(normalizeQuoka({ externalId: accessory.id, payload: { ...accessory } })).toBeNull();
    expect(normalizeQuoka({ externalId: "w1", payload: { ...car, title: "Suche VW Tiguan bis 20.000 €" } })).toBeNull();
  });

  it("finds make and model behind leading words", () => {
    const [car] = parseQuokaPage(page([{ ...tiguan, title: "2023 Skoda Superb 2.0 TSI 140kW DSG" }]), listUrl(null), "skoda");
    expect(normalizeQuoka({ externalId: car.id, payload: { ...car } })).toMatchObject({ makeSlug: "skoda", modelSlug: "superb", modelRaw: "Superb 2.0 TSI 140kW DSG" });
  });
});

describe("Quoka adapter", () => {
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
  const ads = (from: number, count: number, title = "BMW 320d Touring"): Ad[] =>
    Array.from({ length: count }, (_, i) => ({ id: `ad${String(from + i).padStart(8, "0")}`, title, facts: "2019 | diesel | 80000 km", price: "18.500 EUR" }));

  it("reads the make lists linked on the category page, then the rest of the category", async () => {
    const site = fakeSite({
      "https://www.quoka.de/robots.txt": "User-agent: *\nDisallow: /Detailansicht/\n",
      [listUrl(null)]: page(ads(1, 2), makeNav),
      [listUrl("bmw")]: page(ads(1, 3)),
      [listUrl("bmw", 2)]: page(ads(4, 1)),
      // Quoka repeats the last page when asked for more.
      [listUrl("bmw", 3)]: page(ads(4, 1)),
      [listUrl("volkswagen")]: page(ads(10, 1, "VW Golf 1.5 TSI")),
      [listUrl(null, 2)]: page(ads(20, 2, "Opel Astra 1.2")),
      [listUrl(null, 3)]: page(ads(22, 1, "Opel Corsa 1.2")),
      [listUrl(null, 4)]: page(ads(23, 1, "Opel Corsa 1.2")),
    });
    const adapter = createQuokaAdapter({ fetcher: site.fetcher, makes: ["bmw", "volkswagen"], pagesPerList: 3 });
    const raws = [];
    for await (const raw of adapter.fetch()) raws.push(raw);

    expect(raws.map((r) => [r.externalId, (r.payload as { listMake: string | null }).listMake])).toEqual([
      ["ad00000010", "volkswagen"],
      ["ad00000001", "bmw"],
      ["ad00000002", "bmw"],
      ["ad00000003", "bmw"],
      ["ad00000004", "bmw"],
      ["ad00000020", null],
      ["ad00000021", null],
      ["ad00000022", null],
    ]);
    // mercedes-benz is not wanted; the category's page 4 is beyond pagesPerList.
    expect(site.requested.some((url) => url.includes("mercedes"))).toBe(false);
    expect(site.requested).not.toContain(listUrl(null, 4));
  });

  it("uses our make slugs as paths when the page has no make menu", async () => {
    const site = fakeSite({
      "https://www.quoka.de/robots.txt": "User-agent: *\nAllow: /\n",
      [listUrl(null)]: page(ads(1, 2)),
      [listUrl(null, 2)]: page(ads(3, 1)),
      [listUrl("mercedes-benz")]: page(ads(10, 1, "Mercedes-Benz C 220 d")),
    });
    const messages: string[] = [];
    const adapter = createQuokaAdapter({ fetcher: site.fetcher, makes: ["mercedes-benz", "lada"], pagesPerList: 2, log: (m) => messages.push(m) });
    const raws = [];
    for await (const raw of adapter.fetch()) raws.push([raw.externalId, (raw.payload as { listMake: string | null }).listMake]);
    expect(raws).toEqual([
      ["ad00000010", "mercedes-benz"],
      ["ad00000001", null],
      ["ad00000002", null],
      ["ad00000003", null],
    ]);
    expect(site.requested).toContain(listUrl("lada"));
    expect(messages.some((m) => m.includes("no make links"))).toBe(true);
  });

  it("stops with a clear error when the category page has no ads", async () => {
    const site = fakeSite({
      "https://www.quoka.de/robots.txt": "User-agent: *\nAllow: /\n",
      [listUrl(null)]: "<html><body>Wartungsarbeiten</body></html>",
    });
    const adapter = createQuokaAdapter({ fetcher: site.fetcher });
    await expect(async () => {
      for await (const raw of adapter.fetch()) void raw;
    }).rejects.toThrow(/quoka: unexpected page .* no listings found/);
  });
});
