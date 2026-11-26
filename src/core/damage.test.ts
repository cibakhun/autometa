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
    ["Golf 4 nur Export, TÜV abgelaufen", ["project"]],
    ["Polo o. TÜV, Motorschaden", ["engine"]],
    ["Golf 4 Teileträger", ["project"]],
    ["Peugeot 206 Klima defekt", ["defect"]],
    ["Mazda 3 mit Mängeln", ["defect"]],
    // Seen live 2026-11-26 at the top of the deal lists.
    ["Beschädigte BMW X1", ["defect"]],
    ["BMW 216 dA Aktiv Tourer, beschädigt, auch TEILEVERKAUF", ["project"]],
    ["BMW 218 218i i Gran Tourer Steptronic 7-Sitze MOTORSTÖRUNG", ["engine"]],
    ["Ford S-Max 2.0 TD Titanium Getriebe Problem", ["gearbox"]],
    ["Ford Transit Custom Kasten 290 L1 Trend/Injektor def.", ["defect"]],
    ["Opel Insignia Motor Probleme", ["engine"]],
    ["VW Passat DSG-Störung", ["gearbox"]],
    ["Audi A4 Airbagstörung, kleines Problem", ["defect"]],
    // A negation reaches only into its own phrase and the next word (or one filler word).
    ["Opel Astra ohne Rost, Motorschaden", ["engine"]],
    ["Opel Astra ohne TÜV Motorschaden", ["engine"]],
    ["Golf kein Rost - Getriebe defekt", ["gearbox"]],
    // "frei" after a match counts only within its phrase.
    ["Polo Rost, frei ab sofort", ["rust"]],
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
    "Golf 7 unbeschädigt, TÜV neu",
    "Polo nicht beschädigt",
    "Corsa läuft problemlos",
    "Astra ohne Probleme, TÜV 2027",
    "Fiesta kein Problem bei der HU",
    "Land Rover Defender 110",
    // Short for "ohne" in a title with few characters to spare.
    "Volkswagen Crafter 2.0 TDI Kasten 35 L4H3 NAV AHK oh.Schäden 5J.Gar",
    "Audi A6 Avant o. Unfall, Scheckheft",
    "Golf o Unfall",
    // A customs transit document for exporting a new car, not a parts car.
    "Toyota Land Cruiser 300+PREMIUM+V6_HYBRID_464PS+EXPORT_T1+READY",
    "Toyota Land Cruiser HYBRID_EXPORT_T1_READY",
  ])("finds nothing in %j", (title) => {
    expect(detectDamage(title)).toEqual([]);
  });

  it("reports each kind once and in a fixed order", () => {
    expect(detectDamage("Bastler: Motorschaden, Getriebe defekt, Motor klopft")).toEqual(["engine", "gearbox", "project"]);
  });
});
