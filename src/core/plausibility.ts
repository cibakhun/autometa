import { detectDamage } from "./damage";
import { isNotForSale, normalizeText } from "./normalize";
import { findModel, GENERATIONS } from "./taxonomy";
import type { NormalizedListing } from "./types";

/**
 * Checks every adapter applies to a normalized listing before it is stored: ads that offer no car
 * for sale or ask a placeholder price are left out, and a first registration or mileage that
 * cannot be right becomes unknown. The same rules review the listings already stored (see
 * src/ingest/review.ts); bump LISTING_RULES_VERSION when one of them changes, so they do.
 */
export const LISTING_RULES_VERSION = 1;

export type Rejection = "not_for_sale" | "placeholder_price" | "implausible_price";

/** The facts the rules look at, as a normalized or a stored listing has them. */
export type ListingFacts = Pick<
  NormalizedListing,
  "title" | "priceEur" | "mileageKm" | "firstRegistration" | "powerKw" | "makeSlug" | "modelSlug"
>;

export interface Verdict {
  /** Why the listing is no car offered at a real price, or null when it is. */
  rejection: Rejection | null;
  /** The first registration, or null when it cannot be right. */
  firstRegistration: string | null;
  /** The mileage, or null when it cannot be right. */
  mileageKm: number | null;
}

/** From this price on, a young everyday car is a typo or a placeholder. */
const MILLION_EUR = 1_000_000;
/** Cars with this much power may be hypercars worth millions (AMG ONE, 918 Spyder, LFA). */
const HYPERCAR_KW = 300;
/** Cars first registered this many years ago or earlier may be classics worth millions (BMW 507). */
const CLASSIC_YEARS = 25;
/** A car this young (months since first registration) is an everyday car of today. */
const YOUNG_MONTHS = 36;
/** Below this mileage a car is new or nearly new. */
const NEW_CAR_KM = 5000;
/**
 * No car under four years sells for less than this unless it is damaged or worn out (compare
 * src/core/inspection.ts). An undamaged one at a lower price has a wrong first registration, typed
 * by the seller ("Ford Fiesta 1.3 | TÜV 11/2028", EZ 05/2023 for 1,850 €).
 */
const YOUNG_CAR_MIN_PRICE_EUR = 3000;
const YOUNG_CAR_MONTHS = 48;
/** From this mileage on, even a young car may be cheap (a taxi, a courier's car). */
const WORN_OUT_KM = 150_000;
/** Cars may be first registered this long after their last year of production (stock, imports). */
const LATE_REGISTRATION_YEARS = 2;
/** 0 km on a car registered this many months ago or earlier means the seller left the field empty. */
const USED_CAR_MONTHS = 12;

/** The first day of the month `offset` months from now's month, as YYYY-MM-01 (UTC). */
function monthStart(now: Date, offset = 0): string {
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() + offset;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/**
 * Prices sellers type when they do not want to name one: runs of 1234… (from 1,234 €) and the
 * same digit seven times or more (9,999,999 €). Six equal digits (999,999 €) only for a car that
 * cannot be a hypercar or a classic; such a car may well cost that much.
 */
export function isPlaceholderPrice(priceEur: number, collectible = false): boolean {
  const digits = String(priceEur);
  if (priceEur >= 1234 && "123456789".startsWith(digits)) return true;
  if (!/^(\d)\1+$/.test(digits)) return false;
  return digits.length >= 7 || (digits.length === 6 && !collectible);
}

function isClassic(firstRegistration: string | null, now: Date): boolean {
  return firstRegistration !== null && firstRegistration < monthStart(now, -12 * CLASSIC_YEARS);
}

function isCollectible(facts: ListingFacts, now: Date): boolean {
  return (facts.powerKw !== null && facts.powerKw >= HYPERCAR_KW) || isClassic(facts.firstRegistration, now);
}

/**
 * A million euros or more for a young everyday car: new or nearly new (first registered in the
 * last three years, not yet registered, or under 5,000 km) and under 300 kW. Typos like 2,992,661 €
 * for a new Ford Puma (29,926.61 €). Hypercars and classics stay, and so does a car whose power
 * is not known: dropping a real offer is worse than keeping a typo.
 */
export function isImplausiblePrice(facts: ListingFacts, now = new Date()): boolean {
  if (facts.priceEur < MILLION_EUR || facts.powerKw === null || isCollectible(facts, now)) return false;
  const young = facts.firstRegistration === null || facts.firstRegistration >= monthStart(now, -YOUNG_MONTHS);
  return young || (facts.mileageKm !== null && facts.mileageKm < NEW_CAR_KM);
}

/** Months and years a title names as the HU/TÜV date: "TÜV 11/2028", "HU/AU bis 05.27". */
function inspectionMonths(title: string): string[] {
  const text = normalizeText(title);
  const months: string[] = [];
  for (const match of text.matchAll(/\b(?:tuv|tuev|hu)(?: au)?(?: neu)?(?: bis| gultig bis| bis ende)? (\d{1,2}) (\d{4}|\d{2})\b/g)) {
    const month = Number(match[1]);
    const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
    if (month >= 1 && month <= 12) months.push(`${year}-${String(month).padStart(2, "0")}-01`);
  }
  return months;
}

/** The title as generation codes are matched: lower case, accents removed, punctuation kept. */
function generationText(title: string): string {
  return title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");
}

/**
 * The last year the car can have been built, from its model (a model no longer made, like the
 * Renault 19) or a generation code in its title ("997.1", "E46", "Golf 4"); null when neither
 * says. Codes of two generations ("E46 mit E36-Motor") say nothing.
 */
export function builtUntil(makeSlug: string | null, modelSlug: string | null, title: string): number | null {
  if (!makeSlug) return null;
  const ends: number[] = [];
  const modelEnd = modelSlug ? findModel(makeSlug, modelSlug)?.until : undefined;
  if (modelEnd !== undefined) ends.push(modelEnd);
  const text = generationText(title);
  const hits = GENERATIONS.filter((g) => g.make === makeSlug && (!g.model || g.model === modelSlug) && g.pattern.test(text));
  if (new Set(hits.map((hit) => hit.family)).size === 1) {
    for (const hit of hits) if (hit.until !== null) ends.push(hit.until);
  }
  return ends.length > 0 ? Math.min(...ends) : null;
}

/**
 * The first registration, or null when it cannot be right: after next month (AutoScout24 lists
 * some new cars with 2027), the HU date the title names ("TÜV 05/2026" with EZ 05/2026), years
 * after the model or generation was last built ("Porsche 911 Carrera 4S 997.1", EZ 08/2025), or
 * the last four years for an undamaged car under 3,000 € and 150,000 km.
 */
export function plausibleRegistration(
  facts: Pick<ListingFacts, "title" | "priceEur" | "mileageKm" | "firstRegistration" | "makeSlug" | "modelSlug">,
  now = new Date(),
): string | null {
  const registration = facts.firstRegistration;
  if (!registration) return null;
  if (registration > monthStart(now, 1)) return null;
  if (inspectionMonths(facts.title).includes(registration)) return null;
  const until = builtUntil(facts.makeSlug, facts.modelSlug, facts.title);
  if (until !== null && Number(registration.slice(0, 4)) > until + LATE_REGISTRATION_YEARS) return null;
  if (
    facts.priceEur > 0 &&
    facts.priceEur < YOUNG_CAR_MIN_PRICE_EUR &&
    registration >= monthStart(now, -YOUNG_CAR_MONTHS) &&
    (facts.mileageKm === null || facts.mileageKm < WORN_OUT_KM) &&
    detectDamage(facts.title).length === 0
  ) {
    return null;
  }
  return registration;
}

/** 0 km on a car registered a year ago or earlier is an empty field, not a new car: unknown. */
export function plausibleMileage(mileageKm: number | null, firstRegistration: string | null, now = new Date()): number | null {
  if (mileageKm === 0 && firstRegistration !== null && firstRegistration < monthStart(now, -USED_CAR_MONTHS)) return null;
  return mileageKm;
}

/** What the rules make of a listing's facts. The mileage is judged with the corrected first registration. */
export function judgeListing(facts: ListingFacts, now = new Date()): Verdict {
  const firstRegistration = plausibleRegistration(facts, now);
  const mileageKm = plausibleMileage(facts.mileageKm, firstRegistration, now);
  const checked = { ...facts, firstRegistration, mileageKm };
  let rejection: Rejection | null = null;
  if (isNotForSale(facts.title)) rejection = "not_for_sale";
  else if (isPlaceholderPrice(facts.priceEur, isCollectible(checked, now))) rejection = "placeholder_price";
  else if (isImplausiblePrice(checked, now)) rejection = "implausible_price";
  return { rejection, firstRegistration, mileageKm };
}

/** The listing with the rules applied, or null when it is to be left out. Every adapter ends with this. */
export function plausibleListing(listing: NormalizedListing, now = new Date()): NormalizedListing | null {
  const verdict = judgeListing(listing, now);
  if (verdict.rejection) return null;
  return {
    ...listing,
    firstRegistration: verdict.firstRegistration,
    firstRegistrationYearOnly: verdict.firstRegistration !== null && listing.firstRegistrationYearOnly === true,
    mileageKm: verdict.mileageKm,
  };
}
