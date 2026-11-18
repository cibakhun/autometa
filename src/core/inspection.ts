import { normalizeText } from "./normalize";

/**
 * Where a listing's HU/TÜV date comes from:
 * - stated: the listing names a month or year ("TÜV 05/2027", "HU bis 2026")
 * - relative: the listing says "TÜV neu" or "2 Jahre TÜV"; counted from when we first saw it
 * - registration: nothing stated, but the car is younger than 3 years, and a new car's first
 *   HU is due 36 months after its first registration
 * - expired: the listing says the HU ran out ("TÜV abgelaufen", "ohne TÜV")
 */
export const INSPECTION_BASES = ["stated", "relative", "registration", "expired"] as const;
export type InspectionBasis = (typeof INSPECTION_BASES)[number];

export interface Inspection {
  /** First day of the last month the HU is valid (YYYY-MM-01); null when expired. */
  until: string | null;
  basis: InspectionBasis;
}

/** The new car's first HU is due this many months after the first registration. */
const FIRST_INSPECTION_MONTHS = 36;
/** A fresh HU lasts this long. */
const FRESH_INSPECTION_MONTHS = 24;

const KEY = String.raw`(?:tuv|tuev|hu)(?: au)?`;
// Words that may stand between the keyword and "neu", as in "TÜV und Service neu".
const JOINED = String.raw`(?: (?:und|u|service|inspektion|insp|au|asu)){0,2}`;
const EXPIRED = new RegExp(
  String.raw`\b(?:ohne|kein|keine|keinen) (?:tuv|tuev|hu)\b|\b${KEY} (?:ist )?(?:abgelaufen|fallig|faellig|uberfallig|ueberfallig)\b`,
);
const MONTH = new RegExp(String.raw`\b${KEY} (?:neu )?(?:bis |gultig bis |gueltig bis |bis zum |bis ende )?(\d{1,2}) (\d{4}|\d{2})\b`);
const YEAR = new RegExp(String.raw`\b${KEY} (?:neu )?(?:bis |bis ende )?(20\d{2})\b`);
const FRESH = new RegExp(String.raw`\b${KEY}${JOINED} (?:neu|frisch)\b|\b(?:neue|neuer|neuen|neuem|frische|frischer|frischen) (?:tuv|tuev|hu)\b`);
const YEARS = new RegExp(String.raw`\b${KEY} (?:fur |noch )?(1|2|ein|eine|zwei) jahre?\b|\b(1|2|ein|zwei) jahre? ${KEY}\b`);
const MONTHS = new RegExp(String.raw`\b${KEY} (?:fur |noch )?(\d{1,2}) monate?\b`);

const monthStart = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-01`;

function addMonths(date: Date, months: number): string {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  return monthStart(Math.floor(total / 12), (total % 12) + 1);
}

/**
 * The HU/TÜV validity a listing's title states, else the one its first registration implies.
 * Null when neither says anything. `now` is when the listing was seen.
 */
export function detectInspection(title: string, firstRegistration: string | null, now = new Date()): Inspection | null {
  const text = normalizeText(title);
  const thisYear = now.getUTCFullYear();

  if (EXPIRED.test(text)) return { until: null, basis: "expired" };

  const month = text.match(MONTH);
  if (month) {
    const m = Number(month[1]);
    const year = month[2].length === 2 ? 2000 + Number(month[2]) : Number(month[2]);
    if (m >= 1 && m <= 12 && year >= thisYear - 10 && year <= thisYear + 4) return { until: monthStart(year, m), basis: "stated" };
  }
  const year = text.match(YEAR);
  // "TÜV 2027" says the HU runs out some time in 2027: January is the safe reading.
  if (year && Number(year[1]) >= thisYear - 10 && Number(year[1]) <= thisYear + 4) return { until: monthStart(Number(year[1]), 1), basis: "stated" };

  if (FRESH.test(text)) return { until: addMonths(now, FRESH_INSPECTION_MONTHS), basis: "relative" };
  const years = text.match(YEARS);
  if (years) {
    const count = /^(1|ein|eine)$/.test(years[1] ?? years[2]) ? 1 : 2;
    return { until: addMonths(now, count * 12), basis: "relative" };
  }
  const months = text.match(MONTHS);
  if (months && Number(months[1]) >= 1 && Number(months[1]) <= FRESH_INSPECTION_MONTHS) {
    return { until: addMonths(now, Number(months[1])), basis: "relative" };
  }

  if (firstRegistration) {
    const registered = new Date(`${firstRegistration}T00:00:00Z`);
    if (!Number.isNaN(registered.getTime())) {
      const until = addMonths(registered, FIRST_INSPECTION_MONTHS);
      if (until >= monthStart(thisYear, now.getUTCMonth() + 1)) return { until, basis: "registration" };
    }
  }
  return null;
}
