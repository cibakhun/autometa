import { describe, expect, it } from "vitest";
import { DEFAULT_FLIP_SETTINGS } from "@/core/flip";
import { parseFilters } from "@/search/filters";
import { flipListHref, parseFlipCookie } from "./flip-settings";

describe("flip settings cookie", () => {
  it("falls back to the defaults for a missing or broken cookie", () => {
    expect(parseFlipCookie(undefined)).toEqual(DEFAULT_FLIP_SETTINGS);
    expect(parseFlipCookie("{not json")).toEqual(DEFAULT_FLIP_SETTINGS);
    expect(parseFlipCookie(JSON.stringify({ level: 2 }))).toEqual({ ...DEFAULT_FLIP_SETTINGS, level: 2 });
  });

  it("links the flip list with the level and minimum margin as search filters", () => {
    const href = flipListHref({ ...DEFAULT_FLIP_SETTINGS, level: 2, minMarginEur: 800 });
    expect(parseFilters(new URLSearchParams(href.slice(2)))).toMatchObject({
      zustand: "defekt",
      schwierigkeit: 2,
      margeMin: 800,
      sort: "flip",
    });
  });
});
