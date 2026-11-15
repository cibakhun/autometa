import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { POSTAL_CODES_FILE, parsePostalCodes } from "./seed";

describe("parsePostalCodes", () => {
  it("reads zip, place and coordinates and skips comments", () => {
    expect(parsePostalCodes("# Quelle\n10115\tBerlin\t52.5323\t13.3846\n\n80331\tMünchen\t48.1345\t11.571\n")).toEqual([
      { zip: "10115", city: "Berlin", lat: 52.5323, lng: 13.3846 },
      { zip: "80331", city: "München", lat: 48.1345, lng: 11.571 },
    ]);
  });

  it("rejects broken lines", () => {
    expect(() => parsePostalCodes("1011\tBerlin\t52.5\t13.4")).toThrow(/Invalid postal code line/);
    expect(() => parsePostalCodes("10115\t\t52.5\t13.4")).toThrow(/Invalid/);
    expect(() => parsePostalCodes("10115\tBerlin\tx\t13.4")).toThrow(/Invalid/);
  });

  it("ships a file covering all of Germany with places, not companies", async () => {
    const places = parsePostalCodes(await readFile(POSTAL_CODES_FILE, "utf8"));
    expect(places.length).toBeGreaterThan(8000);
    expect(new Set(places.map((p) => p.zip)).size).toBe(places.length);
    const byZip = new Map(places.map((p) => [p.zip, p]));
    expect(byZip.get("10115")?.city).toBe("Berlin");
    expect(byZip.get("80331")?.city).toBe("München");
    for (const place of places) {
      expect(place.lat).toBeGreaterThan(47);
      expect(place.lat).toBeLessThan(55.1);
      expect(place.lng).toBeGreaterThan(5.8);
      expect(place.lng).toBeLessThan(15.1);
      expect(place.city, place.zip).not.toMatch(/GmbH|\bAG\b|\beG\b|Bank|Versicherung|Finanzamt/);
    }
  });
});
