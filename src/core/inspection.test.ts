import { describe, expect, it } from "vitest";
import { detectInspection } from "./inspection";

const NOW = new Date("2026-11-18T12:00:00Z");
const of = (title: string, firstRegistration: string | null = null) => detectInspection(title, firstRegistration, NOW);

describe("detectInspection", () => {
  it("reads a month or year the title states", () => {
    expect(of("VW Golf 1.4 TSI TÜV 05/2027")).toEqual({ until: "2027-05-01", basis: "stated" });
    expect(of("Opel Astra HU/AU bis 5.27 Klima")).toEqual({ until: "2027-05-01", basis: "stated" });
    expect(of("Fiat Punto Tüv:08-2026")).toEqual({ until: "2026-08-01", basis: "stated" });
    expect(of("BMW 320d TÜV neu bis 11/2028")).toEqual({ until: "2028-11-01", basis: "stated" });
    expect(of("Polo 6N TÜV 2027")).toEqual({ until: "2027-01-01", basis: "stated" });
    expect(of("Golf 4 TÜV 03/2025")).toEqual({ until: "2025-03-01", basis: "stated" });
  });

  it("counts 'TÜV neu' and durations from when the listing is seen", () => {
    expect(of("7 Variant 1.6 TDI /SERVICE/TÜV NEU/GARANTIE")).toEqual({ until: "2028-11-01", basis: "relative" });
    expect(of("Trendline*Klima*TÜV NEU*Service NEU")).toEqual({ until: "2028-11-01", basis: "relative" });
    expect(of("Corsa D, HU und AU neu")).toEqual({ until: "2028-11-01", basis: "relative" });
    expect(of("Ford Focus TÜV und Service neu")).toEqual({ until: "2028-11-01", basis: "relative" });
    expect(of("Mazda 3 mit neuem TÜV")).toEqual({ until: "2028-11-01", basis: "relative" });
    expect(of("Skoda Fabia 2 Jahre TÜV")).toEqual({ until: "2028-11-01", basis: "relative" });
    expect(of("Skoda Fabia TÜV noch 1 Jahr")).toEqual({ until: "2027-11-01", basis: "relative" });
    expect(of("Clio TÜV 10 Monate")).toEqual({ until: "2027-09-01", basis: "relative" });
  });

  it("recognises an expired HU", () => {
    expect(of("Golf 4 1.4 75PS Schiebedach HU abgelaufen")).toEqual({ until: null, basis: "expired" });
    expect(of("Opel Corsa ohne TÜV für Bastler")).toEqual({ until: null, basis: "expired" });
    expect(of("Passat TÜV fällig, Motor läuft")).toEqual({ until: null, basis: "expired" });
  });

  it("falls back to the first HU three years after the first registration", () => {
    expect(of("Skoda Octavia Combi", "2024-03-01")).toEqual({ until: "2027-03-01", basis: "registration" });
    expect(of("Skoda Octavia Combi", "2023-11-01")).toEqual({ until: "2026-11-01", basis: "registration" });
    expect(of("Skoda Octavia Combi", "2023-10-01")).toBeNull();
    expect(of("Skoda Octavia Combi TÜV 06/2027", "2024-03-01")).toEqual({ until: "2027-06-01", basis: "stated" });
  });

  it("ignores TÜV seals, reports and other numbers", () => {
    expect(of("BMW 118i TÜV-geprüft mit Siegel")).toBeNull();
    expect(of("Audi A4 TÜV Report 2019 Bestnote")).toBeNull();
    expect(of("Hyundai i30 1.4 Hu Klima")).toBeNull();
    expect(of("Golf TÜV 13/2027")).toBeNull();
    expect(of("Golf TÜV 05/2045")).toBeNull();
  });
});
