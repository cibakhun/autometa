import { describe, expect, it } from "vitest";
import type { RawListing } from "../adapter";
import { PoliteFetcher } from "../http/fetcher";
import {
  createKleinanzeigenAdapter,
  firstPageUrl,
  normalizeKleinanzeigen,
  pageUrl,
  parseKleinanzeigenPage,
  type KleinanzeigenItem,
} from "./kleinanzeigen";

interface Ad {
  id: string;
  title: string;
  price?: string;
  place?: string;
  mileage?: string;
  registration?: string;
}

/** A result list entry shaped like Kleinanzeigen's markup (synthetic values). */
function article({ id, title, price = "12.500 € VB", place = "10115 Berlin", mileage = "85.000 km", registration = "EZ 03/2017" }: Ad) {
  return `
  <li class="ad-listitem">
    <article class="aditem" data-adid="${id}" data-href="/s-anzeige/${title.toLowerCase().replace(/\W+/g, "-")}/${id}-216-3331">
      <div class="aditem-image"><img src="https://img.example/${id}.jpg" alt="${title}"></div>
      <div class="aditem-main">
        <div class="aditem-main--top">
          <div class="aditem-main--top--left"><i class="icon icon-small icon-pin-gray"></i> ${place}</div>
          <div class="aditem-main--top--right"><i class="icon icon-small icon-calendar-open"></i> Heute, 14:03</div>
        </div>
        <div class="aditem-main--middle">
          <h2 class="text-module-begin"><a class="ellipsis" href="/s-anzeige/x/${id}-216-3331">${title}</a></h2>
          <p class="aditem-main--middle--description">Verkaufe mein Auto, Tel. 0170 1234567, Erika</p>
          <div class="aditem-main--middle--price-shipping">
            <p class="aditem-main--middle--price-shipping--price">${price}</p>
          </div>
        </div>
        <div class="aditem-main--bottom">
          <p class="text-module-end">
            <span class="simpletag">${mileage}</span>
            <span class="simpletag">${registration}</span>
          </p>
        </div>
      </div>
    </article>
  </li>`;
}

const page = (ads: Ad[]) => `<!DOCTYPE html><html><body><ul id="srchrslt-adtable">${ads.map(article).join("")}</ul></body></html>`;

describe("parseKleinanzeigenPage", () => {
  it("reads facts only: no description, photo or contact", () => {
    const items = parseKleinanzeigenPage(page([{ id: "2712345678", title: "VW Golf 7 1.4 TSI DSG Highline" }]), "volkswagen");
    expect(items).toEqual<KleinanzeigenItem[]>([
      {
        id: "2712345678",
        url: "https://www.kleinanzeigen.de/s-anzeige/vw-golf-7-1-4-tsi-dsg-highline/2712345678-216-3331",
        title: "VW Golf 7 1.4 TSI DSG Highline",
        price: "12.500 € VB",
        mileage: "85.000 km",
        firstRegistration: "03/2017",
        zip: "10115",
        city: "Berlin",
        listMake: "volkswagen",
      },
    ]);
    expect(JSON.stringify(items)).not.toMatch(/Verkaufe|0170|img\.example/);
  });

  it("decodes entities and copes with missing facts", () => {
    const [item] = parseKleinanzeigenPage(page([{ id: "1", title: "Opel Corsa &amp; Winterr&auml;der", price: "VB", mileage: "", registration: "" }]));
    expect(item).toMatchObject({ title: "Opel Corsa & Winterräder", price: "VB", mileage: null, firstRegistration: null, listMake: null });
  });

  it("returns nothing for a page without result entries", () => {
    expect(parseKleinanzeigenPage("<html><body>Keine Ergebnisse</body></html>")).toEqual([]);
  });
});

describe("normalizeKleinanzeigen", () => {
  const normalize = (ad: Partial<Ad>, listMake: string | null = null) => {
    const [item] = parseKleinanzeigenPage(page([{ id: "1", title: "VW Golf", ...ad }]), listMake);
    const raw: RawListing = { externalId: item.id, payload: item as unknown as Record<string, unknown> };
    return normalizeKleinanzeigen(raw);
  };

  it("reads make, model and details from the title", () => {
    expect(normalize({ title: "VW Golf 7 2.0 TDI DSG Variant 110 kW" }, "volkswagen")).toMatchObject({
      sourceId: "kleinanzeigen",
      makeSlug: "volkswagen",
      modelSlug: "golf",
      priceEur: 12500,
      mileageKm: 85000,
      firstRegistration: "2017-03-01",
      fuel: "diesel",
      transmission: "automatic",
      bodyType: "estate",
      powerKw: 110,
      sellerType: null,
      sellerName: null,
      zip: "10115",
      city: "Berlin",
    });
  });

  it("uses the make of the list when the title does not name it", () => {
    expect(normalize({ title: "Golf 7 Highline" }, "volkswagen")).toMatchObject({ makeSlug: "volkswagen", modelSlug: "golf" });
    expect(normalize({ title: "320d Touring" }, "bmw")).toMatchObject({ makeSlug: "bmw", modelSlug: "3er" });
  });

  it("finds the make in the title in the whole category", () => {
    expect(normalize({ title: "Mercedes Benz C 220 d T-Modell" })).toMatchObject({ makeSlug: "mercedes-benz", modelSlug: "c-klasse" });
  });

  it("skips listings without a price", () => {
    expect(normalize({ price: "VB" })).toBeNull();
    expect(normalize({ price: "Zu verschenken" })).toBeNull();
    expect(normalize({ price: "1 €" })).toBeNull();
  });
});

describe("Kleinanzeigen URLs", () => {
  it("builds the list URLs the way the site links them", () => {
    expect(firstPageUrl(null)).toBe("https://www.kleinanzeigen.de/s-autos/c216");
    expect(pageUrl(null, 2)).toBe("https://www.kleinanzeigen.de/s-autos/seite:2/c216");
    expect(firstPageUrl("mercedes-benz")).toBe("https://www.kleinanzeigen.de/s-autos/mercedes_benz/c216+autos.marke_s:mercedes_benz");
    expect(pageUrl("bmw", 5)).toBe("https://www.kleinanzeigen.de/s-autos/bmw/seite:5/c216+autos.marke_s:bmw");
  });
});

describe("createKleinanzeigenAdapter", () => {
  function fakeSite(routes: Record<string, string>) {
    const requested: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      requested.push(url);
      const body = routes[url];
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
    }) as typeof fetch;
    const fetcher = new PoliteFetcher({ fetchImpl, sleep: async () => undefined, minDelayMs: 0, random: () => 0 });
    return { fetcher, requested };
  }

  const ads = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: String(from + i), title: `BMW 320d ${from + i}` }));

  it("reads the newest pages per make and the whole category, without repeating listings", async () => {
    const site = fakeSite({
      "https://www.kleinanzeigen.de/robots.txt": "User-agent: *\nDisallow: /s-autos/seite:6/\n",
      [pageUrl("bmw", 1)]: page(ads(1, 3)),
      [pageUrl("bmw", 2)]: page(ads(4, 2)),
      // The site repeats the last page when asked for more: the list ends here.
      [pageUrl("bmw", 3)]: page(ads(4, 2)),
      [pageUrl(null, 1)]: page([...ads(1, 2), ...ads(10, 2)]),
      [pageUrl(null, 2)]: page(ads(12, 1)),
      [pageUrl(null, 3)]: page([]),
    });
    const adapter = createKleinanzeigenAdapter({ fetcher: site.fetcher, makes: ["bmw"] });
    const raws: RawListing[] = [];
    for await (const raw of adapter.fetch()) raws.push(raw);

    expect(raws.map((raw) => raw.externalId)).toEqual(["1", "2", "3", "4", "5", "10", "11", "12"]);
    expect((raws[0].payload as unknown as KleinanzeigenItem).listMake).toBe("bmw");
    expect((raws[5].payload as unknown as KleinanzeigenItem).listMake).toBeNull();
    expect(site.requested).not.toContain(pageUrl("bmw", 4));
    expect(adapter.staleAfterDays).toBe(14);
    expect(adapter.fullSnapshot).toBe(false);
  });

  it("never reads past page 5", async () => {
    const routes: Record<string, string> = { "https://www.kleinanzeigen.de/robots.txt": "User-agent: *\nAllow: /\n" };
    for (let n = 1; n <= 7; n += 1) routes[pageUrl(null, n)] = page(ads(n * 10, 2));
    const site = fakeSite(routes);
    const adapter = createKleinanzeigenAdapter({ fetcher: site.fetcher, makes: [], pagesPerList: 9 });
    const raws: RawListing[] = [];
    for await (const raw of adapter.fetch()) raws.push(raw);
    expect(raws).toHaveLength(10);
    expect(site.requested).not.toContain(pageUrl(null, 6));
  });

  it("stops when the first page has no listings: the page layout probably changed", async () => {
    const site = fakeSite({ "https://www.kleinanzeigen.de/robots.txt": "", [pageUrl("bmw", 1)]: "<html><body>Neues Design</body></html>" });
    const adapter = createKleinanzeigenAdapter({ fetcher: site.fetcher, makes: ["bmw"] });
    await expect(async () => {
      for await (const raw of adapter.fetch()) void raw;
    }).rejects.toThrow(/did the page change/);
  });
});
