import type { DamageKind } from "./damage";

/**
 * How far a listing's market value can be trusted, and whether its price is a deal.
 *
 * The market value is the median of comparable intact listings (src/ingest/market.ts). It is
 * close for common cars: about 10 % off in the middle for Golf, Octavia, 3er and C-Klasse
 * (measured live 2026-11-26). It is not for rare, old or exotic cars, where a handful of
 * comparable listings spread over half the price range or more. A price far below such a market
 * value says more about the comparison than about the price.
 *
 * And far below even a trusted market value, an intact car is rarely a bargain: live, nearly all
 * listings more than half below it were scams ("Golf 7 2019 FESTPREIS!!! 2.500 €"), leasing
 * takeovers whose price is a fee, parts or cars with damage the title does not name. They are
 * shown with a warning and never ranked as deals.
 *
 * src/ingest/market.ts stores both as columns (market_confidence, deal_pct) in the same terms;
 * keep the two in step.
 */
export const DEAL_RULES = {
  /** High confidence: at least this many comparable listings ... */
  highComps: 20,
  /** ... whose middle half spans at most this share of the market value. */
  highSpread: 0.4,
  mediumComps: 10,
  mediumSpread: 0.6,
  /** An intact car this share of its market value or less is "too cheap to be true". */
  tooCheapShare: 0.5,
} as const;

export const MARKET_CONFIDENCES = ["high", "medium", "low"] as const;
export type MarketConfidence = (typeof MARKET_CONFIDENCES)[number];

export const MARKET_CONFIDENCE_LABELS: Record<MarketConfidence, string> = {
  high: "verlässlich",
  medium: "brauchbar",
  low: "unsicher",
};

export interface MarketFacts {
  marketPriceEur: number | null;
  marketLowEur: number | null;
  marketHighEur: number | null;
  marketComps: number | null;
}

/** How far the market value can be trusted; null without one. */
export function marketConfidence(facts: MarketFacts): MarketConfidence | null {
  const { marketPriceEur: market, marketLowEur: low, marketHighEur: high, marketComps: comps } = facts;
  if (market === null || market <= 0) return null;
  if (comps === null || low === null || high === null) return "low";
  const spread = (high - low) / market;
  if (comps >= DEAL_RULES.highComps && spread <= DEAL_RULES.highSpread) return "high";
  if (comps >= DEAL_RULES.mediumComps && spread <= DEAL_RULES.mediumSpread) return "medium";
  return "low";
}

export interface PriceFacts {
  priceEur: number;
  marketPriceEur: number | null;
  damage: readonly DamageKind[];
}

/** An intact car at half its market value or less: almost always something else than a bargain. */
export function isTooCheap({ priceEur, marketPriceEur, damage }: PriceFacts): boolean {
  return damage.length === 0 && marketPriceEur !== null && marketPriceEur > 0 && priceEur <= marketPriceEur * DEAL_RULES.tooCheapShare;
}

/**
 * How many percent below its market value an intact listing is offered (negative: above), when
 * that comparison can be trusted; null when it cannot: damage named (the market value is that of
 * an intact car), an unsure market value, or a price too far below it to be true.
 */
export function dealPercent(facts: PriceFacts & { confidence: MarketConfidence | null }): number | null {
  const { priceEur, marketPriceEur, damage, confidence } = facts;
  if (marketPriceEur === null || marketPriceEur <= 0 || damage.length > 0) return null;
  if (confidence !== "high" && confidence !== "medium") return null;
  if (isTooCheap(facts)) return null;
  return Math.round(((marketPriceEur - priceEur) * 100) / marketPriceEur);
}

/** The deal filter: at least this many percent below a trusted market value. */
export const DEAL_FILTERS = ["10", "20", "30"] as const;
export type DealFilter = (typeof DEAL_FILTERS)[number];
export const DEAL_FILTER_LABELS: Record<DealFilter, string> = {
  "10": "mind. 10 % unter Marktwert",
  "20": "mind. 20 % unter Marktwert",
  "30": "mind. 30 % unter Marktwert",
};
