import type { Pool, PoolClient } from "pg";
import { distanceSql } from "@/core/geo";

/**
 * Finds the same vehicle offered on several portals and gives those listings a shared
 * cluster_id (the smallest listing id of the group), so the search can show it once.
 *
 * Two active listings from different sources count as the same vehicle when all of this holds:
 * - same make, model and month of first registration (all known),
 * - mileage within 2 % (at least 500 km), because sellers round and keep driving,
 * - price within 8 % (at least 500 EUR), because prices differ between portals,
 * - same postal code or at most 25 km apart,
 * - power, fuel and gearbox do not contradict each other where both sides know them.
 * A group never holds two listings of the same source: a vehicle is listed once per portal.
 */

export const MATCH_RULES = {
  mileageShare: 0.02,
  mileageMinKm: 500,
  priceShare: 0.08,
  priceMinEur: 500,
  maxDistanceKm: 25,
  powerToleranceKw: 3,
} as const;

interface Candidate {
  a: number;
  b: number;
  a_source: string;
  b_source: string;
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

async function regroup(client: PoolClient): Promise<DuplicateResult> {
  const r = MATCH_RULES;
  const distance = distanceSql("a.lat", "a.lng", "b.lat", "b.lng");
  const { rows } = await client.query<Candidate>(
    `select a.id::int8 as a, b.id::int8 as b, a.source_id as a_source, b.source_id as b_source,
            abs(a.mileage_km - b.mileage_km)::float8 / greatest(a.mileage_km, b.mileage_km, 1)
              + abs(a.price_eur - b.price_eur)::float8 / greatest(a.price_eur, b.price_eur, 1) as score
       from listings a
       join listings b
         on b.make_slug = a.make_slug
        and b.model_slug = a.model_slug
        and b.first_registration = a.first_registration
        and b.source_id <> a.source_id
        and b.id > a.id
      where a.status = 'active' and b.status = 'active'
        and a.make_slug is not null and a.model_slug is not null and a.first_registration is not null
        and a.mileage_km is not null and b.mileage_km is not null
        and abs(a.mileage_km - b.mileage_km) <= greatest($1::int, $2::float8 * greatest(a.mileage_km, b.mileage_km))
        and abs(a.price_eur - b.price_eur) <= greatest($3::int, $4::float8 * greatest(a.price_eur, b.price_eur))
        and (a.power_kw is null or b.power_kw is null or abs(a.power_kw - b.power_kw) <= $5)
        and (a.fuel is null or b.fuel is null or a.fuel = b.fuel)
        and (a.transmission is null or b.transmission is null or a.transmission = b.transmission)
        and (a.zip = b.zip or (a.lat is not null and b.lat is not null and ${distance} <= $6))`,
    [r.mileageMinKm, r.mileageShare, r.priceMinEur, r.priceShare, r.powerToleranceKw, r.maxDistanceKm],
  );

  const clusters = groupCandidates(
    rows.map((row) => ({ a: Number(row.a), b: Number(row.b), aSource: row.a_source, bSource: row.b_source, score: Number(row.score) })),
  );
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
  /** Lower is a closer match; closer pairs are joined first. */
  score: number;
}

/**
 * Joins candidate pairs into groups, closest pairs first, and never puts two listings of the same
 * source into one group. Returns the cluster id (smallest member id) of every grouped listing.
 */
export function groupCandidates(pairs: CandidatePair[]): Map<number, number> {
  const parent = new Map<number, number>();
  const sources = new Map<number, Set<string>>();
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
  const add = (id: number, source: string) => {
    if (!parent.has(id)) {
      parent.set(id, id);
      sources.set(id, new Set([source]));
    }
  };

  for (const pair of [...pairs].sort((x, y) => x.score - y.score || x.a - y.a || x.b - y.b)) {
    add(pair.a, pair.aSource);
    add(pair.b, pair.bSource);
    const rootA = find(pair.a);
    const rootB = find(pair.b);
    if (rootA === rootB) continue;
    const sourcesA = sources.get(rootA)!;
    const sourcesB = sources.get(rootB)!;
    if ([...sourcesB].some((source) => sourcesA.has(source))) continue;
    // The smaller id becomes the root, so the root is the cluster id.
    const [keep, drop] = rootA < rootB ? [rootA, rootB] : [rootB, rootA];
    parent.set(drop, keep);
    for (const source of sources.get(drop)!) sources.get(keep)!.add(source);
    sources.delete(drop);
  }

  const result = new Map<number, number>();
  for (const id of parent.keys()) result.set(id, find(id));
  // Every listing in a pair that could not join anything is in a group of one: leave it out.
  const sizes = new Map<number, number>();
  for (const root of result.values()) sizes.set(root, (sizes.get(root) ?? 0) + 1);
  for (const [id, root] of result) if (sizes.get(root)! < 2) result.delete(id);
  return result;
}
