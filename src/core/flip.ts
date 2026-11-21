import { z } from "zod";
import type { Difficulty } from "./repairs";

/**
 * Flip calculation: what a damaged car might earn after repairing it yourself.
 *
 *   sale price  = market value of intact comparables × (1 − negotiation discount)
 *   margin      = sale price − purchase price − parts − side costs
 *   per hour    = margin / working hours
 *
 * Side costs are flat amounts: HU, registration and either driving the car home or towing it.
 * Everything uses the middle of the parts and hours ranges; the margin range comes from the
 * parts range. Hidden damage is not priced in yet (planned: defect profiles per model).
 */

export interface FlipSettings {
  /** Highest difficulty (1 to 5) the flipper takes on; the default filter of the flip list. */
  level: Difficulty;
  /** Discount on the asking prices of comparable cars when selling, in percent. */
  discountPct: number;
  huEur: number;
  /** Getting a drivable car home (fuel, train ticket, short-term plates). */
  transportEur: number;
  /** Towing or a trailer for a car that does not drive. */
  towEur: number;
  /** Registering and deregistering for the resale. */
  registrationEur: number;
  /** Smallest margin worth the work; the default filter of the flip list. */
  minMarginEur: number;
}

export const DEFAULT_FLIP_SETTINGS: FlipSettings = {
  level: 3,
  discountPct: 7,
  huEur: 140,
  transportEur: 150,
  towEur: 300,
  registrationEur: 60,
  minMarginEur: 1000,
};

const euros = (fallback: number) => z.coerce.number().int().min(0).max(100_000).catch(fallback);

/** Lenient: an invalid or missing value falls back to its default. */
export const flipSettingsSchema = z.object({
  level: z.coerce.number().int().min(1).max(5).catch(DEFAULT_FLIP_SETTINGS.level),
  discountPct: z.coerce.number().min(0).max(50).catch(DEFAULT_FLIP_SETTINGS.discountPct),
  huEur: euros(DEFAULT_FLIP_SETTINGS.huEur),
  transportEur: euros(DEFAULT_FLIP_SETTINGS.transportEur),
  towEur: euros(DEFAULT_FLIP_SETTINGS.towEur),
  registrationEur: euros(DEFAULT_FLIP_SETTINGS.registrationEur),
  minMarginEur: euros(DEFAULT_FLIP_SETTINGS.minMarginEur),
});

export function parseFlipSettings(value: unknown): FlipSettings {
  const input = value && typeof value === "object" ? value : {};
  return flipSettingsSchema.parse(input) as FlipSettings;
}

export function sideCosts(settings: FlipSettings, needsTow: boolean): number {
  return settings.huEur + settings.registrationEur + (needsTow ? settings.towEur : settings.transportEur);
}

export interface FlipInput {
  purchaseEur: number;
  /** Asking price of comparable intact cars (the market value). */
  marketEur: number;
  partsEur: [number, number];
  hours: [number, number];
  needsTow: boolean;
}

export interface FlipResult {
  salePriceEur: number;
  sideCostsEur: number;
  marginEur: number;
  /** Margin with the most and the least expensive parts. */
  marginRangeEur: [number, number];
  hours: number;
  /** Margin per working hour; null without hours. */
  perHourEur: number | null;
}

const round10 = (value: number) => Math.round(value / 10) * 10;

export function calculateFlip(input: FlipInput, settings: FlipSettings): FlipResult {
  const salePrice = input.marketEur * (1 - settings.discountPct / 100);
  const side = sideCosts(settings, input.needsTow);
  const base = salePrice - input.purchaseEur - side;
  const parts = (input.partsEur[0] + input.partsEur[1]) / 2;
  const hours = (input.hours[0] + input.hours[1]) / 2;
  const margin = base - parts;
  return {
    salePriceEur: round10(salePrice),
    sideCostsEur: side,
    marginEur: round10(margin),
    marginRangeEur: [round10(base - input.partsEur[1]), round10(base - input.partsEur[0])],
    hours,
    perHourEur: hours > 0 ? Math.round(margin / hours) : null,
  };
}
