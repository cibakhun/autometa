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

  it("keeps points near the box's east edge that lie north of the centre", () => {
    // Regression: dividing dLat by cos(lat) made the box too narrow for large radii.
    const point = { lat: 53.5, lng: 28.22 };
    expect(haversineKm(52.52, 13.405, point.lat, point.lng)).toBeLessThan(1000);
    const box = boundingBox(52.52, 13.405, 1000);
    expect(point.lng).toBeLessThanOrEqual(box.maxLng);
    expect(point.lat).toBeLessThanOrEqual(box.maxLat);
  });
});
