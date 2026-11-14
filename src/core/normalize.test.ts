import { describe, expect, it } from "vitest";
import {
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
    expect(resolveMakeModel("VW", "Käfer 1303")).toEqual({ makeSlug: "volkswagen", modelSlug: null, variant: "Käfer 1303" });
  });

  it("returns nulls for unknown makes", () => {
    expect(resolveMakeModel("Trabant", "601")).toEqual({ makeSlug: null, modelSlug: null, variant: "601" });
  });
});
