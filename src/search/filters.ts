import { z } from "zod";
import { BODY_TYPES, FUELS, SELLER_TYPES, TRANSMISSIONS } from "@/core/types";

export const SORTS = ["newest", "price_asc", "price_desc", "km_asc", "year_desc", "distance"] as const;
export type Sort = (typeof SORTS)[number];

export const SORT_LABELS: Record<Sort, string> = {
  newest: "Neueste zuerst",
  price_asc: "Preis aufsteigend",
  price_desc: "Preis absteigend",
  km_asc: "Kilometer aufsteigend",
  year_desc: "Erstzulassung, neueste zuerst",
  distance: "Entfernung",
};

export const RADII_KM = [10, 25, 50, 100, 200] as const;
export const PAGE_SIZE = 24;
export const MAX_PAGE = 400;

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

const blankToUndefined = (value: unknown) =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "") ? undefined : value;

const int = (min: number, max: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).optional()).catch(undefined);

const oneOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blankToUndefined, z.enum(values).optional()).catch(undefined);

const slug = z.preprocess(blankToUndefined, z.string().regex(/^[a-z0-9-]{1,40}$/).optional()).catch(undefined);

const schema = z.object({
  make: slug,
  model: slug,
  priceMin: int(0, 10_000_000),
  priceMax: int(0, 10_000_000),
  kmMax: int(0, 2_000_000),
  yearMin: int(1950, 2100),
  yearMax: int(1950, 2100),
  psMin: int(1, 2000),
  transmission: oneOf(TRANSMISSIONS),
  seller: oneOf(SELLER_TYPES),
  zip: z.preprocess(blankToUndefined, z.string().regex(/^\d{5}$/).optional()).catch(undefined),
  radius: int(1, 1000),
  q: z.preprocess(blankToUndefined, z.string().trim().max(80).optional()).catch(undefined),
  sort: z.enum(SORTS).catch("newest"),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).catch(1),
});

export type SearchFilters = z.infer<typeof schema> & {
  fuel: (typeof FUELS)[number][];
  body: (typeof BODY_TYPES)[number][];
  /** Source ids such as "autoscout24"; unknown ids simply match nothing. */
  source: string[];
};

function getAll(params: RawParams, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const value = params[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function getFirst(params: RawParams, key: string): string | undefined {
  return getAll(params, key)[0];
}

/** Lenient parsing: invalid or unknown values are dropped instead of failing the search. */
export function parseFilters(params: RawParams): SearchFilters {
  const keys = Object.keys(schema.shape) as (keyof typeof schema.shape)[];
  const parsed = schema.parse(Object.fromEntries(keys.map((key) => [key, getFirst(params, key)])));
  const multi = <T extends string>(key: string, allowed: readonly T[]) =>
    [...new Set(getAll(params, key).flatMap((v) => v.split(",")))].filter((v): v is T =>
      (allowed as readonly string[]).includes(v),
    );

  const sources = [...new Set(getAll(params, "source").flatMap((v) => v.split(",")))]
    .filter((v) => /^[a-z0-9_-]{1,40}$/.test(v))
    .slice(0, 10);
  const filters: SearchFilters = { ...parsed, fuel: multi("fuel", FUELS), body: multi("body", BODY_TYPES), source: sources };
  if (!filters.make) filters.model = undefined;
  if (filters.zip && !filters.radius) filters.radius = 50;
  if (!filters.zip) filters.radius = undefined;
  if (filters.sort === "distance" && !filters.zip) filters.sort = "newest";
  return filters;
}

/** Turns filters back into a query string, e.g. for pagination links. Defaults are left out. */
export function filtersToQuery(filters: SearchFilters, overrides: Partial<SearchFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else if (!(key === "sort" && value === "newest") && !(key === "page" && value === 1)) {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
