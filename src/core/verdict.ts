import { DAMAGE_LABELS, type DamageKind } from "./damage";
import { DEAL_RULES, dealPercent, isTooCheap, type MarketConfidence } from "./deal";
import type { FlipSettings } from "./flip";
import type { InspectionBasis } from "./inspection";
import type { Difficulty } from "./repairs";
import type { SellerType } from "./types";

/**
 * Whether a listing is worth a look, in one word and a few reasons, from what AutoMeta knows
 * about it: the price against a trusted market value (src/core/deal.ts), damage named, the flip
 * calculation for a damaged car, the HU, and signs of room to bargain.
 *
 * - anschauen: intact, at least goodDealPct below a trusted market value, HU not run out
 * - schrauber: damage named, and the flip calculation leaves at least the flipper's minimum
 *   margin at a difficulty they take on (their settings)
 * - fair: about the market value
 * - eher_nicht: clearly above market value, too cheap to be true, HU run out on a car that is
 *   not a bargain, or damage whose repair eats the margin
 * - unklar: no market value, or one that cannot be trusted
 *
 * The search filter "urteil" (src/search/query.ts) asks the same in SQL for anschauen and
 * schrauber; keep the two in step.
 */
export const VERDICTS = ["anschauen", "schrauber", "fair", "eher_nicht", "unklar"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  anschauen: "Lohnt sich anzuschauen",
  schrauber: "Lohnt sich für Schrauber",
  fair: "Fairer Preis",
  eher_nicht: "Lohnt sich eher nicht",
  unklar: "Kein Urteil",
};

export const VERDICT_RULES = {
  /** At least this many percent below a trusted market value: worth a look. */
  goodDealPct: 10,
  /** At least this many percent above it: rather not. */
  overpricedPct: 10,
  /** An HU running out within this many months is a minus. */
  huSoonMonths: 6,
  /** An HU valid at least this many more months is a plus. */
  huLongMonths: 12,
  /** A price drop this recent is a sign the seller wants to sell. */
  recentDropDays: 14,
  /** Online this long (at least, as AutoMeta saw it): room to bargain. */
  longOnlineDays: 30,
  /** Model with this share of the HU defects of cars its age or less (Modell-Akte): a plus; the inverse a minus. */
  reliableRatio: 0.85,
  unreliableRatio: 1.15,
} as const;

/** The verdicts the search filter offers. */
export const VERDICT_FILTERS = ["anschauen", "schrauber"] as const;
export type VerdictFilter = (typeof VERDICT_FILTERS)[number];
export const VERDICT_FILTER_LABELS: Record<VerdictFilter, string> = {
  anschauen: "lohnt sich anzuschauen",
  schrauber: "lohnt sich für Schrauber",
};

export interface VerdictReason {
  text: string;
  tone: "plus" | "minus" | "info";
  /** What the reason is about, so a view that shows that fact elsewhere can leave it out. */
  kind: "price" | "market" | "damage" | "flip" | "hu" | "model" | "drop" | "online" | "seller";
}

export interface ListingVerdict {
  verdict: Verdict;
  /** The deciding reason first, then minuses, pluses and plain facts. */
  reasons: VerdictReason[];
}

export interface VerdictFacts {
  priceEur: number;
  marketPriceEur: number | null;
  marketComps: number | null;
  marketConfidence: MarketConfidence | null;
  damage: readonly DamageKind[];
  huUntil: string | null;
  huBasis: InspectionBasis | null;
  sellerType: SellerType | null;
  priceDroppedAt: string | null;
  priceBeforeDropEur: number | null;
  firstSeenAt: string;
  flip: { marginEur: number } | null;
  repair: { difficulty: Difficulty } | null;
  reliabilityRatio: number | null;
}

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const signedEuro = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${euro.format(Math.abs(value))}`;

/** Months from this month to the last valid month of an HU ("2027-07-01"); negative when run out. */
function huMonthsLeft(until: string, now: Date): number {
  const [year, month] = until.split("-").map(Number);
  return year * 12 + month - (now.getUTCFullYear() * 12 + now.getUTCMonth() + 1);
}

const monthYear = (until: string) => `${until.slice(5, 7)}/${until.slice(0, 4)}`;

const DOWNGRADE: Partial<Record<Verdict, Verdict>> = { anschauen: "fair", fair: "eher_nicht" };

export function listingVerdict(facts: VerdictFacts, settings: Pick<FlipSettings, "minMarginEur" | "level">, now = new Date()): ListingVerdict {
  const lead: VerdictReason[] = [];
  const minus: VerdictReason[] = [];
  const plus: VerdictReason[] = [];
  const info: VerdictReason[] = [];
  const damaged = facts.damage.length > 0;
  const market = facts.marketPriceEur;
  let verdict: Verdict;

  if (damaged) {
    lead.push({ text: `Schaden: ${facts.damage.map((kind) => DAMAGE_LABELS[kind]).join(", ")}`, tone: "minus", kind: "damage" });
    if (!facts.flip || !facts.repair) {
      verdict = "unklar";
      info.push({ text: "ohne Marktwert keine Flip-Rechnung", tone: "info", kind: "market" });
    } else if (facts.repair.difficulty > settings.level) {
      verdict = "eher_nicht";
      minus.push({ text: `Reparatur schwer (${facts.repair.difficulty}/5)`, tone: "minus", kind: "flip" });
    } else if (facts.flip.marginEur >= settings.minMarginEur) {
      verdict = "schrauber";
      plus.push({ text: `Flip ca. ${signedEuro(facts.flip.marginEur)}`, tone: "plus", kind: "flip" });
    } else {
      verdict = "eher_nicht";
      minus.push({ text: `Flip nur ca. ${signedEuro(facts.flip.marginEur)}`, tone: "minus", kind: "flip" });
    }
  } else if (market === null || market <= 0) {
    verdict = "unklar";
    lead.push({ text: "kein Marktwert: zu wenig ähnliche Angebote", tone: "info", kind: "market" });
  } else if (isTooCheap(facts)) {
    verdict = "eher_nicht";
    lead.push({ text: "über 50 % unter Marktwert: Betrug, Leasing oder versteckter Schaden?", tone: "minus", kind: "price" });
  } else if (facts.marketConfidence !== "high" && facts.marketConfidence !== "medium") {
    verdict = "unklar";
    lead.push({
      text:
        facts.marketComps !== null && facts.marketComps < DEAL_RULES.mediumComps
          ? `Marktwert unsicher: nur ${facts.marketComps} ähnliche Angebote`
          : "Marktwert unsicher: Preise weit gestreut",
      tone: "info",
      kind: "market",
    });
  } else {
    const percent = dealPercent({ ...facts, confidence: facts.marketConfidence })!;
    if (percent >= VERDICT_RULES.goodDealPct) {
      verdict = "anschauen";
      lead.push({ text: `${percent} % unter Marktwert`, tone: "plus", kind: "price" });
    } else if (percent <= -VERDICT_RULES.overpricedPct) {
      verdict = "eher_nicht";
      lead.push({ text: `${-percent} % über Marktwert`, tone: "minus", kind: "price" });
    } else {
      verdict = "fair";
      lead.push({ text: percent === 0 ? "genau Marktwert" : `etwa Marktwert (${percent > 0 ? "−" : "+"}${Math.abs(percent)} %)`, tone: "info", kind: "price" });
    }
  }

  // HU: run out costs money and time; a long one is worth something. A damaged car's flip already counts the HU.
  if (facts.huBasis === "expired" || (facts.huUntil !== null && huMonthsLeft(facts.huUntil, now) < 0)) {
    minus.push({ text: "HU abgelaufen", tone: "minus", kind: "hu" });
    if (!damaged) verdict = DOWNGRADE[verdict] ?? verdict;
  } else if (facts.huUntil !== null && facts.huBasis !== "relative") {
    const left = huMonthsLeft(facts.huUntil, now);
    if (left < VERDICT_RULES.huSoonMonths) minus.push({ text: `HU nur bis ${monthYear(facts.huUntil)}`, tone: "minus", kind: "hu" });
    else if (left >= VERDICT_RULES.huLongMonths) plus.push({ text: `HU bis ${monthYear(facts.huUntil)}`, tone: "plus", kind: "hu" });
  }

  if (facts.reliabilityRatio !== null) {
    if (facts.reliabilityRatio <= VERDICT_RULES.reliableRatio) plus.push({ text: "Modell mit wenig HU-Mängeln", tone: "plus", kind: "model" });
    else if (facts.reliabilityRatio >= VERDICT_RULES.unreliableRatio) minus.push({ text: "Modell mit vielen HU-Mängeln", tone: "minus", kind: "model" });
  }

  const day = 24 * 3600_000;
  if (facts.priceDroppedAt !== null && facts.priceBeforeDropEur !== null && now.getTime() - Date.parse(facts.priceDroppedAt) <= VERDICT_RULES.recentDropDays * day) {
    plus.push({ text: `Preis gerade um ${euro.format(facts.priceBeforeDropEur - facts.priceEur)} gesenkt`, tone: "plus", kind: "drop" });
  }
  const online = Math.floor((now.getTime() - Date.parse(facts.firstSeenAt)) / day);
  if (online >= VERDICT_RULES.longOnlineDays) plus.push({ text: `seit ${online} Tagen online: Verhandlungsspielraum`, tone: "plus", kind: "online" });

  if (facts.sellerType === "private") info.push({ text: "Privatverkauf", tone: "info", kind: "seller" });
  if (facts.sellerType === "dealer") info.push({ text: "Händler", tone: "info", kind: "seller" });

  return { verdict, reasons: [...lead, ...minus, ...plus, ...info] };
}
