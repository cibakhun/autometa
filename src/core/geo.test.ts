import { describe, expect, it } from "vitest";
import { boundingBox, haversineKm } from "./geo";

describe("geo", () => {
  it("measures Berlin to Munich at roughly 504 km", () => {
    expect(haversineKm(52.52, 13.405, 48.1351, 11.582)).toBeCloseTo(504, -1);
  });

  it("builds a box that contains points within the radius", () => {
    const box = boundingBox(52.52, 13.405, 50);
    // Potsdam is about 27 km from Berlin.
    expect(52.3906).toBeGreaterThan(box.minLat);
    expect(13.0645).toBeGreaterThan(box.minLng);
    expect(box.maxLat - box.minLat).toBeCloseTo(0.9, 1);
  });
});
