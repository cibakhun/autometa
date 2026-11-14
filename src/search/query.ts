import type { Pool } from "pg";
import { boundingBox, distanceSql } from "@/core/geo";
import { psToKw } from "@/core/normalize";
import type { BodyType, Fuel, SellerType, Transmission } from "@/core/types";
import { Params } from "@/lib/db";
import { PAGE_SIZE, type SearchFilters, type Sort } from "./filters";

export interface Origin {
  zip: string;
  city: string;
  lat: number;
  lng: number;
  /** False when the exact postal code is unknown and a nearby one is used instead. */
  exact: boolean;
}

export interface ListingSummary {
  id: number;
  title: string;
  makeSlug: string | null;
  modelSlug: string | null;
  priceEur: number;
  mileageKm: number | null;
  firstRegistration: string | null;
  fuel: Fuel | null;
  transmission: Transmission | null;
  powerKw: number | null;
  bodyType: BodyType | null;
  sellerType: SellerType;
  zip: string | null;
  city: string | null;
  sourceId: string;
  sourceName: string;
  distanceKm: number | null;
}

export interface SearchResult {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  items: ListingSummary[];
}

const ORDER_BY: Record<Sort, string> = {
  newest: "l.first_seen_at desc, l.id desc",
  price_asc: "l.price_eur asc, l.id asc",
  price_desc: "l.price_eur desc, l.id desc",
  km_asc: "l.mileage_km asc nulls last, l.id asc",
  year_desc: "l.first_registration desc nulls last, l.id desc",
  distance: "distance_km asc nulls last, l.id asc",
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Builds the WHERE clause; returns the SQL and, when a radius applies, the distance expression. */
export function buildWhere(filters: SearchFilters, origin: Origin | null, params: Params) {
  const where = ["l.status = 'active'"];
  const add = (sql: (p: (value: unknown) => string) => string) => where.push(sql((value) => params.add(value)));

  if (filters.make) add((p) => `l.make_slug = ${p(filters.make)}`);
  if (filters.make && filters.model) add((p) => `l.model_slug = ${p(filters.model)}`);
  if (filters.priceMin !== undefined) add((p) => `l.price_eur >= ${p(filters.priceMin)}`);
  if (filters.priceMax !== undefined) add((p) => `l.price_eur <= ${p(filters.priceMax)}`);
  if (filters.kmMax !== undefined) add((p) => `l.mileage_km <= ${p(filters.kmMax)}`);
  if (filters.yearMin !== undefined) add((p) => `l.first_registration >= make_date(${p(filters.yearMin)}::int, 1, 1)`);
  if (filters.yearMax !== undefined) add((p) => `l.first_registration < make_date(${p(filters.yearMax)}::int + 1, 1, 1)`);
  if (filters.psMin !== undefined) add((p) => `l.power_kw >= ${p(psToKw(filters.psMin!))}`);
  if (filters.fuel.length > 0) add((p) => `l.fuel = any(${p(filters.fuel)}::text[])`);
  if (filters.body.length > 0) add((p) => `l.body_type = any(${p(filters.body)}::text[])`);
  if (filters.transmission) add((p) => `l.transmission = ${p(filters.transmission)}`);
  if (filters.seller) add((p) => `l.seller_type = ${p(filters.seller)}`);
  if (filters.q) add((p) => `l.title ilike ${p(`%${escapeLike(filters.q!)}%`)}`);

  let distance: string | null = null;
  if (origin) {
    const lat = params.add(origin.lat);
    const lng = params.add(origin.lng);
    distance = distanceSql("l.lat", "l.lng", `${lat}::float8`, `${lng}::float8`);
    if (filters.radius) {
      const box = boundingBox(origin.lat, origin.lng, filters.radius);
      add((p) => `l.lat between ${p(box.minLat)} and ${p(box.maxLat)}`);
      add((p) => `l.lng between ${p(box.minLng)} and ${p(box.maxLng)}`);
      add((p) => `${distance} <= ${p(filters.radius)}`);
    }
  }
  return { where: where.join("\n  and "), distance };
}

export async function searchListings(pool: Pool, filters: SearchFilters, origin: Origin | null): Promise<SearchResult> {
  const params = new Params();
  const { where, distance } = buildWhere(filters, origin, params);
  const sort: Sort = filters.sort === "distance" && !distance ? "newest" : filters.sort;
  const offset = (filters.page - 1) * PAGE_SIZE;

  const countSql = `select count(*)::int as total from listings l where ${where}`;
  const itemsSql = `
    select l.id, l.title, l.make_slug, l.model_slug, l.price_eur, l.mileage_km,
           to_char(l.first_registration, 'YYYY-MM-DD') as first_registration,
           l.fuel, l.transmission, l.power_kw, l.body_type, l.seller_type, l.zip, l.city,
           s.id as source_id, s.name as source_name,
           ${distance ? `round(${distance}::numeric, 1)::float8` : "null::float8"} as distance_km
      from listings l
      join sources s on s.id = l.source_id
     where ${where}
     order by ${ORDER_BY[sort]}
     limit ${PAGE_SIZE} offset ${offset}`;

  const [count, items] = await Promise.all([
    pool.query<{ total: number }>(countSql, params.values),
    pool.query(itemsSql, params.values),
  ]);
  const total = count.rows[0]?.total ?? 0;

  return {
    total,
    page: filters.page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    items: items.rows.map((row) => ({
      id: Number(row.id),
      title: row.title,
      makeSlug: row.make_slug,
      modelSlug: row.model_slug,
      priceEur: row.price_eur,
      mileageKm: row.mileage_km,
      firstRegistration: row.first_registration,
      fuel: row.fuel,
      transmission: row.transmission,
      powerKw: row.power_kw,
      bodyType: row.body_type,
      sellerType: row.seller_type,
      zip: row.zip,
      city: row.city,
      sourceId: row.source_id,
      sourceName: row.source_name,
      distanceKm: row.distance_km,
    })),
  };
}

/** Exact postal code, or the numerically closest known one in the same region (first two digits). */
export async function resolveZip(pool: Pool, zip: string): Promise<Origin | null> {
  const exact = await pool.query("select zip, city, lat, lng from postal_codes where zip = $1", [zip]);
  if (exact.rows[0]) return { ...exact.rows[0], exact: true };
  const near = await pool.query(
    `select zip, city, lat, lng from postal_codes
      where left(zip, 2) = left($1, 2)
      order by abs(zip::int - $1::int) limit 1`,
    [zip],
  );
  return near.rows[0] ? { ...near.rows[0], exact: false } : null;
}

export interface MakeFacet {
  slug: string;
  name: string;
  count: number;
  models: { slug: string; name: string; count: number }[];
}

/** Makes and models that currently have active listings, with counts, for the filter form. */
export async function getMakeFacets(pool: Pool): Promise<MakeFacet[]> {
  const { rows } = await pool.query<{ make_slug: string; make_name: string; model_slug: string | null; model_name: string | null; count: number }>(
    `select l.make_slug, mk.name as make_name, l.model_slug, md.name as model_name, count(*)::int as count
       from listings l
       join makes mk on mk.slug = l.make_slug
       left join models md on md.make_slug = l.make_slug and md.slug = l.model_slug
      where l.status = 'active'
      group by 1, 2, 3, 4
      order by mk.name, md.name`,
  );
  const makes = new Map<string, MakeFacet>();
  for (const row of rows) {
    const make = makes.get(row.make_slug) ?? { slug: row.make_slug, name: row.make_name, count: 0, models: [] };
    make.count += row.count;
    if (row.model_slug && row.model_name) make.models.push({ slug: row.model_slug, name: row.model_name, count: row.count });
    makes.set(row.make_slug, make);
  }
  return [...makes.values()];
}

export interface ListingDetail extends ListingSummary {
  variant: string | null;
  color: string | null;
  sellerName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export async function getListing(pool: Pool, id: number): Promise<ListingDetail | null> {
  const { rows } = await pool.query(
    `select l.*, to_char(l.first_registration, 'YYYY-MM-DD') as first_registration_text, s.name as source_name
       from listings l join sources s on s.id = l.source_id
      where l.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    title: row.title,
    makeSlug: row.make_slug,
    modelSlug: row.model_slug,
    priceEur: row.price_eur,
    mileageKm: row.mileage_km,
    firstRegistration: row.first_registration_text,
    fuel: row.fuel,
    transmission: row.transmission,
    powerKw: row.power_kw,
    bodyType: row.body_type,
    sellerType: row.seller_type,
    zip: row.zip,
    city: row.city,
    sourceId: row.source_id,
    sourceName: row.source_name,
    distanceKm: null,
    variant: row.variant,
    color: row.color,
    sellerName: row.seller_name,
    firstSeenAt: new Date(row.first_seen_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
  };
}

/** Records a click-out and returns the original listing URL, or null if unknown. */
export async function recordClick(pool: Pool, id: number): Promise<string | null> {
  const { rows } = await pool.query<{ url: string }>(
    `with hit as (select id, url from listings where id = $1)
     insert into clicks (listing_id) select id from hit
     returning (select url from hit) as url`,
    [id],
  );
  return rows[0]?.url ?? null;
}
