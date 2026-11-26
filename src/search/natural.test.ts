import { describe, expect, it } from "vitest";
import { filtersToQuery, parseFilters } from "./filters";
import { naturalSearchParams, parseAmount, parseNaturalSearch, type PlaceLookup } from "./natural";

const NOW = new Date("2026-11-23T12:00:00Z");
const towns: Record<string, { zip: string; city: string }> = {
  "münchen": { zip: "80331", city: "München" },
  "frankfurt am main": { zip: "60311", city: "Frankfurt am Main" },
  "köln": { zip: "50667", city: "Köln" },
};
const findPlace: PlaceLookup = async (name) => towns[name.toLowerCase()] ?? null;
const parse = (text: string) => parseNaturalSearch(text, findPlace, NOW);

/** The query without empty lists, for compact expectations. */
async function query(text: string) {
  const { query } = await parse(text);
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0)));
}

describe("parseAmount", () => {
  it("reads German number formats", () => {
    expect(parseAmount("8.000")).toBe(8000);
    expect(parseAmount("8000")).toBe(8000);
    expect(parseAmount("8k")).toBe(8000);
    expect(parseAmount("8,5 tsd")).toBe(8500);
    expect(parseAmount("150 tausend")).toBe(150_000);
    expect(parseAmount("1.4")).toBe(1.4);
    expect(parseAmount("12.990,")).toBe(12990);
    expect(parseAmount("1.2.3")).toBeNull();
  });
});

describe("parseNaturalSearch", () => {
  it("reads the example: reliable family estate up to 8,000 euros", async () => {
    const result = await parse("zuverlässiger Kombi für Familie bis 8.000 €");
    expect(result.query).toMatchObject({ body: ["estate"], priceMax: 8000, zustand: "intakt", sort: "empfehlung" });
    expect(result.understood.map((item) => item.text)).toEqual(["zuverlässiger", "Kombi", "Familie", "bis 8.000 €"]);
    expect(result.ignored).toEqual([]);
    expect(result.unknown).toEqual([]);
  });

  it("makes a family car an estate, van or SUV when no type is named", async () => {
    expect(await query("Familienauto bis 6000 Euro")).toEqual({ body: ["estate", "van", "suv"], priceMax: 6000, sort: "empfehlung" });
  });

  it("reads make, model, fuel, year and mileage", async () => {
    const result = await parse("VW Golf 7 Diesel ab 2015 unter 150.000 km");
    expect(result.query).toMatchObject({ make: "volkswagen", model: "golf", fuel: ["diesel"], yearMin: 2015, kmMax: 150_000 });
    expect(result.ignored.map((item) => item.text)).toEqual(["7"]);
    expect(result.unknown).toEqual([]);
  });

  it("finds a model without its make, and engine codes", async () => {
    expect(await query("Octavia Combi")).toMatchObject({ make: "skoda", model: "octavia", body: ["estate"] });
    expect(await query("BMW 320d Touring bis 12.000 Euro, max 180tkm")).toMatchObject({
      make: "bmw",
      model: "3er",
      body: ["estate"],
      priceMax: 12_000,
      kmMax: 180_000,
    });
    expect(await query("Mercedes C220 Automatik")).toMatchObject({ make: "mercedes-benz", model: "c-klasse", transmission: "automatic" });
  });

  it("keeps numeric models that follow the make", async () => {
    expect(await query("Peugeot 2008 mit TÜV neu")).toMatchObject({ make: "peugeot", model: "2008", hu: "neu" });
    expect(await query("Fiat 500 Cabrio")).toMatchObject({ make: "fiat", model: "500", body: ["convertible"] });
  });

  it("takes one make and says so for the others", async () => {
    const result = await parse("Octavia oder Passat");
    expect(result.query).toMatchObject({ make: "skoda", model: "octavia" });
    expect(result.ignored).toEqual([{ text: "Passat", reason: "Nur eine Marke je Suche: Škoda genommen." }]);
  });

  it("drops the model when several of one make are named", async () => {
    const result = await parse("Volvo V70 oder XC70");
    expect(result.query.make).toBe("volvo");
    expect(result.query.model).toBeUndefined();
  });

  it("tells prices from years", async () => {
    expect(await query("bis 2000")).toMatchObject({ priceMax: 2000 });
    expect(await query("Golf bis 2015")).toMatchObject({ yearMax: 2015 });
    expect(await query("ab 2015")).toMatchObject({ yearMin: 2015 });
    expect(await query("ab 2000 €")).toMatchObject({ priceMin: 2000 });
    expect(await query("Baujahr bis 2012")).toMatchObject({ yearMax: 2012 });
    expect(await query("vor 2010")).toMatchObject({ yearMax: 2009 });
    expect(await query("BJ 2012-2016")).toMatchObject({ yearMin: 2012, yearMax: 2016 });
    expect(await query("Golf 2015")).toMatchObject({ yearMin: 2015, yearMax: 2015 });
    expect(await query("nicht älter als 8 Jahre")).toMatchObject({ yearMin: 2018 });
  });

  it("reads price ranges, approximations and shorthands", async () => {
    expect(await query("zwischen 6000 und 9000 €")).toMatchObject({ priceMin: 6000, priceMax: 9000 });
    expect(await query("5-8k")).toMatchObject({ priceMin: 5000, priceMax: 8000 });
    expect(await query("ca. 10.000 €")).toMatchObject({ priceMin: 8500, priceMax: 11_500 });
    expect(await query("SUV bis 15k")).toMatchObject({ priceMax: 15_000 });
    expect(await query("ab 3000 Euro")).toMatchObject({ priceMin: 3000 });
    expect(await query("Zu verschenken")).toMatchObject({ priceMax: 0 });
  });

  it("reads power, HU and mileage words", async () => {
    expect(await query("mind. 150 PS")).toMatchObject({ psMin: 150 });
    expect(await query("ab 110 kW")).toMatchObject({ psMin: 150 });
    expect(await query("TÜV 2 Jahre")).toMatchObject({ hu: "neu" });
    expect(await query("TÜV bis 05/2027")).toMatchObject({ hu: "6" });
    expect(await query("mit TÜV")).toMatchObject({ hu: "6" });
    expect(await query("wenig km")).toMatchObject({ kmMax: 100_000 });
  });

  it("reads negations", async () => {
    expect((await parse("kein Diesel")).query.fuel).toEqual(["petrol", "electric", "hybrid", "plugin_hybrid", "lpg", "cng", "hydrogen"]);
    expect(await query("keine Automatik")).toMatchObject({ transmission: "manual" });
    expect(await query("unfallfrei, nicht vom Händler")).toMatchObject({ zustand: "intakt", seller: "private" });
  });

  it("asks for the verdict when the car should be worth it", async () => {
    expect(await query("Golf bis 8000 der sich lohnt")).toMatchObject({ make: "volkswagen", model: "golf", priceMax: 8000, urteil: "anschauen" });
    expect(await query("lohnenswertes Bastlerauto")).toMatchObject({ zustand: "defekt", urteil: "schrauber", sort: "flip" });
  });

  it("sorts flip searches by flip and keeps their margin", async () => {
    expect(await query("Bastlerauto zum Flippen, Marge ab 1.000 €")).toEqual({ zustand: "defekt", margeMin: 1000, sort: "flip" });
    expect(await query("Motorschaden Audi A4 einfach zu reparieren")).toMatchObject({
      make: "audi",
      model: "a4",
      zustand: "defekt",
      schwierigkeit: 2,
      sort: "flip",
    });
  });

  it("sorts plain bargain hunts below market and named sorts as named", async () => {
    expect(await query("günstiger Kleinwagen")).toMatchObject({ body: ["small"], sort: "below_market" });
    expect(await query("Golf, billigste zuerst")).toMatchObject({ sort: "price_asc" });
  });

  it("finds a town or postal code with a radius", async () => {
    expect(await query("Automatik-SUV bis 15.000 € um München")).toMatchObject({ zip: "80331", radius: 50, transmission: "automatic" });
    expect(await query("in der Nähe von Frankfurt am Main im Umkreis von 30 km")).toMatchObject({ zip: "60311", radius: 50 });
    expect(await query("PLZ 01067 Umkreis 100 km")).toMatchObject({ zip: "01067", radius: 100 });
    const vague = await parse("in der Nähe günstig");
    expect(vague.query.zip).toBeUndefined();
    expect(vague.ignored.map((item) => item.text)).toEqual(["in der Nähe"]);
  });

  it("puts trim and equipment words into the title search", async () => {
    expect(await query("Golf GTI mit Standheizung")).toMatchObject({ model: "golf", q: "GTI Standheizung" });
    expect(await query("Octavia RS")).toMatchObject({ q: "RS" });
  });

  it("says what it cannot filter and which words it did not know", async () => {
    const result = await parse("sparsames Auto für meinen Sohn in Rot");
    expect(result.ignored.map((item) => item.text)).toEqual(["sparsames", "Rot"]);
    expect(result.unknown).toEqual(["Sohn"]);
  });

  it("works without a place lookup and with umlauts typed as ae/oe/ue", async () => {
    const result = await parseNaturalSearch("zuverlaessiger Gelaendewagen um Koeln", null, NOW);
    expect(result.query).toMatchObject({ body: ["suv"], zustand: "intakt", sort: "empfehlung" });
    expect(result.query.zip).toBeUndefined();
  });

  it("handles the review cases", async () => {
    expect(parseAmount("8.000,50")).toBe(8000.5);
    expect(await query("Achtsitzer")).toMatchObject({ body: ["van"] });
    expect((await parse("Neunsitzer")).understood[0].label).toMatch(/^9-Sitzer/);
    expect(await query("Familienauto, kein SUV")).toMatchObject({ body: ["estate", "van"] });
    expect(await query("unter 150.500 km")).toMatchObject({ kmMax: 150_500 });
    expect(await query("10000-15000 €")).toEqual({ priceMin: 10_000, priceMax: 15_000, sort: "empfehlung" });
    expect(await query("nicht fahrbereit")).toMatchObject({ zustand: "defekt" });
    expect(await query("fahrbereit")).toMatchObject({ zustand: "intakt" });
    expect(await query("Kombi mit wenig Mängeln")).toMatchObject({ zustand: "intakt", sort: "empfehlung" });
    expect(await query("wenig Mängel")).toMatchObject({ zustand: "intakt" });
    const upkeep = await parse("günstig im Unterhalt");
    expect(upkeep.query.sort).toBe("empfehlung");
    expect(upkeep.ignored.map((item) => item.text)).toEqual(["günstig im Unterhalt"]);
    expect(await query("ab 150 Pferdestärken")).toMatchObject({ psMin: 150 });
    expect(await query("Golf 8.000 €")).toMatchObject({ model: "golf", priceMax: 8000 });
    expect(await query("VW Golf 8.000 €")).toMatchObject({ make: "volkswagen", model: "golf", priceMax: 8000 });
    expect((await query("VW Golf 7 Diesel")).priceMax).toBeUndefined();
    expect(await query("PLZ 80331 bis 8.000 €")).toMatchObject({ zip: "80331", priceMax: 8000 });
    expect((await query("PLZ 80331 bis 8.000 €")).priceMin).toBeUndefined();
    expect(await query("Familie, kein Kombi, kein Van, kein SUV")).toMatchObject({
      body: ["small", "sedan", "coupe", "convertible", "other"],
    });
    const radius = await parse("im Umkreis von 30 km");
    expect(radius.understood).toEqual([]);
    expect(radius.ignored.map((item) => item.text)).toEqual(["im Umkreis von 30 km"]);
    const many = await parse("GTI Standheizung Navi Leder");
    expect(many.query.q).toBe("GTI Standheizung Navi");
    expect(many.ignored.map((item) => item.text)).toEqual(["Leder"]);
  });

  it("gives the search page's query with the text as ki", async () => {
    const text = "zuverlässiger Kombi bis 8.000 €";
    const params = naturalSearchParams(await parse(text), text);
    expect(filtersToQuery(parseFilters(params))).toBe(
      `?priceMax=8000&zustand=intakt&ki=${encodeURIComponent(text).replace(/%20/g, "+")}&sort=empfehlung&body=estate`,
    );
  });
});
