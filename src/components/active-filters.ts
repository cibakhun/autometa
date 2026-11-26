import { DEAL_FILTER_LABELS } from "@/core/deal";
import { VERDICT_FILTER_LABELS } from "@/core/verdict";
import { BODY_TYPE_LABELS, FUEL_LABELS, SELLER_TYPE_LABELS, TRANSMISSION_LABELS } from "@/core/types";
import { filtersToQuery, HU_FILTER_LABELS, PRICE_DROP_FILTER_LABELS, type Condition, type SearchFilters } from "@/search/filters";

export interface ActiveFilter {
  /** Stable React key. */
  key: string;
  /** Short German label, e.g. "bis 8.000 €" or "Diesel". */
  label: string;
  /** The search without this filter (first page). */
  href: string;
}

/** Display names for slugs and ids; a missing name falls back to the slug. */
export interface FilterNames {
  makes?: { slug: string; name: string; models: { slug: string; name: string }[] }[];
  sources?: { id: string; name: string }[];
}

/** A readable stand-in for a slug without a known name: "mercedes-benz" -> "Mercedes Benz". */
export const slugName = (slug: string) => slug.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

const nf = new Intl.NumberFormat("de-DE");
const euro = (value: number) => `${nf.format(value)}\u00a0€`;
const CONDITION_SHORT: Record<Condition, string> = { defekt: "mit Schadenshinweis", intakt: "ohne Schadenshinweis" };

/** "2.000–8.000 €", "ab 2.000 €", "bis 8.000 €". */
function range(min: number | undefined, max: number | undefined, format: (value: number) => string): string {
  if (min !== undefined && max !== undefined) return min === max ? format(min) : `${format(min).replace(/\s*€$/, "")}–${format(max)}`;
  return min !== undefined ? `ab ${format(min)}` : `bis ${format(max!)}`;
}

/**
 * The filters of a search as removable chips: what is narrowing the results, each with a link to
 * the same search without it. Sort, page and the "new since" view are no filters here. A removed
 * filter also drops the sentence of a search in own words, which then no longer matches.
 */
export function activeFilters(filters: SearchFilters, names: FilterNames = {}): ActiveFilter[] {
  const chips: ActiveFilter[] = [];
  const add = (key: string, label: string, without: Partial<SearchFilters>) =>
    chips.push({ key, label, href: `/${filtersToQuery(filters, { ...without, ki: undefined, page: 1 })}` });

  if (filters.q) add("q", `„${filters.q}“`, { q: undefined });
  if (filters.make) {
    const make = names.makes?.find((m) => m.slug === filters.make);
    const model = filters.model ? (make?.models.find((m) => m.slug === filters.model)?.name ?? slugName(filters.model)) : null;
    add("make", [make?.name ?? slugName(filters.make), model].filter(Boolean).join(" "), { make: undefined, model: undefined });
  }
  if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
    add("price", range(filters.priceMin, filters.priceMax, euro), { priceMin: undefined, priceMax: undefined });
  }
  if (filters.deal) add("deal", `Schnäppchen ${DEAL_FILTER_LABELS[filters.deal]}`, { deal: undefined });
  if (filters.urteil) add("urteil", `Urteil: ${VERDICT_FILTER_LABELS[filters.urteil]}`, { urteil: undefined });
  if (filters.gesenkt) {
    add("gesenkt", filters.gesenkt === "ja" ? "Preis gesenkt" : `Preis gesenkt ${PRICE_DROP_FILTER_LABELS[filters.gesenkt]}`, { gesenkt: undefined });
  }
  if (filters.yearMin !== undefined || filters.yearMax !== undefined) {
    add("year", `EZ ${range(filters.yearMin, filters.yearMax, String)}`, { yearMin: undefined, yearMax: undefined });
  }
  if (filters.kmMax !== undefined) add("kmMax", `bis ${nf.format(filters.kmMax)}\u00a0km`, { kmMax: undefined });
  if (filters.psMin !== undefined) add("psMin", `ab ${filters.psMin}\u00a0PS`, { psMin: undefined });
  for (const fuel of filters.fuel) add(`fuel-${fuel}`, FUEL_LABELS[fuel], { fuel: filters.fuel.filter((f) => f !== fuel) });
  for (const body of filters.body) add(`body-${body}`, BODY_TYPE_LABELS[body], { body: filters.body.filter((b) => b !== body) });
  if (filters.transmission) add("transmission", TRANSMISSION_LABELS[filters.transmission], { transmission: undefined });
  if (filters.seller) add("seller", SELLER_TYPE_LABELS[filters.seller], { seller: undefined });
  if (filters.zustand) add("zustand", CONDITION_SHORT[filters.zustand], { zustand: undefined });
  if (filters.schwierigkeit !== undefined) add("schwierigkeit", `Schwierigkeit bis ${filters.schwierigkeit}/5`, { schwierigkeit: undefined });
  if (filters.margeMin !== undefined) add("margeMin", `Flip-Marge ab ${euro(filters.margeMin)}`, { margeMin: undefined });
  if (filters.hu) add("hu", `HU ${HU_FILTER_LABELS[filters.hu]}`, { hu: undefined });
  for (const source of filters.source) {
    const name = names.sources?.find((s) => s.id === source)?.name ?? source;
    add(`source-${source}`, name, { source: filters.source.filter((s) => s !== source) });
  }
  if (filters.zip) add("zip", `${filters.radius ?? 50}\u00a0km um ${filters.zip}`, { zip: undefined, radius: undefined, ...(filters.sort === "distance" ? { sort: "newest" } : {}) });
  return chips;
}
