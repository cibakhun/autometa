import { kwToPs } from "@/core/normalize";

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("de-DE");

export const formatPrice = (eur: number) => euro.format(eur);

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
