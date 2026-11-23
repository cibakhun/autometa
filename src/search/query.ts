import type { Pool, PoolClient } from "pg";
import { boundingBox, distanceSql } from "@/core/geo";
import type { DamageKind } from "@/core/damage";
import { AGE_BUCKETS, MIN_SAMPLE } from "@/core/defects";
import { calculateFlip, DEFAULT_FLIP_SETTINGS, type FlipResult, type FlipSettings } from "@/core/flip";
import type { InspectionBasis } from "@/core/inspection";
import type { Confidence, Difficulty, VehicleClass } from "@/core/repairs";
import { psToKw } from "@/core/normalize";
import type { BodyType, Fuel, SellerType, Transmission } from "@/core/types";
import { Params } from "@/lib/db";
import { huFilterMonths, PAGE_SIZE, type SearchFilters, type Sort } from "./filters";

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
  /** Null when the source does not say. */
  sellerType: SellerType | null;
  zip: string | null;
  city: string | null;
  sourceId: string;
  sourceName: string;
  distanceKm: number | null;
  /** The same vehicle on other portals (duplicates), cheapest first. */
  otherOffers: Offer[];
  /** Link to the preview photo on the source's image server, if it showed one. */
  imageUrl: string | null;
  /** Last month the HU/TÜV is valid (YYYY-MM-DD, first of the month), if known. */
  huUntil: string | null;
  /** Where huUntil comes from; "expired" when the listing says the HU ran out. */
  huBasis: InspectionBasis | null;
  /** Damage the title mentions; empty when none. */
  damage: DamageKind[];
  /** Median price of comparable intact listings, null when there are too few. */
  marketPriceEur: number | null;
  /** How many comparable listings the market value is based on. */
  marketComps: number | null;
  /** What repairing it probably takes (src/core/repairs.ts), null until computed. */
  repair: RepairSummary | null;
  /** Margin when bought, repaired and sold again; null without a market value or repair estimate. */
  flip: FlipResult | null;
  /** When the listing was last seen in a list or confirmed on its own page (ISO timestamp). */
  checkedAt: string;
  /** When AutoMeta first saw the listing (ISO timestamp). */
  firstSeenAt: string;
  /** When the price last went down, and what it was before; null when it did not or went up again. */
  priceDroppedAt: string | null;
  priceBeforeDropEur: number | null;
  /**
   * How often the model had HU defects at the car's age, compared with all cars of that age
   * (Modell-Akte): 0.8 means 20 % fewer. Only filled when sorted by recommendation; null
   * without a profile.
   */
  reliabilityRatio: number | null;
}

export interface RepairSummary {
  vehicleClass: VehicleClass;
  partsEur: [number, number];
  hours: [number, number];
  difficulty: Difficulty;
  confidence: Confidence;
  needsTow: boolean;
  /** Risk buffer: defects the next inspection usually finds on such a car; null when unknown. */
  riskHiddenEur: number | null;
  /** Risk buffer: a worse damage than named, when the price is far below market; null without a market value. */
  riskUnclearEur: number | null;
}

/** Both parts of the risk buffer, 0 when unknown. */
export const riskTotal = (repair: RepairSummary) => (repair.riskHiddenEur ?? 0) + (repair.riskUnclearEur ?? 0);

/** The repair estimate columns of a listings row, or null when not computed yet. */
function repairFromRow(row: Record<string, unknown>): RepairSummary | null {
  if (row.repair_difficulty === null || row.repair_difficulty === undefined) return null;
  return {
    vehicleClass: row.vehicle_class as VehicleClass,
    partsEur: [Number(row.repair_parts_min_eur), Number(row.repair_parts_max_eur)],
    hours: [Number(row.repair_hours_min), Number(row.repair_hours_max)],
    difficulty: Number(row.repair_difficulty) as Difficulty,
    confidence: row.repair_confidence as Confidence,
    needsTow: Boolean(row.repair_needs_tow),
    riskHiddenEur: row.repair_risk_hidden_eur === null || row.repair_risk_hidden_eur === undefined ? null : Number(row.repair_risk_hidden_eur),
    riskUnclearEur: row.repair_risk_unclear_eur === null || row.repair_risk_unclear_eur === undefined ? null : Number(row.repair_risk_unclear_eur),
  };
}

function flipFromRow(priceEur: number, marketEur: number | null, repair: RepairSummary | null, settings: FlipSettings): FlipResult | null {
  if (marketEur === null || repair === null) return null;
  return calculateFlip(
    { purchaseEur: priceEur, marketEur, partsEur: repair.partsEur, hours: repair.hours, needsTow: repair.needsTow, riskEur: riskTotal(repair) },
    settings,
  );
}

/** The flip margin and margin per hour in SQL, the same formula as calculateFlip (risk buffer included). */
function flipSql(settings: FlipSettings, params: Params) {
  const keep = params.add(1 - settings.discountPct / 100);
  const fixed = params.add(settings.huEur + settings.registrationEur);
  const tow = params.add(settings.towEur);
  const transport = params.add(settings.transportEur);
  const margin = `(l.market_price_eur * ${keep}::float8 - l.price_eur
      - (l.repair_parts_min_eur + l.repair_parts_max_eur) / 2.0 - ${fixed}::int
      - coalesce(l.repair_risk_hidden_eur, 0) - coalesce(l.repair_risk_unclear_eur, 0)
      - case when l.repair_needs_tow then ${tow}::int else ${transport}::int end)`;
  return { margin, perHour: `(${margin} / nullif((l.repair_hours_min + l.repair_hours_max) / 2.0, 0))` };
}

/** One portal's listing of a vehicle. */
export interface Offer {
  id: number;
  sourceName: string;
  priceEur: number;
}

export interface SearchResult {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  items: ListingSummary[];
}

const ORDER_BY: Record<Exclude<Sort, "flip" | "margin" | "empfehlung">, string> = {
  newest: "l.first_seen_at desc, l.id desc",
  price_asc: "l.price_eur asc, l.id asc",
  price_desc: "l.price_eur desc, l.id desc",
  km_asc: "l.mileage_km asc nulls last, l.id asc",
  year_desc: "l.first_registration desc nulls last, l.id desc",
  distance: "distance_km asc nulls last, l.id asc",
  // The biggest gap in euros: what a repaired car could be worth minus what it costs now.
  below_market: "l.market_price_eur - l.price_eur desc nulls last, l.id desc",
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** The age group (index into AGE_BUCKETS) of a first registration in SQL, null outside them; as ageBucket. */
export function ageBucketSql(column = "l.first_registration"): string {
  const age = `(extract(year from current_date)::int - extract(year from ${column})::int)`;
  return `(case ${AGE_BUCKETS.map(([from, to], i) => `when ${age} between ${from} and ${to} then ${i}`).join(" ")} end)`;
}

/**
 * Per model and age group: its share of cars with an HU defect divided by that of all cars of
 * the age group (the same average as poolProfiles). Below 1 means more reliable than usual.
 */
const RELIABILITY_CTE = `reliability as (
  select p.make_slug, p.model_slug, p.age_bucket, (p.any_defect::float8 / p.sample) / nullif(a.rate, 0) as ratio
    from model_defect_profiles p
    join (select age_bucket, sum(any_defect)::float8 / sum(sample) as rate
            from model_defect_profiles where sample >= ${MIN_SAMPLE} group by age_bucket) a on a.age_bucket = p.age_bucket
   where p.sample >= ${MIN_SAMPLE})`;

/**
 * Recommendation ("Empfehlung"): points for a model with fewer HU defects than cars of its age
 * (1 point per percent, ±50) plus points for a price below market value (1 point per percent,
 * ±30). Listings whose title names damage get the lowest price points, since their market value
 * is that of an intact car. Unknown parts count 0. Kept in step with recommendationScore.
 */
// greatest() and least() skip nulls in Postgres, hence the explicit case for an unknown ratio.
const RECOMMENDATION_SQL = `(case when l.reliability_ratio is null then 0 else greatest(-50, least(50, (1 - l.reliability_ratio) * 100)) end
  + case when cardinality(l.damage) > 0 then -30
         when l.market_price_eur > 0 then greatest(-30, least(30, (l.market_price_eur - l.price_eur) * 100.0 / l.market_price_eur))
         else 0 end)`;

/** The recommendation points of a listing, as RECOMMENDATION_SQL. */
export function recommendationScore(listing: Pick<ListingSummary, "reliabilityRatio" | "damage" | "marketPriceEur" | "priceEur">): number {
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
  const reliability = listing.reliabilityRatio === null ? 0 : clamp((1 - listing.reliabilityRatio) * 100, 50);
  const price =
    listing.damage.length > 0
      ? -30
      : listing.marketPriceEur !== null && listing.marketPriceEur > 0
        ? clamp(((listing.marketPriceEur - listing.priceEur) * 100) / listing.marketPriceEur, 30)
        : 0;
  return reliability + price;
}

/** Builds the WHERE clause; returns the SQL and, when a radius applies, the distance expression. */
export interface WhereOptions {
  /** Leave out vehicles this saved search already reported (in a push), unless cheaper since. */
  notAlertedBy?: number;
}

export function buildWhere(
  filters: SearchFilters,
  origin: Origin | null,
  params: Params,
  settings = DEFAULT_FLIP_SETTINGS,
  options: WhereOptions = {},
) {
  const where = ["l.status = 'active'", "l.source_id in (select id from sources where active)"];
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
  if (filters.hu) add((p) => `l.hu_until >= (date_trunc('month', current_date) + make_interval(months => ${p(huFilterMonths(filters.hu!))}::int))::date`);
  if (filters.zustand === "defekt") where.push("cardinality(l.damage) > 0");
  if (filters.zustand === "intakt") where.push("l.damage = '{}'");
  if (filters.schwierigkeit !== undefined) add((p) => `l.repair_difficulty <= ${p(filters.schwierigkeit)}`);
  if (filters.margeMin !== undefined) {
    const { margin } = flipSql(settings, params);
    // Rounded to 10 euros like the margin shown (Math.round), so a shown 1.880 € passes "ab 1.880 €".
    add((p) => `floor(${margin} / 10 + 0.5) * 10 >= ${p(filters.margeMin)}`);
  }
  if (filters.source.length > 0) add((p) => `l.source_id = any(${p(filters.source)}::text[])`);
  // Every word of the search term somewhere in the title: "GTI Standheizung" finds "Golf GTI mit Standheizung".
  for (const word of (filters.q ?? "").split(/\s+/).filter(Boolean).slice(0, 5)) {
    add((p) => `l.title ilike ${p(`%${escapeLike(word)}%`)}`);
  }
  if (filters.seit) {
    // New: first seen after that moment, and no portal had the same vehicle before. Or cheaper since.
    const since = params.add(filters.seit);
    where.push(`((l.first_seen_at > ${since}::timestamptz
       and (l.cluster_id is null or not exists (
         select 1 from listings d
          where d.cluster_id is not null and d.cluster_id = l.cluster_id and d.first_seen_at <= ${since}::timestamptz)))
     or l.price_dropped_at > ${since}::timestamptz)`);
  }
  if (options.notAlertedBy !== undefined) {
    const search = params.add(options.notAlertedBy);
    const after = "coalesce(l.price_dropped_at, '-infinity'::timestamptz)";
    // Two lookups instead of one with "or", so each can use an index (hits by key, cluster members).
    where.push(`not exists (
      select 1 from saved_search_hits h where h.search_id = ${search} and h.listing_id = l.id and h.alerted_at > ${after})`);
    where.push(`(l.cluster_id is null or not exists (
      select 1 from listings d join saved_search_hits h on h.search_id = ${search} and h.listing_id = d.id
       where d.cluster_id is not null and d.cluster_id = l.cluster_id and h.alerted_at > ${after}))`);
  }

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

/**
 * The columns summaryFromRow reads, for a query over listings "l" joined with sources "s".
 * distanceKm is an SQL expression for the distance to the search origin.
 */
export function summaryColumns(distanceKm = "null::float8") {
  return `l.id, l.title, l.make_slug, l.model_slug, l.price_eur, l.mileage_km,
           to_char(l.first_registration, 'YYYY-MM-DD') as first_registration,
           l.fuel, l.transmission, l.power_kw, l.body_type, l.seller_type, l.zip, l.city, l.cluster_id,
           to_char(l.hu_until, 'YYYY-MM-DD') as hu_until, l.hu_basis,
           l.damage, l.market_price_eur, l.market_comps,
           l.vehicle_class, l.repair_parts_min_eur, l.repair_parts_max_eur, l.repair_hours_min, l.repair_hours_max,
           l.repair_difficulty, l.repair_confidence, l.repair_needs_tow,
           l.repair_risk_hidden_eur, l.repair_risk_unclear_eur, l.last_seen_at,
           l.first_seen_at, l.price_dropped_at, l.price_before_drop_eur,
           s.id as source_id, s.name as source_name,
           -- The cheapest listing of a duplicate group may come without a photo; another may have one.
           coalesce(l.image_url, (select d.image_url from listings d
                                   where l.cluster_id is not null and d.cluster_id = l.cluster_id
                                     and d.status = 'active' and d.image_url is not null
                                   order by d.price_eur, d.id limit 1)) as image_url,
           ${distanceKm} as distance_km`;
}

/** The listing a group of duplicates is shown with: the cheapest one that matches the filters. */
const GROUP = "coalesce(l.cluster_id, l.id)";

export async function searchListings(
  pool: Pool | PoolClient,
  filters: SearchFilters,
  origin: Origin | null,
  settings: FlipSettings = DEFAULT_FLIP_SETTINGS,
  options: WhereOptions = {},
): Promise<SearchResult> {
  const params = new Params();
  const { where, distance } = buildWhere(filters, origin, params, settings, options);
  // The count query takes only the filter parameters; Postgres rejects parameters a query does not use.
  const whereParams = params.values.slice();
  const sort: Sort = filters.sort === "distance" && !distance ? "newest" : filters.sort;
  let orderBy: string;
  if (sort === "flip" || sort === "margin") {
    const { margin, perHour } = flipSql(settings, params);
    orderBy = `${sort === "flip" ? perHour : margin} desc nulls last, l.id desc`;
  } else if (sort === "empfehlung") {
    orderBy = `${RECOMMENDATION_SQL} desc, l.id desc`;
  } else {
    orderBy = ORDER_BY[sort];
  }
  // The Modell-Akte comparison, only for the recommendation: a join over every matching listing.
  const reliability = sort === "empfehlung";
  const offset = (filters.page - 1) * PAGE_SIZE;

  // A vehicle listed on several portals counts once.
  const countSql = `select count(distinct ${GROUP})::int as total from listings l where ${where}`;
  const itemsSql = `
    ${reliability ? `with ${RELIABILITY_CTE}` : ""}
    select ${summaryColumns(distance ? `round(${distance}::numeric, 1)::float8` : "null::float8")}${reliability ? ", l.reliability_ratio" : ""}
      from (
        select l.*, row_number() over (partition by ${GROUP} order by l.price_eur asc, l.id asc) as group_rank
               ${reliability ? ", r.ratio as reliability_ratio" : ""}
          from listings l
          ${reliability ? `left join reliability r on r.make_slug = l.make_slug and r.model_slug = l.model_slug and r.age_bucket = ${ageBucketSql()}` : ""}
         where ${where}
      ) l
      join sources s on s.id = l.source_id
     where l.group_rank = 1
     order by ${orderBy}
     limit ${PAGE_SIZE} offset ${offset}`;

  const [count, items] = await Promise.all([
    pool.query<{ total: number }>(countSql, whereParams),
    pool.query(itemsSql, params.values),
  ]);
  const total = count.rows[0]?.total ?? 0;
  const offers = await getOffers(
    pool,
    items.rows.filter((row) => row.cluster_id !== null).map((row) => Number(row.cluster_id)),
  );

  return {
    total,
    page: filters.page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    items: items.rows.map((row) => summaryFromRow(row, offers, settings)),
  };
}

/** A search row (columns as in searchListings) as a ListingSummary. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a pg row
export function summaryFromRow(row: Record<string, any>, offers: Map<number, Offer[]>, settings: FlipSettings): ListingSummary {
  const id = Number(row.id);
  const repair = repairFromRow(row);
  return {
    id,
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
    otherOffers: (offers.get(Number(row.cluster_id)) ?? []).filter((offer) => offer.id !== id),
    imageUrl: row.image_url,
    huUntil: row.hu_until,
    huBasis: row.hu_basis,
    damage: row.damage ?? [],
    marketPriceEur: row.market_price_eur,
    marketComps: row.market_comps,
    repair,
    flip: flipFromRow(row.price_eur, row.market_price_eur, repair, settings),
    checkedAt: new Date(row.last_seen_at).toISOString(),
    firstSeenAt: new Date(row.first_seen_at).toISOString(),
    priceDroppedAt: row.price_dropped_at ? new Date(row.price_dropped_at).toISOString() : null,
    priceBeforeDropEur: row.price_before_drop_eur ?? null,
    reliabilityRatio: row.reliability_ratio === null || row.reliability_ratio === undefined ? null : Number(row.reliability_ratio),
  };
}

/** How many vehicles match, each duplicate group once; the count searchListings reports as total. */
export async function countListings(
  pool: Pool | PoolClient,
  filters: SearchFilters,
  origin: Origin | null,
  settings: FlipSettings = DEFAULT_FLIP_SETTINGS,
): Promise<number> {
  const params = new Params();
  const { where } = buildWhere(filters, origin, params, settings);
  const { rows } = await pool.query<{ total: number }>(
    `select count(distinct ${GROUP})::int as total from listings l where ${where}`,
    params.values,
  );
  return rows[0]?.total ?? 0;
}

/** Active listings of the given duplicate groups, cheapest first, by cluster id. */
export async function getOffers(pool: Pool | PoolClient, clusterIds: number[]): Promise<Map<number, Offer[]>> {
  const offers = new Map<number, Offer[]>();
  if (clusterIds.length === 0) return offers;
  const { rows } = await pool.query(
    `select l.cluster_id, l.id, s.name as source_name, l.price_eur
       from listings l join sources s on s.id = l.source_id
      where l.cluster_id = any($1::int8[]) and l.status = 'active' and s.active
      order by l.price_eur asc, l.id asc`,
    [clusterIds],
  );
  for (const row of rows) {
    const list = offers.get(Number(row.cluster_id)) ?? [];
    list.push({ id: Number(row.id), sourceName: row.source_name, priceEur: row.price_eur });
    offers.set(Number(row.cluster_id), list);
  }
  return offers;
}

/** Exact postal code, or the numerically closest known one in the same region (first two digits). */
export async function resolveZip(pool: Pool | PoolClient, zip: string): Promise<Origin | null> {
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

/** A town name as compared below: lowercase, "ä" as "a", "ß" as "ss". */
const townKey = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, " ").replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss");

/**
 * The central postal code of a German town named as typed ("München", "muenchen", "Frankfurt"):
 * the town whose name matches exactly or with a suffix ("Frankfurt am Main"), the one with the
 * most postal codes when several do, and its code closest to the middle of them. Null if none.
 */
export async function findTown(pool: Pool | PoolClient, name: string): Promise<{ zip: string; city: string } | null> {
  const key = townKey(name);
  if (key.length < 2 || key.length > 60) return null;
  const spelled = key.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
  const { rows } = await pool.query<{ zip: string; city: string }>(
    `with hits as (
       select zip, city, lat, lng, replace(translate(lower(city), 'äöü', 'aou'), 'ß', 'ss') as key
         from postal_codes
        where replace(translate(lower(city), 'äöü', 'aou'), 'ß', 'ss') in ($1, $2)
           or replace(translate(lower(city), 'äöü', 'aou'), 'ß', 'ss') like $3
           or replace(translate(lower(city), 'äöü', 'aou'), 'ß', 'ss') like $4
     ), town as (
       select city, avg(lat) as lat, avg(lng) as lng
         from hits
        group by city
        order by bool_or(key in ($1, $2)) desc, count(*) desc, city
        limit 1
     )
     select h.zip, t.city
       from hits h join town t on t.city = h.city
      order by (h.lat - t.lat) ^ 2 + (h.lng - t.lng) ^ 2, h.zip
      limit 1`,
    [key, spelled, `${escapeLike(key)} %`, `${escapeLike(spelled)} %`],
  );
  return rows[0] ?? null;
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
    `select l.make_slug, mk.name as make_name, l.model_slug, md.name as model_name, count(distinct ${GROUP})::int as count
       from listings l
       join makes mk on mk.slug = l.make_slug
       left join models md on md.make_slug = l.make_slug and md.slug = l.model_slug
      where l.status = 'active' and l.source_id in (select id from sources where active)
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

export interface SourceFacet {
  id: string;
  name: string;
  count: number;
}

/** Portals that currently have active listings, with counts, for the filter form. */
export async function getSourceFacets(pool: Pool): Promise<SourceFacet[]> {
  const { rows } = await pool.query<SourceFacet>(
    `select s.id, s.name, count(*)::int as count
       from listings l join sources s on s.id = l.source_id
      where l.status = 'active' and s.active
      group by s.id, s.name
      order by s.name`,
  );
  return rows;
}

export interface SourceStatus {
  id: string;
  name: string;
  kind: string;
  /** End of the last import that stored listings, ISO timestamp, or null. */
  lastImportAt: string | null;
  /**
   * Share of the active listings seen in a list or confirmed on their own page in the last 24 hours
   * (0 to 1), as counted after the last import round; null before the first count.
   */
  checkedShare: number | null;
}

/** Active sources and when each last delivered listings, for the notice above the search. */
export async function getSourceStatus(pool: Pool): Promise<SourceStatus[]> {
  const { rows } = await pool.query(
    `select s.id, s.name, s.kind, s.active_listings, s.checked_24h,
            (select max(r.finished_at) from ingest_runs r where r.source_id = s.id and r.upserted > 0) as last_import_at
       from sources s
      where s.active and exists (select 1 from listings l where l.source_id = s.id and l.status = 'active')
      order by s.name`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    lastImportAt: row.last_import_at ? new Date(row.last_import_at).toISOString() : null,
    checkedShare: row.active_listings > 0 && row.checked_24h !== null ? row.checked_24h / row.active_listings : null,
  }));
}

/** One price a listing had and when we first saw it. */
export interface PricePoint {
  priceEur: number;
  seenAt: string;
}

export interface ListingDetail extends ListingSummary {
  /** Middle half of the comparable listings' prices. */
  marketLowEur: number | null;
  marketHighEur: number | null;
  /** Median days comparable listings stayed online, when enough of them disappeared. */
  marketDays: number | null;
  /** Every price the listing had, oldest first. */
  priceHistory: PricePoint[];
  variant: string | null;
  color: string | null;
  sellerName: string | null;
  /** 'gone' once the listing disappeared from its portal. */
  status: "active" | "gone";
  /**
   * Why a gone listing left: missed in complete reads of its list, taken down according to its
   * own page, or not confirmed for too long. Null while active or when it left before this was kept.
   */
  goneReason: "missed" | "checked" | "stale" | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export async function getListing(pool: Pool, id: number, settings = DEFAULT_FLIP_SETTINGS): Promise<ListingDetail | null> {
  const { rows } = await pool.query(
    `select l.*, to_char(l.first_registration, 'YYYY-MM-DD') as first_registration_text, s.name as source_name,
            to_char(l.hu_until, 'YYYY-MM-DD') as hu_until_text,
            coalesce(l.image_url, (select d.image_url from listings d
                                    where l.cluster_id is not null and d.cluster_id = l.cluster_id
                                      and d.status = 'active' and d.image_url is not null
                                    order by d.price_eur, d.id limit 1)) as shown_image_url
       from listings l join sources s on s.id = l.source_id
      where l.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const clusterId = row.cluster_id === null ? null : Number(row.cluster_id);
  const [offerMap, prices] = await Promise.all([
    clusterId === null ? Promise.resolve(new Map<number, Offer[]>()) : getOffers(pool, [clusterId]),
    pool.query<{ price_eur: number; seen_at: Date }>(
      "select price_eur, seen_at from listing_prices where listing_id = $1 order by seen_at",
      [id],
    ),
  ]);
  const offers = clusterId === null ? [] : (offerMap.get(clusterId) ?? []);
  const repair = repairFromRow(row);
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
    otherOffers: offers.filter((offer) => offer.id !== Number(row.id)),
    imageUrl: row.shown_image_url,
    huUntil: row.hu_until_text,
    huBasis: row.hu_basis,
    damage: row.damage ?? [],
    marketPriceEur: row.market_price_eur,
    marketComps: row.market_comps,
    repair,
    flip: flipFromRow(row.price_eur, row.market_price_eur, repair, settings),
    marketLowEur: row.market_low_eur,
    marketHighEur: row.market_high_eur,
    marketDays: row.market_days,
    priceHistory: prices.rows.map((p) => ({ priceEur: p.price_eur, seenAt: new Date(p.seen_at).toISOString() })),
    variant: row.variant,
    color: row.color,
    sellerName: row.seller_name,
    status: row.status,
    goneReason: row.status === "gone" ? (row.gone_reason ?? null) : null,
    firstSeenAt: new Date(row.first_seen_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    checkedAt: new Date(row.last_seen_at).toISOString(),
    priceDroppedAt: row.price_dropped_at ? new Date(row.price_dropped_at).toISOString() : null,
    priceBeforeDropEur: row.price_before_drop_eur ?? null,
    reliabilityRatio: null,
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
