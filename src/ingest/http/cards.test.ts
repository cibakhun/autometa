import { describe, expect, it } from "vitest";
import { cardFacts, parseEuro, readCards, readJsonLd, tokens, type TextPiece } from "./cards";

const plain = (...texts: string[]): TextPiece[] => texts.map((text) => ({ text, struck: false }));
const NOW = new Date("2026-11-18T12:00:00Z");

describe("reading prices", () => {
  it("understands the usual ways portals write them", () => {
    expect(parseEuro("12.990 €")).toBe(12990);
    expect(parseEuro("21 990 EUR")).toBe(21990);
    expect(parseEuro("21 990 €")).toBe(21990);
    expect(parseEuro("15550.0 EUR")).toBe(15550);
    expect(parseEuro("1.234,50 €")).toBe(1234);
    expect(parseEuro("8.500 € VB")).toBe(8500);
    expect(parseEuro("990 Euro")).toBe(990);
    expect(parseEuro("122 € mtl.")).toBeNull();
    expect(parseEuro("ab 199 €")).toBeNull();
  });
});

describe("splitting card texts", () => {
  it("splits combined facts", () => {
    expect(tokens(plain("2018 | diesel | 96020 km", "10.000 km·10/2025", "15550.0 EUR 15990.0 EUR")).map((t) => t.text)).toEqual([
      "2018",
      "diesel",
      "96020 km",
      "10.000 km",
      "10/2025",
      "15550.0 EUR",
      "15990.0 EUR",
    ]);
  });
});

describe("facts from a card", () => {
  it("reads a classified ad: year, fuel, mileage, place and price", () => {
    const facts = cardFacts(
      plain(
        "VW Tiguan Allspace 2.0 TDI 190 PS DSG",
        "2018 | diesel | 96020 km",
        "94351 Feldkirchen Niederbay, Bayern",
        "15 November",
        "21 990 EUR",
        "Verifizierte Telefonnummer",
      ),
      NOW,
    );
    expect(facts).toEqual({
      price: 21990,
      mileageKm: 96020,
      firstRegistration: "2018",
      powerKw: null,
      fuel: "diesel",
      transmission: null,
      zip: "94351",
      city: "Feldkirchen Niederbay",
    });
  });

  it("skips savings, monthly rates and crossed-out old prices", () => {
    const pieces: TextPiece[] = [
      ...plain("Spare 1.340 €", "Ford Fiesta", "9.010 €", "1.1 Ti-VCT Cool&Connect"),
      { text: "10.350 €", struck: true },
      ...plain("2020", "Benzin", "74.477 km", "126 € mtl.", "Schaltgetriebe", "125 g CO2/km (komb.)"),
    ];
    expect(cardFacts(pieces, NOW)).toMatchObject({
      price: 9010,
      mileageKm: 74477,
      firstRegistration: "2020",
      fuel: "petrol",
      transmission: "manual",
    });
  });

  it("picks the purchase price among financing offers", () => {
    const facts = cardFacts(
      plain(
        "Volkswagen Golf VIII 1.5 eHybrid Style",
        "0 €",
        "Anzahlung",
        "331 €/mtl.",
        "Finanzierung",
        "447 €",
        "mtl. Leasing",
        "35.548 €",
        "Kaufen",
        "10 km·11/2025",
        "204 PS",
        "Hybrid",
        "Automatik",
      ),
      NOW,
    );
    expect(facts).toMatchObject({
      price: 35548,
      mileageKm: 10,
      firstRegistration: "11/2025",
      powerKw: 150,
      fuel: "hybrid",
      transmission: "automatic",
      zip: null,
    });
  });

  it("does not take a year from the future or a phone-like number", () => {
    expect(cardFacts(plain("2031", "1999 €"), NOW)).toMatchObject({ firstRegistration: null, price: 1999 });
  });
});

describe("cards of a result list", () => {
  const html = `
    <html><body><header><a href="/de/auto/">Marken</a></header>
    <ul class="results">
      <li class="x1"><div><a href="/de/ford-fiesta/id/a5adb0a0-7bd7-4b1f-93e3-993ad3eb13f7/"><img alt=""></a></div>
        <div><h2><a href="/de/ford-fiesta/id/a5adb0a0-7bd7-4b1f-93e3-993ad3eb13f7/">Ford Fiesta</a></h2>
        <span>8.710 €</span><s>9.990 €</s><span>2019</span><span>107.693 km</span>
        <script>window.x = "99.999 €"</script><button>Favorit</button></div></li>
      <li class="x1"><a href="/de/audi-q-2/id/0947f87d-e603-4974-a56b-418765cf28a3/" title="Audi Q2 30 TFSI">
        <span class="price price--old">15.000 €</span><span>14.110 €</span><span>2018 | Benzin | 96.699 km</span></a></li>
    </ul>
    <footer><a href="/de/ford-fiesta/id/not-a-uuid/">x</a></footer></body></html>`;
  const detail = (url: URL) => url.pathname.match(/^\/de\/[a-z0-9-]+\/id\/([0-9a-f-]{36})\/$/)?.[1] ?? null;

  it("finds one card per listing with its own texts only", () => {
    const cards = readCards(html, "https://www.autohero.com/de/search/", detail);
    expect(cards.map((c) => [c.id, c.url, c.title])).toEqual([
      ["a5adb0a0-7bd7-4b1f-93e3-993ad3eb13f7", "https://www.autohero.com/de/ford-fiesta/id/a5adb0a0-7bd7-4b1f-93e3-993ad3eb13f7/", "Ford Fiesta"],
      ["0947f87d-e603-4974-a56b-418765cf28a3", "https://www.autohero.com/de/audi-q-2/id/0947f87d-e603-4974-a56b-418765cf28a3/", "Audi Q2 30 TFSI"],
    ]);
    expect(cards[0].pieces).toEqual([
      { text: "Ford Fiesta", struck: false },
      { text: "8.710 €", struck: false },
      { text: "9.990 €", struck: true },
      { text: "2019", struck: false },
      { text: "107.693 km", struck: false },
    ]);
    expect(cardFacts(cards[1].pieces, NOW)).toMatchObject({ price: 14110, mileageKm: 96699, fuel: "petrol", firstRegistration: "2018" });
  });

  it("takes the first photo of a card, skipping icons, badges and placeholders", () => {
    const detail = (url: URL) => url.pathname.match(/^\/x\/(\d+)$/)?.[1] ?? null;
    const card = (inner: string) => readCards(`<div><a href="/x/1">Golf</a>${inner}<span>5.000 €</span></div>`, "https://www.a.example/list/", detail)[0].image;
    expect(card(`<img src="/icons/heart.svg"><img src="/badge.png" width="18" height="18"><img src="data:image/gif;base64,R0lGOD"><img src="/p/1.jpg" width="200">`)).toBe(
      "https://www.a.example/p/1.jpg",
    );
    expect(card(`<img src="data:image/gif;base64,R0lGOD" data-src="https://img.a.example/1.webp">`)).toBe("https://img.a.example/1.webp");
    expect(card(`<picture><source srcset="https://img.a.example/1.avif 1x, https://img.a.example/1@2.avif 2x"><img></picture>`)).toBe(
      "https://img.a.example/1.avif",
    );
    expect(card(`<img src="javascript:alert(1)">`)).toBeNull();
    expect(card("")).toBeNull();
  });

  it("uses the link's title when it has no text", () => {
    const cards = readCards(`<div><a href="/x/1" title="BMW 320d"><img></a><span>5.000 €</span></div><div><a href="/x/2">Opel</a></div>`, "https://a.example/", (url) => url.pathname.match(/^\/x\/(\d+)$/)?.[1] ?? null);
    expect(cards[0]).toMatchObject({ id: "1", title: "BMW 320d" });
    expect(cards[0].pieces).toEqual(plain("5.000 €"));
  });
});

describe("JSON-LD", () => {
  it("unpacks graphs and item lists and ignores broken blocks", () => {
    const html = `
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","itemListElement":[{"@type":"ListItem","position":1,"item":{"@type":"Car","name":"VW Golf"}}]}</script>
      <script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":"Car","name":"BMW 320d"}]}</script>
      <script type="application/ld+json">{broken</script>`;
    const cars = readJsonLd(html).filter((o) => o["@type"] === "Car").map((o) => o.name);
    expect(cars).toEqual(["VW Golf", "BMW 320d"]);
  });
});
