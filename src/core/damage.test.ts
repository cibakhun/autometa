import { describe, expect, it } from "vitest";
import { detectDamage } from "./damage";

describe("detectDamage", () => {
  it.each([
    ["VW Golf 6 1.4 TSI Motorschaden", ["engine"]],
    ["Opel Astra H Motor defekt", ["engine"]],
    ["BMW 320d Steuerkette gerissen", ["timing"]],
    ["Audi A4 Zahnriemen gerissen, für Bastler", ["timing", "project"]],
    ["Ford Focus ZKD defekt", ["head_gasket"]],
    ["Skoda Octavia Turbolader defekt", ["turbo"]],
    ["Passat B6 DSG defekt", ["gearbox"]],
    ["Mercedes C220 Getriebeschaden", ["gearbox"]],
    ["Seat Leon Kupplung rutscht", ["clutch"]],
    ["Polo 9N Elektrikprobleme", ["electrics"]],
    ["Toyota Yaris Unfallwagen", ["accident"]],
    ["Fiat Punto Frontschaden fahrbereit", ["accident"]],
    ["Corsa D Hagelschaden", ["hail"]],
    ["Smart Fortwo springt nicht an", ["not_running"]],
    ["Renault Clio fährt nicht mehr", ["not_running"]],
    ["VW Touran Export Händler", ["project"]],
    ["Golf 4 Teileträger", ["project"]],
    ["Peugeot 206 Klima defekt", ["defect"]],
    ["Mazda 3 mit Mängeln", ["defect"]],
    // A negation reaches only into its own phrase and the next word (or one filler word).
    ["Opel Astra ohne Rost, Motorschaden", ["engine"]],
    ["Opel Astra ohne TÜV Motorschaden", ["engine"]],
    ["Golf kein Rost - Getriebe defekt", ["gearbox"]],
  ])("finds damage in %j", (title, kinds) => {
    expect(detectDamage(title)).toEqual(kinds);
  });

  it.each([
    "VW Golf 7 unfallfrei, TÜV neu",
    "BMW 118i kein Unfall, scheckheftgepflegt",
    "Audi A3 ohne Rost, Zahnriemen neu",
    "Opel Corsa TÜV ohne Mängel",
    "Ford Fiesta Unfallschaden repariert",
    "Skoda Fabia Motorschaden behoben, neuer Motor",
    "Steuerkette neu gemacht, Kupplung neu",
    "Mercedes A 180 Automatik",
    "Hyundai i30 nichts defekt",
    "Kia Ceed ohne jeden Rost",
    "Jaguar XJ8 108000km rost frei.",
    "Golf 5 Unfall frei, TÜV neu",
    "Opel Zafira kein sichtbarer Rost, TÜV 2027",
  ])("finds nothing in %j", (title) => {
    expect(detectDamage(title)).toEqual([]);
  });

  it("reports each kind once and in a fixed order", () => {
    expect(detectDamage("Bastler: Motorschaden, Getriebe defekt, Motor klopft")).toEqual(["engine", "gearbox", "project"]);
  });
});
