import { describe, expect, it } from "vitest";
import {
  detectBodyType,
  detectFuel,
  detectTransmission,
  findMakeInTitle,
  isNotForSale,
  isPlaceholderModel,
  isYearOnlyRegistration,
  joinWithoutRepeats,
  kwToPs,
  mentionsCar,
  normalizeBodyType,
  normalizeFuel,
  normalizeTransmission,
  parseFirstRegistration,
  parseInteger,
  parsePowerKw,
  resolveMakeModel,
  resolveModelInTitle,
  sourceImageUrl,
} from "./normalize";

describe("parseInteger", () => {
  it.each([
    ["12.990 €", 12990],
    ["123.456 km", 123456],
    ["12990", 12990],
    ["1 234", 1234],
    ["9.999,00 €", 9999],
    [4500, 4500],
  ])("%s -> %s", (input, expected) => {
    expect(parseInteger(input)).toBe(expected);
  });

  it("returns null for empty or non-numeric values", () => {
    expect(parseInteger("")).toBeNull();
    expect(parseInteger("VB")).toBeNull();
    expect(parseInteger(null)).toBeNull();
  });
});

describe("parsePowerKw", () => {
  it("prefers kW and converts PS", () => {
    expect(parsePowerKw("110 kW (150 PS)")).toBe(110);
    expect(parsePowerKw("150 PS")).toBe(110);
    expect(parsePowerKw("85kW")).toBe(85);
    expect(parsePowerKw("stark")).toBeNull();
  });

  it("round-trips PS", () => {
    expect(kwToPs(110)).toBe(150);
  });
});

describe("parseFirstRegistration", () => {
  it.each([
    ["03/2018", "2018-03-01"],
    ["3.2018", "2018-03-01"],
    ["2018-03", "2018-03-01"],
    ["2018", "2018-01-01"],
  ])("%s -> %s", (input, expected) => {
    expect(parseFirstRegistration(input)).toBe(expected);
  });

  it("rejects impossible dates", () => {
    expect(parseFirstRegistration("13/2018")).toBeNull();
    expect(parseFirstRegistration("neu")).toBeNull();
  });
});

describe("isYearOnlyRegistration", () => {
  it("is true only for a bare, valid year", () => {
    expect(isYearOnlyRegistration("2018")).toBe(true);
    expect(isYearOnlyRegistration(" 2018 ")).toBe(true);
    expect(isYearOnlyRegistration("01/2018")).toBe(false);
    expect(isYearOnlyRegistration("2018-01")).toBe(false);
    expect(isYearOnlyRegistration("1850")).toBe(false);
    expect(isYearOnlyRegistration(null)).toBe(false);
  });
});

describe("category normalization", () => {
  it("maps fuel spellings", () => {
    expect(normalizeFuel("Benzin")).toBe("petrol");
    expect(normalizeFuel("Diesel")).toBe("diesel");
    expect(normalizeFuel("Elektro")).toBe("electric");
    expect(normalizeFuel("Hybrid (Benzin/Elektro)")).toBe("hybrid");
    expect(normalizeFuel("Plug-in-Hybrid")).toBe("plugin_hybrid");
    expect(normalizeFuel("Autogas (LPG)")).toBe("lpg");
    expect(normalizeFuel("Erdgas (CNG)")).toBe("cng");
    expect(normalizeFuel("Ethanol")).toBe("other");
  });

  it("maps transmissions", () => {
    expect(normalizeTransmission("Schaltgetriebe")).toBe("manual");
    expect(normalizeTransmission("Automatik")).toBe("automatic");
    expect(normalizeTransmission("7-Gang DSG")).toBe("automatic");
    expect(normalizeTransmission(null)).toBeNull();
  });

  it("maps body types", () => {
    expect(normalizeBodyType("Kombi")).toBe("estate");
    expect(normalizeBodyType("SUV/Geländewagen")).toBe("suv");
    expect(normalizeBodyType("Van/Kleinbus")).toBe("van");
    expect(normalizeBodyType("Kleinwagen")).toBe("small");
    expect(normalizeBodyType("Cabrio/Roadster")).toBe("convertible");
  });
});

describe("resolveMakeModel", () => {
  it.each([
    ["VW", "Golf VII 1.4 TSI", "volkswagen", "golf", "VII 1.4 TSI"],
    ["Volkswagen", "T-Roc 1.5 TSI", "volkswagen", "t-roc", "1.5 TSI"],
    ["Mercedes", "A 180 d Style", "mercedes-benz", "a-klasse", "A 180 d Style"],
    ["Mercedes-Benz", "C-Klasse C 220 d", "mercedes-benz", "c-klasse", "C 220 d"],
    ["BMW", "320d Touring", "bmw", "3er", "320d Touring"],
    ["Škoda", "Octavia Combi 2.0 TDI", "skoda", "octavia", "Combi 2.0 TDI"],
    ["Tesla", "Model 3 Long Range", "tesla", "model-3", "Long Range"],
    ["Mazda", "CX-5 2.0", "mazda", "cx-5", "2.0"],
    ["Peugeot", "2008 PureTech", "peugeot", "2008", "PureTech"],
  ])("%s %s", (make, model, makeSlug, modelSlug, variant) => {
    expect(resolveMakeModel(make, model)).toEqual({ makeSlug, modelSlug, variant });
  });

  it("keeps the make when the model is unknown", () => {
    expect(resolveMakeModel("VW", "Corrado G60")).toEqual({ makeSlug: "volkswagen", modelSlug: null, variant: "Corrado G60" });
  });

  it("returns nulls for unknown makes", () => {
    expect(resolveMakeModel("Trabant", "601")).toEqual({ makeSlug: null, modelSlug: null, variant: "601" });
  });
});

describe("detectFuel", () => {
  it.each([
    ["VW Golf 2.0 TDI Highline", "diesel"],
    ["BMW 320d Touring", "diesel"],
    ["Audi A3 Sportback 1.4 TFSI", "petrol"],
    ["BMW 118i", "petrol"],
    ["VW Passat GTE Variant", "plugin_hybrid"],
    ["Toyota Yaris Hybrid", "hybrid"],
    ["Audi e-tron 55 quattro", "electric"],
    ["Opel Corsa Autogas LPG", "lpg"],
    ["Seat Leon 1.5 TGI", "cng"],
    ["Toyota Prius Benzin/Elektro", "hybrid"],
    ["Ford Kuga Elektro/Benzin", "hybrid"],
  ])("%s -> %s", (title, fuel) => {
    expect(detectFuel(title)).toBe(fuel);
  });

  it("returns null when the title does not say", () => {
    expect(detectFuel("VW Golf 7 Comfortline")).toBeNull();
    expect(detectFuel(null)).toBeNull();
  });
});

describe("detectTransmission", () => {
  it("counts clear words only", () => {
    expect(detectTransmission("Golf 2.0 TDI DSG")).toBe("automatic");
    expect(detectTransmission("C 220 d Automatik")).toBe("automatic");
    expect(detectTransmission("Polo 1.0 6-Gang")).toBe("manual");
    expect(detectTransmission("Corsa Schaltgetriebe")).toBe("manual");
    expect(detectTransmission("Auto mit TÜV")).toBeNull();
    expect(detectTransmission("Golf Comfortline")).toBeNull();
  });
});

describe("detectBodyType", () => {
  it.each([
    ["BMW 320d Touring", "estate"],
    ["Audi A4 Avant", "estate"],
    ["Peugeot 308 SW", "estate"],
    ["Mercedes C 200 T-Modell", "estate"],
    ["Mini Cooper Cabrio", "convertible"],
    ["BMW 420i Coupé", "coupe"],
    ["VW T5 Bus", "van"],
    ["Mercedes E 220 Limousine", "sedan"],
  ])("%s -> %s", (title, body) => {
    expect(detectBodyType(title)).toBe(body);
  });

  it("does not match parts of other words", () => {
    expect(detectBodyType("Swift 1.2")).toBeNull();
    // 4x4 is the drive, not the body.
    expect(detectBodyType("Panda 4x4")).toBeNull();
    expect(detectBodyType("Kleinwagen 4x4")).toBe("small");
    expect(detectBodyType("Vanden Plas")).toBeNull();
    expect(detectBodyType(null)).toBeNull();
  });
});

describe("findMakeInTitle", () => {
  it("finds the make at the start and returns the rest", () => {
    expect(findMakeInTitle("VW Golf 7 1.4 TSI")).toMatchObject({ make: { slug: "volkswagen" }, rest: "Golf 7 1.4 TSI" });
    expect(findMakeInTitle("Mercedes Benz V250 4Matic")).toMatchObject({ make: { slug: "mercedes-benz" }, rest: "V250 4Matic" });
    expect(findMakeInTitle("Mercedes-Benz C 220 d")).toMatchObject({ make: { slug: "mercedes-benz" }, rest: "C 220 d" });
    expect(findMakeInTitle("Land Rover Defender 110")).toMatchObject({ make: { slug: "land-rover" }, rest: "Defender 110" });
    expect(findMakeInTitle("VW-Golf 1.4 TSI")).toMatchObject({ make: { slug: "volkswagen" }, rest: "Golf 1.4 TSI" });
    expect(findMakeInTitle("VW-Golf-1.4 TSI")).toMatchObject({ make: { slug: "volkswagen" }, rest: "Golf-1.4 TSI" });
  });

  it("finds the make after a few leading words", () => {
    expect(findMakeInTitle("2023 Skoda Superb 2.0 TSI")).toMatchObject({ make: { slug: "skoda" }, rest: "Superb 2.0 TSI" });
    expect(findMakeInTitle("Export / Bastler Opel Astra J GTC")).toMatchObject({ make: { slug: "opel" }, rest: "Astra J GTC" });
    expect(findMakeInTitle("Verkaufe meinen VW Golf")).toMatchObject({ make: { slug: "volkswagen" }, rest: "Golf" });
  });

  it("returns null when no make is among the first words", () => {
    expect(findMakeInTitle("Suche Golf 7")).toBeNull();
    expect(findMakeInTitle("Sehr schöner gepflegter Wagen VW Golf")).toBeNull();
    expect(findMakeInTitle("")).toBeNull();
  });
});

describe("resolveModelInTitle", () => {
  it("finds the model behind leading words", () => {
    expect(resolveModelInTitle("VW", "Verkaufe Polo R-Line")).toMatchObject({ makeSlug: "volkswagen", modelSlug: "polo", variant: "R-Line" });
    expect(resolveModelInTitle("BMW", "E46 330i Touring")).toMatchObject({ modelSlug: "3er" });
    expect(resolveModelInTitle("VW", "Golf 7 GTI")).toMatchObject({ modelSlug: "golf", variant: "7 GTI" });
  });

  it("does not read one-letter words or engine sizes as models", () => {
    expect(resolveModelInTitle("smart", "Erstbesitz 1. Hand").modelSlug).toBeNull();
    expect(resolveModelInTitle("Mazda", "Tribute 3.0 V6").modelSlug).toBeNull();
  });
});

describe("isNotForSale", () => {
  it.each(["‼️ Suche Opel Astra Vectra Signum", "Motorschaden Ankauf Opel Corsa Astra", "Leasingübernahme Opel Corsa 100 PS", "Kaufe Ihr Auto sofort"])(
    "skips %s",
    (title) => expect(isNotForSale(title)).toBe(true),
  );

  it.each(["VW Golf 7, neuer Besitzer gesucht", "BMW 320d Inzahlungnahme und Ankauf möglich", "Verkaufe Polo R-Line"])("keeps %s", (title) =>
    expect(isNotForSale(title)).toBe(false),
  );

  // Wanted and swap ads that were still active on the live site.
  it.each([
    "Suchen Golf 3 1,8 75PS /90PS für Bastler",
    "Suchen Opel Astra F oder G als Teilespender",
    "AMG GT Coupe 2 Türer ab 2015 *Suche*",
    // The same as AutoScout24 stored it: the title loses the stars.
    "Mercedes-Benz AMG GT Coupe 2 Türer ab 2015 Suche",
    "Suche VW/Audi (Diesel)",
    "Suche älteres Mittelklasse-Auto gerne von Rentner",
    "Gesucht: VW Bus T4",
    "VW Bus T3 (SUCHE)",
    "iphone 18 pro max weschel gegen eine transporter",
    "Tausche PS5 gegen Auto",
    "Rolex Submariner Tausch gegen Porsche",
  ])("skips the wanted or swap ad %s", (title) => expect(isNotForSale(title)).toBe(true));

  it.each([
    "VW Golf 7 Tausch möglich",
    "BMW 320d Tausch oder VB",
    "Golf 4 Tausch gegen Transporter",
    "Opel Corsa, Tausch gegen Wohnwagen möglich",
    "Tausch gegen Golf",
    "Biete Tausch gegen Bulli",
    "1.500 € oder Tausch gegen Bulli",
    "Mein Auto tausche gegen Transporter",
    "Wohnmobil Tausch gegen PKW",
    "Suchen Sie einen Kombi? Skoda Octavia Combi",
    "VW Polo 1.2, Käufer suche",
    "Golf 7 GTI, Tausch suche",
    "VW Golf 1.6, Zahnriemen Wechsel gegen Aufpreis",
    "Audi A4 Avant, Ölwechsel neu",
  ])("keeps the sale ad %s", (title) => expect(isNotForSale(title)).toBe(false));
});

describe("mentionsCar", () => {
  it("finds makes, models and car words anywhere", () => {
    expect(mentionsCar("mein schöner golf 4")).toBe(true);
    expect(mentionsCar("Opel Corsa")).toBe(true);
    expect(mentionsCar("mein auto")).toBe(true);
    expect(mentionsCar("iphone 18 pro max")).toBe(false);
    expect(mentionsCar("ps5")).toBe(false);
  });
});

describe("titles of AutoScout24's parts", () => {
  it.each<[(string | null)[], string]>([
    [["Audi", "Q3", "35 TFSI", "Sportback S-Line 35 TFSI"], "Audi Q3 35 TFSI Sportback S-Line"],
    [["Mercedes-Benz", "V 300", null, "V 300 d kompakt 4Matic"], "Mercedes-Benz V 300 d kompakt 4Matic"],
    [["Mercedes-Benz", "G 63 AMG", null, "G 63 AMG Bodykit"], "Mercedes-Benz G 63 AMG Bodykit"],
    [["Volkswagen", "Polo", "1.2", "1.2"], "Volkswagen Polo 1.2"],
    [["Ford", "Focus", null, "Focus"], "Ford Focus"],
    [["Mercedes-Benz", "E 220", "E 220 d", "T-Modell E 220 d Avantgarde"], "Mercedes-Benz E 220 d T-Modell Avantgarde"],
    [["Volkswagen", "Golf", "1.5 TSI", "Life Navi LED ACC"], "Volkswagen Golf 1.5 TSI Life Navi LED ACC"],
    [["Mercedes-Benz", "AMG GT", null, "AMG GT - Garantie"], "Mercedes-Benz AMG GT Garantie"],
  ])("%j -> %s", (parts, title) => expect(joinWithoutRepeats(parts)).toBe(title));

  it("keeps repeats inside one part and lone letters", () => {
    expect(joinWithoutRepeats(["VW", "Golf", "ohne Rost ohne Unfall"])).toBe("VW Golf ohne Rost ohne Unfall");
    expect(joinWithoutRepeats(["BMW", "320d", "d Touring"])).toBe("BMW 320d d Touring");
  });

  it("knows the portals' words for a model not in their list", () => {
    for (const model of ["Sonstige", "Andere", "ANDERE", "Others", "other"]) expect(isPlaceholderModel(model), model).toBe(true);
    for (const model of ["Golf", "One", null]) expect(isPlaceholderModel(model), String(model)).toBe(false);
  });
});

describe("models sellers write in their own way", () => {
  it.each([
    ["Volvo", "XC 60 Summum", "xc60"],
    ["Lexus", "IS200 Sport", "is"],
    ["Lexus", "RX450h F Sport", "rx"],
    ["Porsche", "992 Carrera S", "911"],
    ["Tesla", "Modell 3 Long Range", "model-3"],
    ["Tesla", "S85D Performance", "model-s"],
    ["Peugeot", "207cc Cabrio", "207"],
    ["DS Automobiles", "Citroen DS3 Automatik", "ds3"],
    ["smart", "451 Cabrio", "fortwo"],
    ["Abarth", "595C Competizione", "500"],
    ["Kia", "K4 Spirit 1.6T", "k4"],
    ["MINI", "One Bj.2003 zum Schlachten", "one"],
    ["MINI", "One D Countryman", "countryman"],
    ["MINI", "Cooper S", "cooper"],
    ["Renault", "19 – Bastlerfahrzeug", "19"],
    ["Porsche", "962 C", "962"],
    ["Porsche", "918 Spyder", "918"],
    ["Porsche", "959", "959"],
    ["Porsche", "935", "935"],
    ["Porsche", "Carrera GT", "carrera-gt"],
    ["Porsche", "Carrera GTS", "911"],
    ["Lexus", "LF-A", "lfa"],
    ["Mercedes-Benz", "AMG ONE", "amg-one"],
  ])("%s %s", (make, model, slug) => {
    expect(resolveMakeModel(make, model).modelSlug).toBe(slug);
  });
});

describe("resolveMakeModel with joined words", () => {
  it("keeps what follows the model inside the same word", () => {
    expect(resolveMakeModel("VW", "Golf-GTI Performance")).toEqual({ makeSlug: "volkswagen", modelSlug: "golf", variant: "GTI Performance" });
    expect(resolveMakeModel("VW", "Käfer 1303")).toMatchObject({ modelSlug: "beetle", variant: "1303" });
  });

  it("keeps the punctuation of the rest", () => {
    expect(resolveMakeModel("VW", "Golf-1.4 TSI")).toMatchObject({ modelSlug: "golf", variant: "1.4 TSI" });
    expect(resolveMakeModel("VW", "T-Roc-2.0 TDI")).toMatchObject({ modelSlug: "t-roc", variant: "2.0 TDI" });
    expect(resolveMakeModel("VW", "Golf/GTI")).toMatchObject({ modelSlug: "golf", variant: "GTI" });
  });
});

describe("Mercedes-Benz classes", () => {
  it("reads the class from codes like C220d, but leaves GLC to its own model", () => {
    expect(resolveMakeModel("Mercedes-Benz", "C220d AMG Line").modelSlug).toBe("c-klasse");
    expect(resolveMakeModel("Mercedes-Benz", "V250 4Matic").modelSlug).toBe("v-klasse");
    expect(resolveMakeModel("Mercedes-Benz", "GLC 300").modelSlug).toBe("glc");
  });
});

describe("sourceImageUrl", () => {
  it("keeps https links to the source's image servers only", () => {
    expect(sourceImageUrl("https://img.kleinanzeigen.de/api/v1/prod-ads/images/90/x?rule=$_2.AUTO", "kleinanzeigen.de")).toBe(
      "https://img.kleinanzeigen.de/api/v1/prod-ads/images/90/x?rule=$_2.AUTO",
    );
    expect(sourceImageUrl("http://s3.quoka.de/quoka/top/1.webp", "quoka.de")).toBe("https://s3.quoka.de/quoka/top/1.webp");
    expect(sourceImageUrl("https://quoka.de/1.webp", "quoka.de")).toBe("https://quoka.de/1.webp");
  });

  it("drops other hosts, schemes and anything that is not an address", () => {
    expect(sourceImageUrl("https://notquoka.de/1.webp", "quoka.de")).toBeNull();
    expect(sourceImageUrl("https://quoka.de.evil.example/1.webp", "quoka.de")).toBeNull();
    expect(sourceImageUrl("https://user:pw@s3.quoka.de/1.webp", "quoka.de")).toBeNull();
    expect(sourceImageUrl("javascript:alert(1)", "quoka.de")).toBeNull();
    expect(sourceImageUrl("data:image/png;base64,AAAA", "quoka.de")).toBeNull();
    expect(sourceImageUrl("/relative.jpg", "quoka.de")).toBeNull();
    expect(sourceImageUrl(undefined, "quoka.de")).toBeNull();
    expect(sourceImageUrl(`https://s3.quoka.de/${"a".repeat(1000)}`, "quoka.de")).toBeNull();
  });
});
