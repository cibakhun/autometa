import { describe, expect, it } from "vitest";
import type { RawListing } from "../adapter";
import { PoliteFetcher } from "../http/fetcher";
import {
  createKleinanzeigenAdapter,
  firstPageUrl,
  giveawayPageUrl,
  kleinanzeigenFacts,
  kleinanzeigenVehicleFacts,
  normalizeKleinanzeigen,
  parseMonthYear,
  pageUrl,
  parseKleinanzeigenPage,
  parseKleinanzeigenPrice,
  type KleinanzeigenItem,
} from "./kleinanzeigen";

interface Ad {
  id: string;
  title: string;
  price?: string;
  place?: string;
  mileage?: string;
  registration?: string;
  description?: string;
}

/** A result list entry shaped like Kleinanzeigen's markup (synthetic values). */
function article({
  id,
  title,
  price = "12.500 € VB",
  place = "10115 Berlin",
  mileage = "85.000 km",
  registration = "EZ 03/2017",
  description = "Verkaufe mein Auto, Tel. 0170 1234567, Erika",
}: Ad) {
  return `
  <li class="ad-listitem">
    <article class="aditem" data-adid="${id}" data-href="/s-anzeige/${title.toLowerCase().replace(/\W+/g, "-")}/${id}-216-3331">
      <div class="aditem-image"><img src="https://img.kleinanzeigen.de/api/v1/prod-ads/images/90/${id}?rule=$_2.AUTO&amp;x=1" alt="${title}"></div>
      <div class="aditem-main">
        <div class="aditem-main--top">
          <div class="aditem-main--top--left"><i class="icon icon-small icon-pin-gray"></i> ${place}</div>
          <div class="aditem-main--top--right"><i class="icon icon-small icon-calendar-open"></i> Heute, 14:03</div>
        </div>
        <div class="aditem-main--middle">
          <h2 class="text-module-begin"><a class="ellipsis" href="/s-anzeige/x/${id}-216-3331">${title}</a></h2>
          <p class="aditem-main--middle--description">${description}</p>
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
  it("reads facts only: no description or contact, and the photo as a link", () => {
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
        image: "https://img.kleinanzeigen.de/api/v1/prod-ads/images/90/2712345678?rule=$_2.AUTO&x=1",
      },
    ]);
    expect(JSON.stringify(items)).not.toMatch(/Verkaufe|0170/);
  });

  it("marks a dealer buying up cars by the opening of the description, without keeping the text", () => {
    const items = parseKleinanzeigenPage(
      page([
        { id: "1", title: "Unfallwagen Motorschaden Getriebeschaden", description: "Hallo KFZ Handel Berlin kauft ihr Auto auf. Barzahlung" },
        { id: "2", title: "VW Golf 7", description: "Wir kaufen uns ein größeres Auto, daher verkaufen wir unseren Golf." },
      ]),
    );
    expect(items[0].buyerAd).toBe(true);
    expect(items[1].buyerAd).toBeUndefined();
    expect(JSON.stringify(items)).not.toMatch(/Handel|Barzahlung|größeres/);
    expect(normalizeKleinanzeigen({ externalId: "1", payload: items[0] as unknown as Record<string, unknown> })).toBeNull();
    expect(normalizeKleinanzeigen({ externalId: "2", payload: items[1] as unknown as Record<string, unknown> })).not.toBeNull();
  });

  it("leaves out the buyer ad of the live site by its title", () => {
    const [item] = parseKleinanzeigenPage(
      page([{ id: "3", title: "Autoankauf Unfallautos Ankauf Kfz Ankauf Wohnmobil Ankauf SUV", price: "2.000 € VB", mileage: "99.999 km" }]),
      "renault",
    );
    expect(normalizeKleinanzeigen({ externalId: "3", payload: item as unknown as Record<string, unknown> })).toBeNull();
  });

  it("never takes the place from the seller's description", () => {
    const html = page([{ id: "1", title: "VW Golf", place: "" }]).replace(
      "Verkaufe mein Auto, Tel. 0170 1234567, Erika",
      "</p><p class=\"aditem-main--middle--description\">10115 Erika Musterfrau",
    );
    expect(parseKleinanzeigenPage(html)[0]).toMatchObject({ zip: null, city: null });
    expect(parseKleinanzeigenPage(page([{ id: "2", title: "VW Golf", place: "10115 Tel 0170 1234567" }]))[0]).toMatchObject({ zip: null });
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
      imageUrl: "https://img.kleinanzeigen.de/api/v1/prod-ads/images/90/1?rule=$_2.AUTO&x=1",
    });
  });

  it("keeps the photo link only for Kleinanzeigen's image server", () => {
    const [item] = parseKleinanzeigenPage(page([{ id: "1", title: "VW Golf" }]));
    const raw = (image: string | null): RawListing => ({ externalId: "1", payload: { ...item, image } });
    expect(normalizeKleinanzeigen(raw("https://evil.example/kleinanzeigen.de.jpg"))?.imageUrl).toBeNull();
    expect(normalizeKleinanzeigen(raw(null))?.imageUrl).toBeNull();
    const html = page([{ id: "2", title: "VW Polo" }]).replace(/<img [^>]*>/, "");
    expect(parseKleinanzeigenPage(html)[0].image).toBeNull();
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
    expect(normalize({ price: "1 €" })).toBeNull();
  });

  it("keeps cars that are given away, at 0 €", () => {
    expect(normalize({ title: "Opel Corsa C für Bastler", price: "Zu verschenken" })).toMatchObject({ priceEur: 0, makeSlug: "opel", modelSlug: "corsa" });
    expect(normalize({ title: "Suche Auto zum Verschenken", price: "Zu verschenken" })).toBeNull();
  });

  // Titles of real "Zu verschenken" ads in the car category.
  it.each([
    "VW Polo 1.2 zu verschenken",
    "Fiat Punto Typ 188 zu verschenken",
    "VW Beetle Unfall ohne Motor/Getriebe zu verschenken",
    "VW Polo aus Erstbesitz, 3-Türer",
    "VW Polo mit Winterreifen zu verschenken",
    "VW Polo 1.2 – neuer Besitzer gesucht",
  ])(
    "keeps the car given away: %s",
    (title) => expect(normalize({ title, price: "Zu verschenken" })).toMatchObject({ priceEur: 0 }),
  );

  it.each([
    "Opel Corsa D Stahlfelgen zu verschenken",
    "Hutablage Opel Corsa C zu verschenken",
    "Winterreifen Opel Astra zu verschenken",
    "Opel Tigra A Fahrertür",
    "VW Polo Stoßstangen zu verschenken",
    "VW Polo Winterreifen zu verschenken",
    "VW Polo gesucht",
    "Maxi-Cosi Autositz für VW Golf",
    "Mustang 64 1/2 - 1973 Kabelpläne ZU VERSCHENKEN",
    "Zum verschenken Fahrzeug für Feuerwehr gesucht",
    "Auto zu Verschenken",
    "reifen zu verschenken",
  ])("drops what is given away but no car we can name: %s", (title) => expect(normalize({ title, price: "Zu verschenken" })).toBeNull());

  it("judges only giveaways by the part words", () => {
    expect(normalize({ title: "Opel Corsa D mit neuen Winterreifen", price: "2.500 €" })).toMatchObject({ priceEur: 2500 });
  });

  // Live listings that offered no car for sale.
  it.each<[string, string, string]>([
    ["Suchen Golf 3 1,8 75PS /90PS für Bastler", "200 €", "volkswagen"],
    ["Suchen Opel Astra F oder G als Teilespender", "250 €", "opel"],
    ["AMG GT Coupe 2 Türer ab 2015 *Suche*", "1.234 €", "mercedes-benz"],
    ["iphone 18 pro max weschel gegen eine transporter", "100 €", "mercedes-benz"],
  ])("drops %s", (title, price, listMake) => expect(normalize({ title, price, mileage: "0 km", registration: "EZ 01/2026" }, listMake)).toBeNull());

  it("leaves a first registration that cannot be right unknown", () => {
    // 997.1 was built until 2008; the seller typed a later registration.
    expect(normalize({ title: "Porsche 911 Carrera 4s 997.1", price: "42.900 €", registration: "EZ 08/2025" }, "porsche")).toMatchObject({
      modelSlug: "911",
      firstRegistration: null,
      firstRegistrationYearOnly: false,
    });
    expect(normalize({ title: "Renault 19 – Bastlerfahrzeug / Ersatzteilspender", price: "350 €", registration: "EZ 08/2019" }, "renault")).toMatchObject({
      modelSlug: "19",
      firstRegistration: null,
    });
    expect(normalize({ title: "VW Golf", registration: "EZ 01/2099" })?.firstRegistration).toBeNull();
  });

  it("reads 0 km on an old car as unknown", () => {
    expect(normalize({ title: "Opel Corsa A GSI", price: "6.500 €", mileage: "0 km", registration: "EZ 05/1984" }, "opel")).toMatchObject({
      mileageKm: null,
      firstRegistration: "1984-05-01",
    });
  });

  it("knows the MINI One apart from the Cooper", () => {
    expect(normalize({ title: "Mini One Bj.2003 zum Schlachten", price: "700 €", registration: "EZ 06/2003" })).toMatchObject({
      makeSlug: "mini",
      modelSlug: "one",
    });
  });
});

describe("Kleinanzeigen URLs", () => {
  it("builds the list URLs the way the site links them", () => {
    expect(firstPageUrl(null)).toBe("https://www.kleinanzeigen.de/s-autos/c216");
    expect(pageUrl(null, 2)).toBe("https://www.kleinanzeigen.de/s-autos/seite:2/c216");
    expect(firstPageUrl("mercedes-benz")).toBe("https://www.kleinanzeigen.de/s-autos/mercedes_benz/c216+autos.marke_s:mercedes_benz");
    expect(pageUrl("bmw", 5)).toBe("https://www.kleinanzeigen.de/s-autos/bmw/seite:5/c216+autos.marke_s:bmw");
    expect(giveawayPageUrl(1)).toBe("https://www.kleinanzeigen.de/s-autos/verschenken/k0c216");
    expect(giveawayPageUrl(2)).toBe("https://www.kleinanzeigen.de/s-autos/seite:2/verschenken/k0c216");
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
    expect(adapter.staleAfterDays).toBe(2);
    expect(adapter.fullSnapshot).toBe(false);
  });

  it("searches the car category for cars given away, after the makes and before the whole category", async () => {
    const site = fakeSite({
      "https://www.kleinanzeigen.de/robots.txt": "",
      [pageUrl("bmw", 1)]: page(ads(1, 2)),
      [giveawayPageUrl(1)]: page([{ id: "2", title: "BMW 320d 2" }, { id: "30", title: "VW Polo 1.2 zu verschenken", price: "Zu verschenken" }]),
      [pageUrl(null, 1)]: page([...ads(30, 1), ...ads(40, 1)]),
    });
    const adapter = createKleinanzeigenAdapter({ fetcher: site.fetcher, makes: ["bmw"] });
    const raws: RawListing[] = [];
    for await (const raw of adapter.fetch()) raws.push(raw);

    expect(raws.map((raw) => raw.externalId)).toEqual(["1", "2", "30", "40"]);
    expect(adapter.normalize(raws[2])).toMatchObject({ priceEur: 0, makeSlug: "volkswagen", modelSlug: "polo" });
    const order = [pageUrl("bmw", 1), giveawayPageUrl(1), pageUrl(null, 1)].map((url) => site.requested.indexOf(url));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order).not.toContain(-1);
  });

  it("goes on to the whole category when the search finds nothing", async () => {
    const site = fakeSite({
      "https://www.kleinanzeigen.de/robots.txt": "",
      [giveawayPageUrl(1)]: page([]),
      [pageUrl(null, 1)]: page(ads(1, 2)),
    });
    const adapter = createKleinanzeigenAdapter({ fetcher: site.fetcher, makes: [] });
    const raws: RawListing[] = [];
    for await (const raw of adapter.fetch()) raws.push(raw);
    expect(raws.map((raw) => raw.externalId)).toEqual(["1", "2"]);
    expect(site.requested).toContain(giveawayPageUrl(1));
  });

  it("keeps the last request of the budget for the whole category", async () => {
    const routes = {
      "https://www.kleinanzeigen.de/robots.txt": "",
      [pageUrl("bmw", 1)]: page(ads(1, 2)),
      [giveawayPageUrl(1)]: page(ads(20, 1)),
      [pageUrl(null, 1)]: page(ads(30, 1)),
    };
    const site = fakeSite(routes);
    // robots.txt, the BMW page and its repeat leave one request.
    const fetcher = new PoliteFetcher({
      fetchImpl: (async (input: string | URL) => {
        const url = String(input);
        site.requested.push(url);
        const body = url === pageUrl("bmw", 2) ? routes[pageUrl("bmw", 1)] : routes[url];
        return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
      }) as typeof fetch,
      sleep: async () => undefined,
      minDelayMs: 0,
      random: () => 0,
      maxRequests: 4,
    });
    const adapter = createKleinanzeigenAdapter({ fetcher, makes: ["bmw"] });
    const raws: RawListing[] = [];
    for await (const raw of adapter.fetch()) raws.push(raw);
    expect(site.requested).not.toContain(giveawayPageUrl(1));
    expect(raws.map((raw) => raw.externalId)).toEqual(["1", "2", "30"]);
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

  it("reads the whole category on even when its first page holds only listings already found", async () => {
    const site = fakeSite({
      "https://www.kleinanzeigen.de/robots.txt": "",
      [pageUrl("bmw", 1)]: page(ads(1, 2)),
      [pageUrl(null, 1)]: page(ads(1, 2)),
      [pageUrl(null, 2)]: page(ads(20, 2)),
    });
    const adapter = createKleinanzeigenAdapter({ fetcher: site.fetcher, makes: ["bmw"] });
    const raws: RawListing[] = [];
    for await (const raw of adapter.fetch()) raws.push(raw);
    expect(raws.map((raw) => raw.externalId)).toEqual(["1", "2", "20", "21"]);
  });

  it("goes on after a make without listings", async () => {
    const site = fakeSite({
      "https://www.kleinanzeigen.de/robots.txt": "",
      [pageUrl("abarth", 1)]: page([]),
      [pageUrl(null, 1)]: page(ads(1, 2)),
    });
    const adapter = createKleinanzeigenAdapter({ fetcher: site.fetcher, makes: ["abarth"] });
    const raws: RawListing[] = [];
    for await (const raw of adapter.fetch()) raws.push(raw);
    expect(raws).toHaveLength(2);
  });

  it("stops when the whole category has no listings: the page layout probably changed", async () => {
    const empty = "<html><body>Neues Design</body></html>";
    const site = fakeSite({ "https://www.kleinanzeigen.de/robots.txt": "", [pageUrl("bmw", 1)]: empty, [pageUrl(null, 1)]: empty });
    const adapter = createKleinanzeigenAdapter({ fetcher: site.fetcher, makes: ["bmw"] });
    await expect(async () => {
      for await (const raw of adapter.fetch()) void raw;
    }).rejects.toThrow(/did the page change/);
  });
});

describe("the facts on a Kleinanzeigen ad page", () => {
  const NOW = Date.parse("2026-11-23T22:00:00Z");
  const url = "https://www.kleinanzeigen.de/s-anzeige/bmw-320d/1-216-3331";
  const facts = (body: string, now = NOW) => kleinanzeigenFacts({ url, status: 200, text: `<html><body><h1>BMW 320d</h1>${body}</body></html>` }, now);
  const boxes = (price: string, day = "18.11.2026") =>
    `<h2 class="boxedarticle--price" id="viewad-price">\n   ${price}\n </h2>
     <div id="viewad-extra-info" class="boxedarticle--details--full">
       <div><i class="icon icon-small icon-calendar-gray-simple"></i><span>${day}</span></div>
       <div><i class="icon icon-small icon-eye-gray-simple"></i><span id="viewad-cntr-num"></span></div>
     </div>`;

  it("reads the price and the day the ad was put online", () => {
    expect(facts(boxes("6.500 € VB"))).toEqual({ priceEur: 6500, listedOn: "2026-11-18" });
    expect(facts(boxes("12.000&nbsp;&euro;"))).toEqual({ priceEur: 12000, listedOn: "2026-11-18" });
    expect(facts(boxes("Zu verschenken"))).toEqual({ priceEur: 0, listedOn: "2026-11-18" });
  });

  it("reads the price now, not the one struck through", () => {
    expect(facts(boxes(`<span class="boxedarticle--old-price"><s>7.000 €</s></span> 6.500 € VB`)).priceEur).toBe(6500);
    expect(facts(boxes(`<del>7.000 €</del> 6.500 €`)).priceEur).toBe(6500);
  });

  it("tells a dealer buying up cars by the opening of the description, and keeps nothing of it", () => {
    const description = `<p id="viewad-description-text" itemprop="description">Hallo<br><br>KFZ Handel Berlin kauft ihr Auto auf.<br><br>wir kaufen Gebrauchtwagen</p>`;
    const ref = (title: string) => ({ externalId: "1", url, priceEur: 2000, title });
    const page = { url, status: 200, text: `<html><body>${boxes("2.000 € VB")}${description}</body></html>` };
    expect(kleinanzeigenFacts(page, NOW, ref("Unfallwagen Motorschaden Getriebeschaden"))).toEqual({
      priceEur: 2000,
      listedOn: "2026-11-18",
      notForSale: true,
    });
    // A title naming a car keeps the listing; without the stored title nothing is judged.
    expect(kleinanzeigenFacts(page, NOW, ref("Renault Clio 1.2")).notForSale).toBeUndefined();
    expect(kleinanzeigenFacts(page, NOW).notForSale).toBeUndefined();
  });

  it("leaves out what is not shown in the expected form", () => {
    expect(facts(boxes("VB"))).toEqual({ listedOn: "2026-11-18" });
    expect(facts(boxes("1 € VB"))).toEqual({ listedOn: "2026-11-18" });
    expect(facts(boxes("6.500 € VB", "31.02.2026"))).toEqual({ priceEur: 6500 });
    // Not after today in Germany; the next day starts at 23:00 UTC in winter.
    expect(facts(boxes("6.500 €", "24.11.2026"))).toEqual({ priceEur: 6500 });
    expect(facts(boxes("6.500 €", "24.11.2026"), Date.parse("2026-11-23T23:30:00Z"))).toEqual({ priceEur: 6500, listedOn: "2026-11-24" });
    expect(facts("<p>Preis: 6.500 €</p><p>Eingestellt am 18.11.2026</p>")).toEqual({});
  });

  it("takes no date from the seller's text", () => {
    const page = `<h2 id="viewad-price">6.500 €</h2>
      <div id="viewad-extra-info"><div><span id="viewad-cntr-num"></span></div></div>
      <p id="viewad-description-text" itemprop="description">TÜV neu seit 01.10.2026</p>`;
    expect(facts(page)).toEqual({ priceEur: 6500 });
  });

  it("reads the vehicle facts of the details box and whether the seller is a dealer", () => {
    // Shaped like the live page (checked 2026-11-26), with synthetic values.
    const detail = (label: string, value: string) =>
      `<li class="addetailslist--detail">\n  ${label}<span class="addetailslist--detail--value">\n   ${value}</span>\n</li>`;
    const details = (...lines: [string, string][]) =>
      `<div class="splitlinebox l-container-row" id="viewad-details"><div class="addetailslist"><ul class="addetailslist--split">${lines
        .map(([label, value]) => detail(label, value))
        .join("")}</ul></div></div>`;
    const seller = (kind: string) =>
      `<span class="userprofile-vip-details text-body-regular text-light"><i class="icon icon-small icon-meins-gray"></i> <span class="userprofile-vip-details-text">${kind}</span></span>
       <span class="userprofile-vip-details text-body-regular text-light"><span class="userprofile-vip-details-text">Aktiv seit 19.01.2017</span></span>`;
    const page = details(
      ["Marke", "BMW"],
      ["Kilometerstand", "222.000 km"],
      ["Fahrzeugzustand", "Unbeschädigtes Fahrzeug"],
      ["Erstzulassung", "Dezember 2010"],
      ["Kraftstoffart", "Benzin"],
      ["Leistung", "204 PS"],
      ["Getriebe", "Automatik"],
      ["Fahrzeugtyp", "Limousine"],
      ["HU bis", "Juli 2027"],
    );
    expect(facts(boxes("6.500 € VB") + page + seller("Privater Nutzer"))).toEqual({
      priceEur: 6500,
      listedOn: "2026-11-18",
      fuel: "petrol",
      transmission: "automatic",
      powerKw: 150,
      bodyType: "sedan",
      huUntil: "2027-07-01",
      sellerType: "private",
    });
    const dealer = details(["Kraftstoffart", "Diesel"], ["Getriebe", "Manuell"], ["Fahrzeugtyp", "SUV / Gel&auml;ndewagen"], ["Fahrzeugzustand", "Beschädigtes Fahrzeug"]);
    expect(kleinanzeigenVehicleFacts(dealer + seller("Gewerblicher Nutzer"), NOW)).toEqual({
      fuel: "diesel",
      transmission: "manual",
      bodyType: "suv",
      damage: ["defect"],
      sellerType: "dealer",
    });
    expect(kleinanzeigenVehicleFacts(details(["Fahrzeugtyp", "Kombi"], ["Kraftstoffart", "Hybrid (Benzin/Elektro)"]), NOW)).toEqual({ bodyType: "estate", fuel: "hybrid" });
  });

  it("leaves out vehicle facts that say nothing or are not plausible", () => {
    const detail = (label: string, value: string) => `<li class="addetailslist--detail">${label}<span class="addetailslist--detail--value">${value}</span></li>`;
    const read = (...lines: [string, string][]) => kleinanzeigenVehicleFacts(lines.map(([label, value]) => detail(label, value)).join(""), NOW);
    expect(read(["Kraftstoffart", "Andere"], ["Fahrzeugtyp", "Andere"], ["Getriebe", "Bitte wählen"])).toEqual({});
    expect(read(["Leistung", "5 PS"], ["Leistung ", "2000 PS"])).toEqual({});
    expect(read(["HU bis", "Juli 2035"])).toEqual({});
    // The same words in the seller's text are no field.
    expect(kleinanzeigenVehicleFacts(`<p id="viewad-description-text">Kraftstoffart: Diesel, Privater Nutzer</p>`, NOW)).toEqual({});
  });

  it("parses the month and year the details box writes", () => {
    expect(parseMonthYear("Juli 2027", NOW)).toBe("2027-07-01");
    expect(parseMonthYear("März 2026", NOW)).toBe("2026-03-01");
    expect(parseMonthYear("07/2027", NOW)).toBe("2027-07-01");
    expect(parseMonthYear("13/2027", NOW)).toBeNull();
    expect(parseMonthYear("Sommer 2027", NOW)).toBeNull();
    expect(parseMonthYear("Juli 2030", NOW)).toBeNull();
  });

  it("parses prices as the lists write them", () => {
    expect(parseKleinanzeigenPrice("18.500 € VB")).toBe(18500);
    expect(parseKleinanzeigenPrice("950 €")).toBe(950);
    expect(parseKleinanzeigenPrice("Zu verschenken")).toBe(0);
    expect(parseKleinanzeigenPrice("VB")).toBeNull();
    expect(parseKleinanzeigenPrice("ab 5.000 €")).toBeNull();
    expect(parseKleinanzeigenPrice(null)).toBeNull();
  });
});
