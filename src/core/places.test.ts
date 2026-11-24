import { describe, expect, it } from "vitest";
import { cleanCity } from "./places";

describe("cleanCity", () => {
  // Live AutoScout24 and Quoka place names, with the name our postal code data has for the listing's code.
  it.each<[string | null, string | null, string | null]>([
    ["viersen", "Viersen", "Viersen"],
    ["Gross kreutz", "Groß Kreutz", "Groß Kreutz"],
    ["Vohburg a.d.Donau, St", "Vohburg an der Donau", "Vohburg an der Donau"],
    ["Bad Kreuznach, Stadt", "Bad Kreuznach", "Bad Kreuznach"],
    ["Bergisch Gladbach, Stadt", "Bergisch Gladbach", "Bergisch Gladbach"],
    ["Beilngries, St", "Beilngries", "Beilngries"],
    ["Pfaffenhofen (bei Münche", "Pfaffenhofen an der Ilm", "Pfaffenhofen an der Ilm"],
    ["MUENCHEN", "München", "München"],
    ["Dresden", "Dresden Innere Altstadt", "Dresden"],
    ["Feldkirchen Niederbay", "Feldkirchen", "Feldkirchen Niederbay"],
    ["Halle (Saale)", "Halle", "Halle (Saale)"],
    ["Frankfurt (Oder)", "Frankfurt (Oder)", "Frankfurt (Oder)"],
    ["St. Ingbert", "Sankt Ingbert", "St. Ingbert"],
    ["Aschaffenburg", "Aschaffenburg", "Aschaffenburg"],
    // Same first word, different place: the portal's name stays.
    ["Frankfurt a.Main", "Frankfurt (Oder)", "Frankfurt a.Main"],
    ["Frankfurt a.Main", "Frankfurt am Main", "Frankfurt am Main"],
  ])("%s at %s -> %s", (city, place, clean) => expect(cleanCity(city, place)).toBe(clean));

  it("cleans names without a known postal code as well", () => {
    expect(cleanCity("Beilngries, St", null)).toBe("Beilngries");
    expect(cleanCity("Lübeck, Hansestadt")).toBe("Lübeck");
    expect(cleanCity("viersen")).toBe("Viersen");
    expect(cleanCity("frankfurt am main")).toBe("Frankfurt am Main");
    expect(cleanCity("BAD HOMBURG")).toBe("Bad Homburg");
    expect(cleanCity("garmisch-partenkirchen")).toBe("Garmisch-Partenkirchen");
    expect(cleanCity("Vohburg a.d.Donau, St")).toBe("Vohburg a.d.Donau");
  });

  it("keeps a place in another town than the postal code says", () => {
    expect(cleanCity("Ingolstadt", "Vohburg an der Donau")).toBe("Ingolstadt");
    expect(cleanCity("Neustadt a.d.Aisch", "Bad Windsheim")).toBe("Neustadt a.d.Aisch");
  });

  it("names the place after the postal code when the portal names none", () => {
    expect(cleanCity(null, "Viersen")).toBe("Viersen");
    expect(cleanCity("  ", null)).toBeNull();
  });
});
