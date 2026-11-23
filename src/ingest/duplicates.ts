import type { Pool, PoolClient } from "pg";
import { distanceSql } from "@/core/geo";

/**
 * Finds the same vehicle offered on several portals and gives those listings a shared
 * cluster_id (the smallest listing id of the group), so the search can show it once.
 *
 * Two active listings from different sources count as the same vehicle when make and model are
 * the same and power, fuel and gearbox do not contradict each other where both sides know them,
 * and one of these holds:
 *
 * 1. Both have a place and a month of first registration: the same month, mileage within 2 %
 *    (at least 500 km), because sellers round and keep driving, price within 8 % (at least
 *    500 EUR), and the same postal code or at most 25 km apart.
 * 2. One gives only the year of first registration (Quoka, Autohero): the same year, the rest as
 *    in 1, from 1,000 km on, because dealers list several identical new cars.
 * 3. One gives no place (Autohero, auto.de): the same year (and month where both know it) and the
 *    mileage to the kilometre, from 1,000 km on and no round hundred, because dealers send the
 *    same figures to every portal while round figures are common. Price within 15 % (at least
 *    1,000 EUR): auto.de asks up to about 13 % more than the dealer's own listing elsewhere.
 *
 * Matches of kind 2 and 3 count only when they are unambiguous: neither listing has another
 * candidate on the other's portal. A group never holds two listings of the same source (a
 * vehicle is listed once per portal), nor two different known months of first registration
 * (a listing with only the year could otherwise link two cars of that year).
 */

export const MATCH_RULES = {
  mileageShare: 0.02,
  mileageMinKm: 500,
  priceShare: 0.08,
  priceMinEur: 500,
  maxDistanceKm: 25,
  powerToleranceKw: 3,
  /** Kinds 2 and 3: lowest mileage, below it dealers have several identical cars. */
  weakMinMileageKm: 1000,
  /** Kind 3: mileages that are a multiple of this are too common to identify a car. */
  unplacedRoundKm: 100,
  unplacedPriceShare: 0.15,
  unplacedPriceMinEur: 1000,
} as const;

interface Candidate {
  a: number;
  b: number;
  a_source: string;
  b_source: string;
  a_month: string | null;
  b_month: string | null;
  score: number;
}

export interface DuplicateResult {
  /** Groups with more than one listing. */
  clusters: number;
  /** Listings that belong to such a group. */
  listings: number;
}

export async function updateDuplicates(pool: Pool): Promise<DuplicateResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // One regrouping at a time, from reading the candidates to the last write, so a slower run
    // cannot write back groups that a newer run already corrected.
    await client.query("select pg_advisory_xact_lock(hashtext('autometa-duplicates'))");
    const result = await regroup(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Power, fuel and gearbox do not contradict each other ($1 = power tolerance in kW). */
const COMPATIBLE = `(a.power_kw is null or b.power_kw is null or abs(a.power_kw - b.power_kw) <= $1)
        and (a.fuel is null or b.fuel is null or a.fuel = b.fuel)
        and (a.transmission is null or b.transmission is null or a.transmission = b.transmission)`;

/** b registered in the year of a; a range, so the vehicle index serves it. */
const SAME_YEAR = `b.first_registration >= date_trunc('year', a.first_registration)::date
        and b.first_registration < (date_trunc('year', a.first_registration) + interval '1 year')::date`;

/** Score: the share of the mileage and price gaps; lower is closer. */
const SCORE = `abs(a.mileage_km - b.mileage_km)::float8 / greatest(a.mileage_km, b.mileage_km, 1)
              + abs(a.price_eur - b.price_eur)::float8 / greatest(a.price_eur, b.price_eur, 1)`;

async function regroup(client: PoolClient): Promise<DuplicateResult> {
  const r = MATCH_RULES;
  const near = `(a.zip = b.zip or (a.lat is not null and b.lat is not null and ${distanceSql("a.lat", "a.lng", "b.lat", "b.lng")} <= $2))`;
  const closeMileage = "abs(a.mileage_km - b.mileage_km) <= greatest($3::int, $4::float8 * greatest(a.mileage_km, b.mileage_km))";
  // The same as a range around a's mileage (a little wider), so the vehicle index can seek it.
  const mileageWindow = `b.mileage_km between least(a.mileage_km - $3::int, floor(a.mileage_km * (1 - $4::float8))::int)
                                  and greatest(a.mileage_km + $3::int, ceil(a.mileage_km / (1 - $4::float8))::int)`;
  const closePrice = "abs(a.price_eur - b.price_eur) <= greatest($5::int, $6::float8 * greatest(a.price_eur, b.price_eur))";
  const month = (l: string) => `case when ${l}.first_registration_year_only then null else to_char(${l}.first_registration, 'YYYY-MM') end`;
  const columns = `a.id::int8 as a, b.id::int8 as b, a.source_id as a_source, b.source_id as b_source,
                   ${month("a")} as a_month, ${month("b")} as b_month, ${SCORE} as score`;
  const located = [r.powerToleranceKw, r.maxDistanceKm, r.mileageMinKm, r.mileageShare, r.priceMinEur, r.priceShare];

  // 1. Place and month known on both sides.
  const placed = await client.query<Candidate>(
    `select ${columns}
       from listings a
       join listings b
         on b.make_slug = a.make_slug
        and b.model_slug = a.model_slug
        and b.first_registration = a.first_registration
        and ${mileageWindow}
        and b.source_id <> a.source_id
        and b.id > a.id
      where a.status = 'active' and b.status = 'active'
        and a.make_slug is not null and a.model_slug is not null and a.first_registration is not null
        and not a.first_registration_year_only and not b.first_registration_year_only
        and a.mileage_km is not null and b.mileage_km is not null
        and ${closeMileage} and ${closePrice} and ${COMPATIBLE} and ${near}`,
    located,
  );
  // 2. a gives only the year. A pair of two such listings is read once, from the smaller id.
  const yearOnly = await client.query<Candidate>(
    `select ${columns}
       from listings a
       join listings b
         on b.make_slug = a.make_slug
        and b.model_slug = a.model_slug
        and ${SAME_YEAR}
        and ${mileageWindow}
        and b.source_id <> a.source_id
        and (not b.first_registration_year_only or b.id > a.id)
      where a.status = 'active' and b.status = 'active' and a.first_registration_year_only
        and a.make_slug is not null and a.model_slug is not null and a.first_registration is not null
        and a.mileage_km >= $7 and b.mileage_km >= $7
        and ${closeMileage} and ${closePrice} and ${COMPATIBLE} and ${near}`,
    [...located, r.weakMinMileageKm],
  );
  // 3. a has no place. A pair of two such listings is read once, from the smaller id.
  const unplaced = await client.query<Candidate>(
    `select ${columns}
       from listings a
       join listings b
         on b.make_slug = a.make_slug
        and b.model_slug = a.model_slug
        and ${SAME_YEAR}
        and b.mileage_km = a.mileage_km
        and b.source_id <> a.source_id
        and (b.zip is not null or b.lat is not null or b.id > a.id)
      where a.status = 'active' and b.status = 'active' and a.zip is null and a.lat is null
        and a.make_slug is not null and a.model_slug is not null and a.first_registration is not null
        and a.mileage_km >= $2 and a.mileage_km % $3 <> 0
        and (a.first_registration_year_only or b.first_registration_year_only or b.first_registration = a.first_registration)
        and abs(a.price_eur - b.price_eur) <= greatest($4::int, $5::float8 * greatest(a.price_eur, b.price_eur))
        and ${COMPATIBLE}`,
    [r.powerToleranceKw, r.weakMinMileageKm, r.unplacedRoundKm, r.unplacedPriceMinEur, r.unplacedPriceShare],
  );

  const toPair = (row: Candidate, isWeak: boolean): CandidatePair => ({
    a: Number(row.a),
    b: Number(row.b),
    aSource: row.a_source,
    bSource: row.b_source,
    aMonth: row.a_month,
    bMonth: row.b_month,
    score: Number(row.score),
    weak: isWeak,
  });
  const clusters = groupCandidates([
    ...placed.rows.map((row) => toPair(row, false)),
    ...yearOnly.rows.map((row) => toPair(row, true)),
    ...unplaced.rows.map((row) => toPair(row, true)),
  ]);
  const ids = [...clusters.keys()];
  const clusterIds = ids.map((id) => clusters.get(id)!);

  await client.query(
    `update listings l set cluster_id = v.cluster_id
       from unnest($1::int8[], $2::int8[]) as v (id, cluster_id)
      where l.id = v.id and l.cluster_id is distinct from v.cluster_id`,
    [ids, clusterIds],
  );
  await client.query("update listings set cluster_id = null where cluster_id is not null and not (id = any($1::int8[]))", [
    ids,
  ]);
  return { clusters: new Set(clusterIds).size, listings: ids.length };
}

export interface CandidatePair {
  a: number;
  b: number;
  aSource: string;
  bSource: string;
  /** Known month of first registration ("2019-03"); null or left out when only the year is known. */
  aMonth?: string | null;
  bMonth?: string | null;
  /** Lower is a closer match; closer pairs are joined first. */
  score: number;
  /**
   * Matched without a place or a month to confirm it (kinds 2 and 3 above): counts only when
   * unambiguous, and after every pair that is not weak.
   */
  weak?: boolean;
}

/**
 * Joins candidate pairs into groups, closest pairs first, and never puts two listings of the same
 * source or two different known months of first registration into one group. A weak pair counts
 * only when neither listing has another candidate on the other's portal, and comes after all
 * other pairs. Returns the cluster id (smallest member id) of every grouped listing.
 */
export function groupCandidates(pairs: CandidatePair[]): Map<number, number> {
  // How many candidates each listing has per portal, over all pairs.
  const candidates = new Map<string, number>();
  const key = (id: number, source: string) => `${id}\u0000${source}`;
  const count = (id: number, source: string) => candidates.set(key(id, source), (candidates.get(key(id, source)) ?? 0) + 1);
  for (const pair of pairs) {
    count(pair.a, pair.bSource);
    count(pair.b, pair.aSource);
  }
  const usable = pairs.filter(
    (pair) => !pair.weak || (candidates.get(key(pair.a, pair.bSource)) === 1 && candidates.get(key(pair.b, pair.aSource)) === 1),
  );

  const parent = new Map<number, number>();
  const sources = new Map<number, Set<string>>();
  // The known month of first registration of each group (by root), null while none is known.
  const months = new Map<number, string | null>();
  const find = (id: number): number => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression.
    for (let node = id; node !== root; ) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const add = (id: number, source: string, month: string | null | undefined) => {
    if (!parent.has(id)) {
      parent.set(id, id);
      sources.set(id, new Set([source]));
      months.set(id, month ?? null);
    }
  };

  const rank = (pair: CandidatePair) => (pair.weak ? 1 : 0);
  for (const pair of usable.sort((x, y) => rank(x) - rank(y) || x.score - y.score || x.a - y.a || x.b - y.b)) {
    add(pair.a, pair.aSource, pair.aMonth);
    add(pair.b, pair.bSource, pair.bMonth);
    const rootA = find(pair.a);
    const rootB = find(pair.b);
    if (rootA === rootB) continue;
    const sourcesA = sources.get(rootA)!;
    const sourcesB = sources.get(rootB)!;
    if ([...sourcesB].some((source) => sourcesA.has(source))) continue;
    const monthA = months.get(rootA)!;
    const monthB = months.get(rootB)!;
    if (monthA !== null && monthB !== null && monthA !== monthB) continue;
    // The smaller id becomes the root, so the root is the cluster id.
    const [keep, drop] = rootA < rootB ? [rootA, rootB] : [rootB, rootA];
    parent.set(drop, keep);
    for (const source of sources.get(drop)!) sources.get(keep)!.add(source);
    sources.delete(drop);
    months.set(keep, monthA ?? monthB);
    months.delete(drop);
  }

  const result = new Map<number, number>();
  for (const id of parent.keys()) result.set(id, find(id));
  // Every listing in a pair that could not join anything is in a group of one: leave it out.
  const sizes = new Map<number, number>();
  for (const root of result.values()) sizes.set(root, (sizes.get(root) ?? 0) + 1);
  for (const [id, root] of result) if (sizes.get(root)! < 2) result.delete(id);
  return result;
}
