import { describe, expect, it } from "vitest";
import { detectInspection } from "./inspection";

const NOW = new Date("2026-11-18T12:00:00Z");
const of = (title: string, firstRegistration: string | null = null, priceEur = 15000, mileageKm: number | null = 40000) =>
  detectInspection({ title, firstRegistration, priceEur, mileageKm }, NOW);

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
    expect(of("Skoda Octavia Combi", "2024-03-01", 15000, null)).toEqual({ until: "2027-03-01", basis: "registration" });
  });

  it("trusts the first registration only for a plausible young car", () => {
    // Junk in the car category with a recent first registration, seen on Kleinanzeigen.
    expect(of("4 Audi Alufelgen mit Reifen – 235/60 R18 350€ VB", "2025-03-01", 350, 0)).toBeNull();
    expect(of("Ps5 zu verkaufen", "2025-03-01", 765, 222222)).toBeNull();
    // A wrong date: 207,000 km in six months.
    expect(of("Audi A4 2.0 Benzin", "2026-05-01", 24300, 207000)).toBeNull();
    // A taxi can drive 300,000 km in three years.
    expect(of("Mercedes E 200 Taxi", "2023-12-01", 18900, 300000)).toEqual({ until: "2026-12-01", basis: "registration" });
    // A stated date does not depend on price or mileage.
    expect(of("Golf 4 TÜV 05/2027", "2025-03-01", 450, 300000)).toEqual({ until: "2027-05-01", basis: "stated" });
  });

  it("ignores TÜV seals, reports and other numbers", () => {
    expect(of("BMW 118i TÜV-geprüft mit Siegel")).toBeNull();
    expect(of("Audi A4 TÜV Report 2019 Bestnote")).toBeNull();
    expect(of("Hyundai i30 1.4 Hu Klima")).toBeNull();
    expect(of("Golf TÜV 13/2027")).toBeNull();
    expect(of("Golf TÜV 05/2045")).toBeNull();
  });
});
