import { describe, expect, it } from "vitest";
import { groupCandidates, type CandidatePair } from "./duplicates";

const pair = (a: number, aSource: string, b: number, bSource: string, score = 0.01, weak = false): CandidatePair => ({
  a,
  b,
  aSource,
  bSource,
  score,
  weak,
});

describe("groupCandidates", () => {
  it("joins the same vehicle across portals under the smallest id", () => {
    const groups = groupCandidates([pair(5, "autoscout24", 9, "kleinanzeigen"), pair(9, "kleinanzeigen", 12, "mobile")]);
    expect(Object.fromEntries(groups)).toEqual({ 5: 5, 9: 5, 12: 5 });
  });

  it("never puts two listings of one portal into a group; the closer match wins", () => {
    // Listing 1 (AutoScout24) matches two Kleinanzeigen listings; 3 is the closer one.
    const groups = groupCandidates([pair(1, "autoscout24", 2, "kleinanzeigen", 0.05), pair(1, "autoscout24", 3, "kleinanzeigen", 0.01)]);
    expect(Object.fromEntries(groups)).toEqual({ 1: 1, 3: 1 });
  });

  it("does not merge two groups that share a portal", () => {
    const groups = groupCandidates([
      pair(1, "autoscout24", 2, "kleinanzeigen", 0.01),
      pair(3, "autoscout24", 4, "kleinanzeigen", 0.01),
      pair(2, "kleinanzeigen", 3, "autoscout24", 0.02),
    ]);
    expect(Object.fromEntries(groups)).toEqual({ 1: 1, 2: 1, 3: 3, 4: 3 });
  });

  it("returns nothing for no pairs and does not depend on input order", () => {
    expect(groupCandidates([]).size).toBe(0);
    const pairs = [pair(7, "a", 8, "b", 0.03), pair(8, "b", 9, "c", 0.01), pair(7, "a", 9, "c", 0.02)];
    expect(groupCandidates(pairs)).toEqual(groupCandidates([...pairs].reverse()));
  });

  it("uses a weak match (no place or only the year) when it is the only candidate on both sides", () => {
    // Autohero 7 matches AutoScout24 3 to the kilometre; 3 is also on Kleinanzeigen as 5.
    const groups = groupCandidates([pair(3, "autoscout24", 5, "kleinanzeigen", 0.02), pair(3, "autoscout24", 7, "autohero", 1, true)]);
    expect(Object.fromEntries(groups)).toEqual({ 3: 3, 5: 3, 7: 3 });
  });

  it("drops a weak match when a listing has a second candidate on the same portal", () => {
    // auto.de 9 fits two AutoScout24 listings: no guess.
    const groups = groupCandidates([pair(1, "autoscout24", 9, "autode", 0, true), pair(2, "autoscout24", 9, "autode", 0, true)]);
    expect(groups.size).toBe(0);
    // AutoScout24 1 fits two Quoka listings, one of them on a place-confirmed match: only that one stays.
    const mixed = groupCandidates([pair(1, "autoscout24", 4, "quoka", 0.05), pair(1, "autoscout24", 6, "quoka", 0, true)]);
    expect(Object.fromEntries(mixed)).toEqual({ 1: 1, 4: 1 });
  });

  it("joins weak pairs only after all place-confirmed ones, whatever their score", () => {
    // 1 (A) - 2 (B) - 3 (C) are confirmed by the place. 4 (A) fits 3 to the kilometre with the
    // lowest score, but A is already in the group by then, so 4 stays out.
    const groups = groupCandidates([pair(1, "a", 2, "b", 0.05), pair(2, "b", 3, "c", 0.05), pair(3, "c", 4, "a", 0, true)]);
    expect(Object.fromEntries(groups)).toEqual({ 1: 1, 2: 1, 3: 1 });
  });

  it("never links two different known months of first registration through a listing with only the year", async () => {
    // Quoka 1 (2019, year only) fits AutoScout24 2 (03/2019) and Kleinanzeigen 3 (11/2019).
    const withMonths = (p: CandidatePair, aMonth: string | null, bMonth: string | null) => ({ ...p, aMonth, bMonth });
    const groups = groupCandidates([
      withMonths(pair(1, "quoka", 2, "autoscout24", 0.01, true), null, "2019-03"),
      withMonths(pair(1, "quoka", 3, "kleinanzeigen", 0.02, true), null, "2019-11"),
    ]);
    // The closer pair wins; the other car stays on its own.
    expect(Object.fromEntries(groups)).toEqual({ 1: 1, 2: 1 });
    // The same month on both is fine.
    const same = groupCandidates([
      withMonths(pair(1, "quoka", 2, "autoscout24", 0.01, true), null, "2019-03"),
      withMonths(pair(1, "quoka", 3, "kleinanzeigen", 0.02, true), null, "2019-03"),
    ]);
    expect(Object.fromEntries(same)).toEqual({ 1: 1, 2: 1, 3: 1 });
  });
});
