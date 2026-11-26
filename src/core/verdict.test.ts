import { describe, expect, it } from "vitest";
import { DEFAULT_FLIP_SETTINGS } from "./flip";
import { listingVerdict, type VerdictFacts } from "./verdict";

const NOW = new Date("2026-11-26T22:00:00Z");

const listing = (extra: Partial<VerdictFacts> = {}): VerdictFacts => ({
  priceEur: 10_000,
  marketPriceEur: 10_000,
  marketComps: 30,
  marketConfidence: "high",
  damage: [],
  huUntil: null,
  huBasis: null,
  sellerType: null,
  priceDroppedAt: null,
  priceBeforeDropEur: null,
  firstSeenAt: "2026-11-20T10:00:00Z",
  flip: null,
  repair: null,
  reliabilityRatio: null,
  ...extra,
});

const judge = (extra: Partial<VerdictFacts> = {}) => listingVerdict(listing(extra), DEFAULT_FLIP_SETTINGS, NOW);
const texts = (extra: Partial<VerdictFacts> = {}) => judge(extra).reasons.map((reason) => reason.text);

describe("listingVerdict", () => {
  it("is worth a look at least 10 % below a trusted market value", () => {
    expect(judge({ priceEur: 9000 })).toEqual({ verdict: "anschauen", reasons: [{ text: "10 % unter Marktwert", tone: "plus", kind: "price" }] });
    expect(judge({ priceEur: 8200, marketConfidence: "medium" }).verdict).toBe("anschauen");
  });

  it("calls a price near the market value fair, and one clearly above it rather not", () => {
    expect(judge({ priceEur: 9600 })).toMatchObject({ verdict: "fair", reasons: [{ text: "etwa Marktwert (−4 %)" }] });
    expect(judge({ priceEur: 10_500 })).toMatchObject({ verdict: "fair", reasons: [{ text: "etwa Marktwert (+5 %)" }] });
    expect(judge({ priceEur: 10_000 }).reasons[0].text).toBe("genau Marktwert");
    expect(judge({ priceEur: 11_000 })).toMatchObject({ verdict: "eher_nicht", reasons: [{ text: "10 % über Marktwert", tone: "minus" }] });
  });

  it("warns instead of praising a car too cheap to be true", () => {
    expect(judge({ priceEur: 4000 })).toMatchObject({ verdict: "eher_nicht", reasons: [{ tone: "minus" }] });
    expect(texts({ priceEur: 4000 })[0]).toMatch(/^über 50 % unter Marktwert/);
  });

  it("gives no verdict without a market value or with an unsure one", () => {
    expect(judge({ marketPriceEur: null, marketConfidence: null })).toMatchObject({ verdict: "unklar" });
    expect(texts({ priceEur: 8000, marketConfidence: "low", marketComps: 6 })[0]).toBe("Marktwert unsicher: nur 6 ähnliche Angebote");
    expect(texts({ priceEur: 8000, marketConfidence: "low", marketComps: 40 })[0]).toBe("Marktwert unsicher: Preise weit gestreut");
  });

  it("judges a damaged car by the flip calculation and the flipper's settings", () => {
    const repair = { difficulty: 2 as const };
    const damaged = { damage: ["engine" as const], priceEur: 3000, repair };
    expect(judge({ ...damaged, flip: { marginEur: 1500 } })).toEqual({
      verdict: "schrauber",
      reasons: [
        { text: "Schaden: Motorschaden", tone: "minus", kind: "damage" },
        { text: "Flip ca. +1.500\u00a0€", tone: "plus", kind: "flip" },
      ],
    });
    expect(judge({ ...damaged, flip: { marginEur: 400 } })).toMatchObject({ verdict: "eher_nicht", reasons: [{}, { text: "Flip nur ca. +400\u00a0€" }] });
    expect(judge({ ...damaged, flip: { marginEur: -800 } }).reasons[1].text).toBe("Flip nur ca. −800\u00a0€");
    expect(judge({ ...damaged, flip: { marginEur: 3000 }, repair: { difficulty: 5 } })).toMatchObject({
      verdict: "eher_nicht",
      reasons: [{}, { text: "Reparatur schwer (5/5)" }],
    });
    expect(judge({ ...damaged, flip: null }).verdict).toBe("unklar");
    // A flipper who takes on more, or wants less, gets another verdict.
    expect(listingVerdict(listing({ ...damaged, flip: { marginEur: 400 } }), { minMarginEur: 300, level: 3 }, NOW).verdict).toBe("schrauber");
  });

  it("takes an HU that ran out off a bargain, and counts a long one as a plus", () => {
    expect(judge({ priceEur: 8500, huBasis: "expired" })).toMatchObject({ verdict: "fair", reasons: [{}, { text: "HU abgelaufen", tone: "minus" }] });
    expect(judge({ priceEur: 8500, huUntil: "2026-10-01", huBasis: "stated" }).verdict).toBe("fair");
    expect(judge({ priceEur: 10_000, huBasis: "expired" }).verdict).toBe("eher_nicht");
    expect(judge({ priceEur: 8500, huUntil: "2026-11-01", huBasis: "stated" }).verdict).toBe("anschauen");
    expect(texts({ priceEur: 8500, huUntil: "2027-03-01", huBasis: "stated" })).toContain("HU nur bis 03/2027");
    expect(texts({ priceEur: 8500, huUntil: "2028-07-01", huBasis: "stated" })).toContain("HU bis 07/2028");
    // "TÜV neu" counted from the first sighting is no date to boast with.
    expect(texts({ priceEur: 8500, huUntil: "2028-07-01", huBasis: "relative" })).toHaveLength(1);
  });

  it("names signs of room to bargain, the model's defects and the seller", () => {
    const reasons = texts({
      priceEur: 8500,
      priceDroppedAt: "2026-11-20T08:00:00Z",
      priceBeforeDropEur: 9000,
      firstSeenAt: "2026-10-10T08:00:00Z",
      reliabilityRatio: 0.8,
      sellerType: "private",
    });
    expect(reasons).toEqual([
      "15 % unter Marktwert",
      "Modell mit wenig HU-Mängeln",
      "Preis gerade um 500\u00a0€ gesenkt",
      "seit 47 Tagen online: Verhandlungsspielraum",
      "Privatverkauf",
    ]);
    expect(texts({ priceDroppedAt: "2026-10-01T08:00:00Z", priceBeforeDropEur: 11_000 })).toEqual(["genau Marktwert"]);
    expect(judge({ reliabilityRatio: 1.3 }).reasons[1]).toEqual({ text: "Modell mit vielen HU-Mängeln", tone: "minus", kind: "model" });
  });
});
