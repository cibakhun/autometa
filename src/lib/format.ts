import type { InspectionBasis } from "@/core/inspection";
import { kwToPs } from "@/core/normalize";

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("de-DE");

/** An amount of money that is not a listing price, so 0 € stays "0 €". */
export const formatEuro = (eur: number) => euro.format(eur);

/** 0 € means the car is given away (Kleinanzeigen "Zu verschenken"). */
export const formatPrice = (eur: number) => (eur === 0 ? "Zu verschenken" : euro.format(eur));

export const formatNumber = (value: number) => integer.format(value);

/** A gain or loss: "+1.310 €", "−450 €", "0 €". */
export const formatSignedPrice = (eur: number) => (eur > 0 ? "+" : eur < 0 ? "−" : "") + euro.format(Math.abs(eur));

const dayAndTime = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

/** "21.11., 14:05" in German time. */
export const formatDayTime = (iso: string) => dayAndTime.format(new Date(iso));

/** Share of listings as a whole percent, rounded down so "100 %" means all of them: "97 %". */
export const formatShare = (share: number) => `${Math.floor(share * 100)}\u00a0%`;

export const formatKm = (km: number | null) => (km === null ? "km unbekannt" : `${integer.format(km)} km`);

/** "2019-04-01" -> "04/2019" */
export function formatRegistration(isoDate: string | null): string {
  if (!isoDate) return "EZ unbekannt";
  const [year, month] = isoDate.split("-");
  return `EZ ${month}/${year}`;
}

export const formatPower = (kw: number | null) => (kw === null ? null : `${kw} kW (${kwToPs(kw)} PS)`);

export const formatDistance = (km: number | null) =>
  km === null ? null : `${km < 10 ? km.toLocaleString("de-DE", { maximumFractionDigits: 1 }) : Math.round(km)} km entfernt`;

const monthYear = (isoDate: string) => {
  const [year, month] = isoDate.split("-");
  return `${month}/${year}`;
};

/** HU/TÜV for a result card: "HU 05/2027", "HU ca. 11/2028", "HU abgelaufen"; null if unknown. */
export function formatInspectionShort(until: string | null, basis: InspectionBasis | null): string | null {
  if (basis === "expired") return "HU abgelaufen";
  if (!until) return null;
  return `HU ${basis === "relative" ? "ca. " : ""}${monthYear(until)}`;
}

/** HU/TÜV for the detail page, with where the date comes from; null if unknown. */
export function formatInspection(until: string | null, basis: InspectionBasis | null): string | null {
  if (basis === "expired") return "abgelaufen (laut Anzeige)";
  if (!until) return null;
  if (basis === "relative") return `bis ca. ${monthYear(until)} (laut Anzeige „neu“ o. ä.)`;
  if (basis === "registration") return `bis ${monthYear(until)} (erste HU 3 Jahre nach Erstzulassung)`;
  return `bis ${monthYear(until)} (laut Anzeige)`;
}

/**
 * How a price compares to the market value: "1.200 € unter Marktwert", "300 € über Marktwert",
 * or "im Marktdurchschnitt" within 3 %. Null without a market value.
 */
export function formatMarketGap(priceEur: number, marketEur: number | null): { text: string; below: boolean } | null {
  if (marketEur === null || marketEur <= 0) return null;
  const gap = marketEur - priceEur;
  if (Math.abs(gap) < marketEur * 0.03) return { text: "im Marktdurchschnitt", below: false };
  return gap > 0
    ? { text: `${euro.format(gap)} unter Marktwert`, below: true }
    : { text: `${euro.format(-gap)} über Marktwert`, below: false };
}
