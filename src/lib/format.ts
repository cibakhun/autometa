import type { InspectionBasis } from "@/core/inspection";
import { kwToPs } from "@/core/normalize";

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("de-DE");

/** 0 € means the car is given away (Kleinanzeigen "Zu verschenken"). */
export const formatPrice = (eur: number) => (eur === 0 ? "Zu verschenken" : euro.format(eur));

export const formatNumber = (value: number) => integer.format(value);

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
