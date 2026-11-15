import { describe, expect, it } from "vitest";
import {
  detectBodyType,
  detectFuel,
  detectTransmission,
  findMakeInTitle,
  kwToPs,
  normalizeBodyType,
  normalizeFuel,
  normalizeTransmission,
  parseFirstRegistration,
  parseInteger,
  parsePowerKw,
  resolveMakeModel,
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
  });

  it("returns null when the title does not start with a make", () => {
    expect(findMakeInTitle("Suche Golf 7")).toBeNull();
    expect(findMakeInTitle("")).toBeNull();
  });
});

describe("resolveMakeModel with joined words", () => {
  it("keeps what follows the model inside the same word", () => {
    expect(resolveMakeModel("VW", "Golf-GTI Performance")).toEqual({ makeSlug: "volkswagen", modelSlug: "golf", variant: "GTI Performance" });
    expect(resolveMakeModel("VW", "Käfer 1303")).toMatchObject({ modelSlug: "beetle", variant: "1303" });
  });
});

describe("Mercedes-Benz classes", () => {
  it("reads the class from codes like C220d, but leaves GLC to its own model", () => {
    expect(resolveMakeModel("Mercedes-Benz", "C220d AMG Line").modelSlug).toBe("c-klasse");
    expect(resolveMakeModel("Mercedes-Benz", "V250 4Matic").modelSlug).toBe("v-klasse");
    expect(resolveMakeModel("Mercedes-Benz", "GLC 300").modelSlug).toBe("glc");
  });
});
