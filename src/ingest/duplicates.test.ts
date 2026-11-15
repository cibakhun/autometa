import { describe, expect, it } from "vitest";
import { groupCandidates, type CandidatePair } from "./duplicates";

const pair = (a: number, aSource: string, b: number, bSource: string, score = 0.01): CandidatePair => ({ a, b, aSource, bSource, score });

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
});
