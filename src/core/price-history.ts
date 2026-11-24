/**
 * What a listing's price history and age tell a buyer: how often and by how much the price changed,
 * and how long the listing has been online. Pure functions over what the database keeps
 * (listing_prices, first_seen_at, listed_on), so the page and the tests read them the same way.
 */

/** One price a listing had and when AutoMeta first saw it (ISO timestamp). */
export interface PricePoint {
  priceEur: number;
  seenAt: string;
}

export interface PriceChange {
  at: string;
  fromEur: number;
  toEur: number;
}

export interface PriceStory {
  /** The first price AutoMeta saw and when. */
  firstEur: number;
  firstSeenAt: string;
  /** Every change, oldest first. */
  changes: PriceChange[];
  drops: number;
  raises: number;
  /** Price now minus the first price: negative when it got cheaper. */
  totalEur: number;
  /** The latest drop, if any. */
  lastDrop: PriceChange | null;
  /** Since when the price is what it is now. */
  currentSince: string;
}

/** The story of a price history (oldest first); null without any price. Repeated prices are no change. */
export function priceStory(history: PricePoint[]): PriceStory | null {
  if (history.length === 0) return null;
  const changes: PriceChange[] = [];
  let current = history[0];
  for (const point of history.slice(1)) {
    if (point.priceEur === current.priceEur) continue;
    changes.push({ at: point.seenAt, fromEur: current.priceEur, toEur: point.priceEur });
    current = point;
  }
  const drops = changes.filter((c) => c.toEur < c.fromEur);
  return {
    firstEur: history[0].priceEur,
    firstSeenAt: history[0].seenAt,
    changes,
    drops: drops.length,
    raises: changes.length - drops.length,
    totalEur: current.priceEur - history[0].priceEur,
    lastDrop: drops.at(-1) ?? null,
    currentSince: changes.at(-1)?.at ?? history[0].seenAt,
  };
}

const DAY_MS = 24 * 3600_000;
const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

/** The calendar day in Germany of a moment, YYYY-MM-DD. */
export const germanDay = (iso: string) => berlinDay.format(Date.parse(iso));

/** Whole calendar days from one day (YYYY-MM-DD) to another. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export interface OnlineSpan {
  /** First day online, YYYY-MM-DD. */
  since: string;
  /** "portal": the portal's own date; "autometa": the day AutoMeta first saw it, so at least that long. */
  basis: "portal" | "autometa";
  /** Last day online for a listing that is gone, else null. */
  until: string | null;
  /** Whole days from since to until or today. */
  days: number;
}

/**
 * How long a listing has been online: from the day the portal names, or else from the day AutoMeta
 * first saw it (a lower bound: it may have been online before), to today or the day it left.
 */
export function onlineSpan(listing: {
  listedOn: string | null;
  firstSeenAt: string;
  /** When it left the search; null while active. */
  endedAt: string | null;
  /** Now, as the database saw it. */
  asOf: string;
}): OnlineSpan {
  const seen = germanDay(listing.firstSeenAt);
  const portal = listing.listedOn !== null && listing.listedOn <= seen;
  const since = portal ? listing.listedOn! : seen;
  const until = listing.endedAt ? germanDay(listing.endedAt) : null;
  return { since, basis: portal ? "portal" : "autometa", until, days: Math.max(0, daysBetween(since, until ?? germanDay(listing.asOf))) };
}
