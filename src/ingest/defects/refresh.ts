import type { Pool } from "pg";
import { classifyDefect } from "@/core/defect-codes";
import {
  ageBucket,
  bucketYears,
  MIN_SAMPLE,
  WINDOW_MONTHS,
  type DefectComponent,
  type DefectProfile,
} from "@/core/defects";
import { resolveModelInTitle } from "@/core/normalize";
import { findMake } from "@/core/taxonomy";
import { DEFAULT_USER_AGENT, PoliteFetcher } from "../http/fetcher";
import { readBoolean, readNumber } from "../http/config";
import { PASSENGER_CARS, RdwClient, soqlDate, soqlIn } from "./rdw";

/**
 * Builds the defect profiles (src/core/defects.ts) for the models and ages AutoMeta has listings
 * of, from RDW open data. Per model and age group it draws a sample of Dutch cars that are on the
 * road with a valid inspection, and counts which of them had a defect at an inspection in the
 * last WINDOW_MONTHS, per component group. Only these counts are stored.
 *
 * The most useful profiles come first (models with damaged listings, then the most listed), and
 * a run stops at its request budget; the next run continues. Profiles older than maxAgeDays are
 * fetched again.
 */

export const DEFECT_REFRESH = {
  /** Cars sampled per model and age group, in two slices from different parts of the register. */
  sampleSize: 300,
  /** Number plates per defect query (they go into the URL). */
  platesPerQuery: 150,
  /** A model and age group is profiled when AutoMeta has this many listings of it, or one damaged. */
  minListings: 10,
  /** RDW trade names with fewer cars are ignored (typos, one-off imports). */
  minTradeNameCars: 20,
  /** At most this many trade names per model go into a query, the most common first. */
  maxTradeNames: 40,
  maxAgeDays: 90,
  /** The defect list is fetched again after this many days. */
  codesMaxAgeDays: 30,
} as const;

export interface RefreshResult {
  /** Profiles written in this run. */
  profiles: number;
  requests: number;
  /** Profiles that are due but did not fit into this run. */
  pending: number;
  error: string | null;
}

export interface RefreshOptions {
  client?: RdwClient;
  now?: Date;
  log?: (message: string) => void;
  random?: () => number;
  /** Asked between profiles; true ends the run early. */
  shouldStop?: () => boolean;
}

/** The fetcher RDW queries go through: robots.txt and pacing like the scrapers, its own budget. */
export function createRdwClientFromEnv(): RdwClient {
  return new RdwClient(
    new PoliteFetcher({
      userAgent: process.env.SCRAPE_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
      respectRobots: readBoolean("SCRAPE_RESPECT_ROBOTS", true),
      minDelayMs: readNumber("RDW_MIN_DELAY_MS", 2000, 1000),
      maxRequests: readNumber("RDW_MAX_REQUESTS", 600, 10),
      // Counting or grouping a million cars can take the API a while.
      timeoutMs: 120_000,
    }),
  );
}

interface Cell {
  make: string;
  model: string;
  bucket: number;
  listings: number;
  damaged: number;
}

const LOCK = "hashtext('autometa-defect-profiles')";
/** Requests one profile takes at most: count, two slices, two defect queries. */
const REQUESTS_PER_PROFILE = 5;

export async function refreshDefectProfiles(pool: Pool, options: RefreshOptions = {}): Promise<RefreshResult> {
  const now = options.now ?? new Date();
  const log = options.log ?? ((message: string) => console.log(`[defects] ${message}`));
  const random = options.random ?? Math.random;
  const rdw = options.client ?? createRdwClientFromEnv();
  const lockClient = await pool.connect();
  try {
    const { rows } = await lockClient.query<{ locked: boolean }>(`select pg_try_advisory_lock(${LOCK}) as locked`);
    if (!rows[0].locked) {
      log("another refresh is running, skipped");
      return { profiles: 0, requests: 0, pending: 0, error: null };
    }
    try {
      return await run(pool, rdw, now, log, random, options.shouldStop ?? (() => false));
    } finally {
      await lockClient.query(`select pg_advisory_unlock(${LOCK})`);
    }
  } finally {
    lockClient.release();
  }
}

async function run(
  pool: Pool,
  rdw: RdwClient,
  now: Date,
  log: (message: string) => void,
  random: () => number,
  shouldStop: () => boolean,
): Promise<RefreshResult> {
  const runId = (await pool.query<{ id: string }>("insert into defect_profile_runs default values returning id")).rows[0].id;
  let profiles = 0;
  let pending = 0;
  let error: string | null = null;
  try {
    const codes = await defectCodes(pool, rdw, now, log);
    const cells = await dueCells(pool, now);
    pending = cells.length;
    log(`${cells.length} model and age groups due, ${codes.size} defect codes`);

    const namesByMake = new Map<string, Map<string, string[]>>();
    const since = new Date(now);
    since.setUTCMonth(since.getUTCMonth() - WINDOW_MONTHS);

    for (const cell of cells) {
      if (shouldStop() || rdw.requestsLeft < REQUESTS_PER_PROFILE + 1) break;
      let models = namesByMake.get(cell.make);
      if (!models) {
        models = await tradeNamesByModel(rdw, cell.make);
        namesByMake.set(cell.make, models);
        if (rdw.requestsLeft < REQUESTS_PER_PROFILE) break;
      }
      const names = models.get(cell.model) ?? [];
      const profile = names.length > 0 ? await sampleProfile(rdw, cell, names, codes, since, now, random) : emptyProfile();
      await saveProfile(pool, cell, profile, names, now);
      profiles += 1;
      pending -= 1;
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    log(`failed: ${error}`);
  } finally {
    await pool.query(
      "update defect_profile_runs set finished_at = now(), profiles = $2, requests = $3, error = $4 where id = $1",
      [runId, profiles, rdw.requestsMade, error],
    );
  }
  log(`${profiles} profiles written, ${pending} still due, ${rdw.requestsMade} requests`);
  return { profiles, requests: rdw.requestsMade, pending, error };
}

/** The defect list with each code's component group; fetched again when old, re-classified every run. */
async function defectCodes(
  pool: Pool,
  rdw: RdwClient,
  now: Date,
  log: (message: string) => void,
): Promise<Map<string, DefectComponent | null>> {
  const { rows: age } = await pool.query<{ oldest: Date | null; n: number }>(
    "select min(fetched_at) as oldest, count(*)::int as n from rdw_defect_codes",
  );
  const stale = age[0].n === 0 || now.getTime() - new Date(age[0].oldest!).getTime() > DEFECT_REFRESH.codesMaxAgeDays * 86_400_000;
  if (stale) {
    const fetched = await rdw.defectCodes();
    if (fetched.length === 0) throw new Error("RDW defect list is empty");
    await pool.query(
      `insert into rdw_defect_codes (code, description, component, fetched_at)
       select v.code, v.description, null, $2 from jsonb_to_recordset($1::jsonb) as v(code text, description text)
       on conflict (code) do update set description = excluded.description, fetched_at = excluded.fetched_at`,
      [JSON.stringify(fetched), now],
    );
    log(`defect list: ${fetched.length} codes`);
  }
  // The rules live in the code, so a deploy with better rules applies them to the stored list.
  const { rows } = await pool.query<{ code: string; description: string; component: string | null }>(
    "select code, description, component from rdw_defect_codes",
  );
  const codes = new Map<string, DefectComponent | null>();
  const changed: { code: string; component: string | null }[] = [];
  for (const row of rows) {
    const component = classifyDefect(row.description);
    codes.set(row.code, component);
    if (component !== row.component) changed.push({ code: row.code, component });
  }
  if (changed.length > 0) {
    await pool.query(
      `update rdw_defect_codes c set component = v.component
         from jsonb_to_recordset($1::jsonb) as v(code text, component text) where c.code = v.code`,
      [JSON.stringify(changed)],
    );
  }
  return codes;
}

/** Model and age groups with enough listings whose profile is missing or older than maxAgeDays, most useful first. */
async function dueCells(pool: Pool, now: Date): Promise<Cell[]> {
  const { rows } = await pool.query<{ make_slug: string; model_slug: string; year: number; listings: number; damaged: number }>(
    `select make_slug, model_slug, extract(year from first_registration)::int as year,
            count(*)::int as listings, count(*) filter (where cardinality(damage) > 0)::int as damaged
       from listings
      where status = 'active' and make_slug is not null and model_slug is not null and first_registration is not null
      group by 1, 2, 3`,
  );
  const cells = new Map<string, Cell>();
  for (const row of rows) {
    const bucket = ageBucket(String(row.year), now);
    if (bucket === null) continue;
    const key = `${row.make_slug}/${row.model_slug}/${bucket}`;
    const cell = cells.get(key) ?? { make: row.make_slug, model: row.model_slug, bucket, listings: 0, damaged: 0 };
    cell.listings += row.listings;
    cell.damaged += row.damaged;
    cells.set(key, cell);
  }
  const { rows: fresh } = await pool.query<{ key: string }>(
    `select make_slug || '/' || model_slug || '/' || age_bucket as key
       from model_defect_profiles where refreshed_at > $1::timestamptz - make_interval(days => $2::int)`,
    [now, DEFECT_REFRESH.maxAgeDays],
  );
  const done = new Set(fresh.map((row) => row.key));
  return [...cells]
    .filter(([key, cell]) => !done.has(key) && (cell.damaged > 0 || cell.listings >= DEFECT_REFRESH.minListings) && findMake(cell.make))
    .map(([, cell]) => cell)
    .sort((a, b) => b.damaged - a.damaged || b.listings - a.listings || a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || a.bucket - b.bucket);
}

/** How RDW may spell one of our makes: "VOLKSWAGEN", "VW", "MERCEDES-BENZ", "CITROEN". */
export function rdwMakeNames(makeSlug: string): string[] {
  const make = findMake(makeSlug);
  if (!make) return [];
  const upper = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
  return [...new Set([make.name, make.slug, ...(make.aliases ?? [])].map(upper).filter(Boolean))];
}

/** RDW trade names of a make, grouped by our model they mean, the most common first. */
async function tradeNamesByModel(rdw: RdwClient, makeSlug: string): Promise<Map<string, string[]>> {
  const make = findMake(makeSlug)!;
  const names = await rdw.tradeNames(rdwMakeNames(makeSlug));
  const byModel = new Map<string, string[]>();
  for (const { name, cars } of names) {
    if (cars < DEFECT_REFRESH.minTradeNameCars) continue;
    const resolved = resolveModelInTitle(make.name, name);
    if (resolved.makeSlug !== makeSlug || !resolved.modelSlug) continue;
    const list = byModel.get(resolved.modelSlug) ?? [];
    if (list.length < DEFECT_REFRESH.maxTradeNames) list.push(name);
    byModel.set(resolved.modelSlug, list);
  }
  return byModel;
}

const emptyProfile = (): DefectProfile => ({ sample: 0, anyDefect: 0, components: {} });

async function sampleProfile(
  rdw: RdwClient,
  cell: Cell,
  names: string[],
  codes: Map<string, DefectComponent | null>,
  since: Date,
  now: Date,
  random: () => number,
): Promise<DefectProfile> {
  const [fromYear, toYear] = bucketYears(cell.bucket, now);
  // On the road today with a valid inspection, so each had one within the window.
  const where = [
    PASSENGER_CARS,
    soqlIn("merk", rdwMakeNames(cell.make)),
    soqlIn("handelsbenaming", names),
    `datum_eerste_toelating_dt between '${fromYear}-01-01T00:00:00' and '${toYear}-12-31T23:59:59'`,
    `vervaldatum_apk_dt >= ${soqlDate(now)}`,
  ].join(" AND ");
  const total = await rdw.countVehicles(where);
  if (total < MIN_SAMPLE) return emptyProfile();

  // Plates run roughly in order of registration in the Netherlands, so one slice from each half.
  const size = DEFECT_REFRESH.sampleSize;
  let plates: string[];
  if (total <= size) {
    plates = await rdw.vehiclePlates(where, size, 0);
  } else {
    const slice = Math.floor(size / 2);
    const half = Math.floor(total / 2);
    const first = Math.floor(random() * Math.max(1, half - slice));
    const second = half + Math.floor(random() * Math.max(1, total - half - slice));
    plates = [...(await rdw.vehiclePlates(where, slice, first)), ...(await rdw.vehiclePlates(where, slice, second))];
  }
  plates = [...new Set(plates)];

  const perPlate = new Map<string, Set<DefectComponent | "any">>();
  for (let i = 0; i < plates.length; i += DEFECT_REFRESH.platesPerQuery) {
    for (const { plate, code } of await rdw.defectsOf(plates.slice(i, i + DEFECT_REFRESH.platesPerQuery), since)) {
      const found = perPlate.get(plate) ?? new Set();
      found.add("any");
      const component = codes.get(code);
      if (component) found.add(component);
      perPlate.set(plate, found);
    }
  }
  const profile: DefectProfile = { sample: plates.length, anyDefect: 0, components: {} };
  for (const found of perPlate.values()) {
    for (const item of found) {
      if (item === "any") profile.anyDefect += 1;
      else profile.components[item] = (profile.components[item] ?? 0) + 1;
    }
  }
  return profile;
}

async function saveProfile(pool: Pool, cell: Cell, profile: DefectProfile, names: string[], now: Date): Promise<void> {
  await pool.query(
    `insert into model_defect_profiles (make_slug, model_slug, age_bucket, sample, any_defect, components, window_months, rdw_names, refreshed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (make_slug, model_slug, age_bucket) do update
       set sample = excluded.sample, any_defect = excluded.any_defect, components = excluded.components,
           window_months = excluded.window_months, rdw_names = excluded.rdw_names, refreshed_at = excluded.refreshed_at`,
    [cell.make, cell.model, cell.bucket, profile.sample, profile.anyDefect, JSON.stringify(profile.components), WINDOW_MONTHS, names, now],
  );
}
