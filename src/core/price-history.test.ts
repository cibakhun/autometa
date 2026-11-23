import { describe, expect, it } from "vitest";
import { daysBetween, germanDay, onlineSpan, priceStory } from "./price-history";

describe("priceStory", () => {
  it("is null without prices and has no changes with one", () => {
    expect(priceStory([])).toBeNull();
    expect(priceStory([{ priceEur: 5000, seenAt: "2026-11-19T10:00:00.000Z" }])).toEqual({
      firstEur: 5000,
      firstSeenAt: "2026-11-19T10:00:00.000Z",
      changes: [],
      drops: 0,
      raises: 0,
      totalEur: 0,
      lastDrop: null,
      currentSince: "2026-11-19T10:00:00.000Z",
    });
  });

  it("counts drops and raises and sums them up", () => {
    const story = priceStory([
      { priceEur: 5000, seenAt: "2026-11-19T10:00:00.000Z" },
      { priceEur: 4500, seenAt: "2026-11-20T10:00:00.000Z" },
      // The same price again is no change.
      { priceEur: 4500, seenAt: "2026-11-20T12:00:00.000Z" },
      { priceEur: 4700, seenAt: "2026-11-21T10:00:00.000Z" },
      { priceEur: 4200, seenAt: "2026-11-22T10:00:00.000Z" },
    ])!;
    expect(story.changes).toEqual([
      { at: "2026-11-20T10:00:00.000Z", fromEur: 5000, toEur: 4500 },
      { at: "2026-11-21T10:00:00.000Z", fromEur: 4500, toEur: 4700 },
      { at: "2026-11-22T10:00:00.000Z", fromEur: 4700, toEur: 4200 },
    ]);
    expect(story).toMatchObject({ drops: 2, raises: 1, totalEur: -800, currentSince: "2026-11-22T10:00:00.000Z" });
    expect(story.lastDrop).toEqual({ at: "2026-11-22T10:00:00.000Z", fromEur: 4700, toEur: 4200 });
  });
});

describe("onlineSpan", () => {
  const asOf = "2026-11-23T22:30:00.000Z"; // 23:30 in Berlin, still the 23rd

  it("counts from the day the portal names when it is not after the first sighting", () => {
    expect(onlineSpan({ listedOn: "2026-11-12", firstSeenAt: "2026-11-19T08:00:00.000Z", endedAt: null, asOf })).toEqual({
      since: "2026-11-12",
      basis: "portal",
      until: null,
      days: 11,
    });
  });

  it("counts from the first sighting without a portal date, or when the portal's is later (pushed up again)", () => {
    expect(onlineSpan({ listedOn: null, firstSeenAt: "2026-11-19T08:00:00.000Z", endedAt: null, asOf })).toMatchObject({
      since: "2026-11-19",
      basis: "autometa",
      days: 4,
    });
    expect(onlineSpan({ listedOn: "2026-11-21", firstSeenAt: "2026-11-19T08:00:00.000Z", endedAt: null, asOf })).toMatchObject({
      since: "2026-11-19",
      basis: "autometa",
    });
  });

  it("ends on the day a listing left, in German time", () => {
    expect(
      onlineSpan({ listedOn: null, firstSeenAt: "2026-11-18T23:30:00.000Z", endedAt: "2026-11-21T23:10:00.000Z", asOf }),
    ).toEqual({ since: "2026-11-19", basis: "autometa", until: "2026-11-22", days: 3 });
  });

  it("works in German calendar days", () => {
    expect(germanDay("2026-11-23T23:30:00.000Z")).toBe("2026-11-24");
    expect(germanDay("2026-07-01T22:30:00.000Z")).toBe("2026-07-02");
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });
});
