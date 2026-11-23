import { formatKm, formatNumber, formatPrice, formatSignedPrice } from "@/lib/format";
import type { ListingSummary } from "@/search/query";
import type { PushPayload } from "./push";

/** Night rest for pushes: 22:00 to 7:00 German time. */
export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 7;

const berlinHour = new Intl.DateTimeFormat("de-DE", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Berlin" });

export function isQuietTime(at: Date): boolean {
  // formatToParts: German formats a bare hour as "22 Uhr".
  const hour = Number(berlinHour.formatToParts(at).find((part) => part.type === "hour")?.value);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

/** "Golf 1.4 TSI · 2.500 € (vorher 2.900 €) · 180.000 km · Berlin · Flip +1.200 €" */
export function listingLine(listing: ListingSummary, since?: string): string {
  const dropped = listing.priceDroppedAt !== null && listing.priceBeforeDropEur !== null && (!since || listing.priceDroppedAt > since);
  const parts = [
    listing.title,
    formatPrice(listing.priceEur) + (dropped ? ` (vorher ${formatPrice(listing.priceBeforeDropEur!)})` : ""),
    listing.mileageKm !== null ? formatKm(listing.mileageKm) : null,
    listing.city,
    listing.flip && listing.flip.marginEur > 0 ? `Flip ${formatSignedPrice(listing.flip.marginEur)}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * The push for a saved search: what is new (or cheaper) since the last one. One vehicle opens its
 * page, several open the search with only the new ones.
 */
export function searchAlert(
  search: { id: number; name: string },
  total: number,
  top: ListingSummary[],
  since: string,
): PushPayload {
  // The shown vehicles tell whether they came in new or matched because their price went down.
  const cheaper = top.filter((item) => item.priceDroppedAt !== null && item.priceDroppedAt > since).length;
  const what = cheaper === 0 ? "neu" : cheaper === top.length ? "günstiger" : "neu oder günstiger";
  const lines = top.slice(0, 3).map((item) => listingLine(item, since));
  if (total > lines.length) lines.push(`und ${formatNumber(total - lines.length)} weitere`);
  return {
    title: `${formatNumber(total)} ${what}: ${search.name}`,
    body: lines.join("\n"),
    url: total === 1 && top[0] ? `/angebot/${top[0].id}` : `/suchauftraege/${search.id}/neu?ab=${encodeURIComponent(since)}`,
    tag: `suche-${search.id}`,
  };
}

export interface FavoriteChange {
  listingId: number;
  title: string;
  priceEur: number;
  /** Price the last push named (or the price when saved). */
  previousEur: number;
  gone: boolean;
}

/** The push for the watch list: cheaper or gone since the last one. */
export function favoritesAlert(changes: FavoriteChange[]): PushPayload {
  const gone = changes.filter((change) => change.gone);
  const cheaper = changes.filter((change) => !change.gone);
  const title =
    gone.length === 0
      ? cheaper.length === 1
        ? "Merkliste: Preis gesenkt"
        : `Merkliste: ${cheaper.length} Preise gesenkt`
      : cheaper.length === 0
        ? gone.length === 1
          ? "Merkliste: Anzeige nicht mehr online"
          : `Merkliste: ${gone.length} Anzeigen nicht mehr online`
        : `Merkliste: ${changes.length} Änderungen`;
  const lines = [
    ...cheaper.map((change) => `${change.title}: ${formatPrice(change.previousEur)} → ${formatPrice(change.priceEur)}`),
    ...gone.map((change) => `${change.title}: nicht mehr online`),
  ];
  const shown = lines.slice(0, 4);
  if (lines.length > shown.length) shown.push(`und ${lines.length - shown.length} weitere`);
  return {
    title,
    body: shown.join("\n"),
    url: changes.length === 1 ? `/angebot/${changes[0].listingId}` : "/merkliste",
    tag: "merkliste",
  };
}
