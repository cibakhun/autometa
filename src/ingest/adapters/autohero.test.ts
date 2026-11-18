import { describe, expect, it } from "vitest";
import { PoliteFetcher } from "../http/fetcher";
import { createAutoheroAdapter, modelPages, normalizeAutohero, parseAutoheroPage, SEARCH_URL, SITEMAP_URL, titleFromLabel } from "./autohero";

interface Car {
  id: string;
  slug: string;
  make: string;
  subtitle: string;
  price: string;
  oldPrice?: string;
  specs: string[];
  /** Leave out to test a card whose link has no aria-label. */
  label?: boolean;
}

const uuid = (n: number) => `0b5c1c3e-1a2b-4c3d-8e9f-${String(n).padStart(12, "0")}`;

// Shaped like Autohero's cards: the link carries an aria-label with title and price, the card a
// saving, the price, the crossed-out old price, the facts and a monthly rate.
const cardHtml = (car: Car) => `
  <div class="cardWrapper___a1">
    <a class="card___b2" href="/de/${car.slug}/id/${car.id}/"${car.label === false ? "" : ` aria-label="${car.make} - ${car.subtitle} - ${car.price}"`}>
      <img src="https://img.autohero.com/img/abc/400x300.jpg" alt="">
      ${car.oldPrice ? `<p class="text___UvZz3">Spare 2.450 €</p>` : ""}
      <h2 class="title___SL5Yb adTitle___MuOmz" data-qa-selector="title">${car.make}</h2>
      <div class="price___GXOg8 withDownPrice___tlRFA">
        <div class="title___SL5Yb price___GXOg8" data-qa-selector="price">${car.price}</div>
        <h3 class="subtitle___NuwtE" data-qa-selector="subtitle">${car.subtitle}</h3>
        ${car.oldPrice ? `<span class="crossedPrice___GdFkK" data-qa-selector="old-price">${car.oldPrice}</span>` : ""}
      </div>
      <ul>${car.specs.map((spec) => `<li><span class="specDot___hHdxw">•</span><span class="specValue___T9Rmz">${spec}</span></li>`).join("")}</ul>
      <b>264 € mtl.</b>
    </a>
  </div>`;

const page = (cars: Car[]) =>
  `<html><body><nav><a href="/de/search/">Alle Autos</a><a href="/de/auto/volkswagen-passat/">Passat</a></nav>${cars.map(cardHtml).join("")}</body></html>`;

const passat: Car = {
  id: uuid(1),
  slug: "volkswagen-passat",
  make: "Volkswagen Passat",
  subtitle: "1.5 TSI ACT Business",
  price: "18.860 €",
  oldPrice: "21.310 €",
  specs: ["2022", "Benzin", "77.865 km", "Automatikgetriebe", "146 g CO2/km (komb.)", "5.3 l/100 km (komb.)"],
};
const fiesta: Car = {
  id: uuid(2),
  slug: "ford-fiesta",
  make: "Ford Fiesta",
  subtitle: "1.0 EcoBoost Titanium",
  price: "11.490 €",
  specs: ["2019", "Benzin", "41.200 km", "Schaltgetriebe"],
  label: false,
};

describe("Autohero pages", () => {
  it("turns the link label into a title", () => {
    expect(titleFromLabel("Volkswagen Passat - 1.4 GTE - 18.430 €")).toBe("Volkswagen Passat 1.4 GTE");
    expect(titleFromLabel("Mazda 6 - 2.0 Sports-Line")).toBe("Mazda 6 2.0 Sports-Line");
    expect(titleFromLabel(null)).toBeNull();
  });

  it("reads the facts of each card and skips savings, old prices and monthly rates", () => {
    const items = parseAutoheroPage(page([passat, fiesta]), SEARCH_URL);
    expect(items).toEqual([
      {
        id: passat.id,
        url: `https://www.autohero.com/de/volkswagen-passat/id/${passat.id}/`,
        title: "Volkswagen Passat 1.5 TSI ACT Business",
        listMake: null,
        price: 18860,
        mileageKm: 77865,
        firstRegistration: "2022",
        powerKw: null,
        fuel: "petrol",
        transmission: "automatic",
        zip: null,
        city: null,
      },
      expect.objectContaining({ id: fiesta.id, title: "Ford Fiesta", price: 11490, mileageKm: 41200, transmission: "manual" }),
    ]);
  });

  it("normalizes a card as an Autohero dealer car without a place", () => {
    const [car] = parseAutoheroPage(page([passat]), SEARCH_URL);
    expect(normalizeAutohero({ externalId: car.id, payload: { ...car } })).toMatchObject({
      sourceId: "autohero",
      makeSlug: "volkswagen",
      modelSlug: "passat",
      priceEur: 18860,
      firstRegistration: "2022-01-01",
      sellerType: "dealer",
      sellerName: "Autohero",
      zip: null,
    });
    expect(normalizeAutohero({ externalId: "x", payload: { ...car, mileageKm: null, firstRegistration: null } })).toBeNull();
  });

  it("takes only the model pages from the sitemap", () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://www.autohero.com/de/auto/volkswagen-passat-kombi/</loc></url>
      <url><loc>https://www.autohero.com/de/auto/bmw/</loc></url>
      <url><loc>https://www.autohero.com/de/standorte/berlin/</loc></url>
      <url><loc>https://www.autohero.com/de/auto/volkswagen-passat-kombi/standorte/berlin/</loc></url>
      <url><loc>https://example.com/de/auto/bmw/</loc></url>
    </urlset>`;
    expect(modelPages(xml)).toEqual(["https://www.autohero.com/de/auto/volkswagen-passat-kombi/", "https://www.autohero.com/de/auto/bmw/"]);
  });
});

describe("Autohero adapter", () => {
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
  const modelUrl = (slug: string) => `https://www.autohero.com/de/auto/${slug}/`;
  const sitemap = (slugs: string[]) => `<urlset>${slugs.map((slug) => `<url><loc>${modelUrl(slug)}</loc></url>`).join("")}</urlset>`;
  const car = (n: number): Car => ({ ...fiesta, id: uuid(n) });

  it("reads the search page, then this hour's share of the model pages", async () => {
    const site = fakeSite({
      "https://www.autohero.com/robots.txt": "User-agent: *\nDisallow: /de/checkout/\n",
      [SEARCH_URL]: page([car(1), car(2)]),
      [SITEMAP_URL]: sitemap(["a", "b", "c"]),
      [modelUrl("a")]: page([car(10)]),
      [modelUrl("b")]: page([car(20)]),
      [modelUrl("c")]: page([car(2), car(30)]),
    });
    // Hour 1 with 2 pages per run starts at the third page and wraps around.
    const adapter = createAutoheroAdapter({ fetcher: site.fetcher, pagesPerRun: 2, now: () => 3_600_000 });
    const ids = [];
    for await (const raw of adapter.fetch()) ids.push(raw.externalId);
    expect(ids).toEqual([uuid(1), uuid(2), uuid(30), uuid(10)]);
    expect(site.requested).not.toContain(modelUrl("b"));
  });

  it("stops with a clear error when the search page has no cars", async () => {
    const site = fakeSite({
      "https://www.autohero.com/robots.txt": "User-agent: *\nAllow: /\n",
      [SEARCH_URL]: "<html><body>Wartungsarbeiten</body></html>",
    });
    const adapter = createAutoheroAdapter({ fetcher: site.fetcher });
    await expect(async () => {
      for await (const raw of adapter.fetch()) void raw;
    }).rejects.toThrow(/autohero: unexpected page .* no listings found/);
  });
});
