import type { Pool } from "pg";
import { ageBucket, MIN_SAMPLE, poolProfiles, type DefectProfile } from "@/core/defects";

/** Stored profiles of every model and age group, plus the average car per age group. */
export class ProfileIndex {
  private readonly byKey = new Map<string, DefectProfile>();
  private readonly averages: (DefectProfile | null)[] = [];

  constructor(rows: { make: string; model: string; bucket: number; profile: DefectProfile }[]) {
    const perBucket = new Map<number, DefectProfile[]>();
    for (const row of rows) {
      this.byKey.set(`${row.make}/${row.model}/${row.bucket}`, row.profile);
      perBucket.set(row.bucket, [...(perBucket.get(row.bucket) ?? []), row.profile]);
    }
    for (const [bucket, profiles] of perBucket) {
      const pooled = poolProfiles(profiles);
      this.averages[bucket] = pooled.sample >= MIN_SAMPLE ? pooled : null;
    }
  }

  get size(): number {
    return this.byKey.size;
  }

  /** The model's profile when it has enough sampled cars, else null. */
  model(make: string | null, model: string | null, bucket: number): DefectProfile | null {
    if (!make || !model) return null;
    const profile = this.byKey.get(`${make}/${model}/${bucket}`);
    return profile && profile.sample >= MIN_SAMPLE ? profile : null;
  }

  /** The average car of an age group, or null before any profile exists. */
  average(bucket: number): DefectProfile | null {
    return this.averages[bucket] ?? null;
  }
}

interface ProfileRow {
  make_slug: string;
  model_slug: string;
  age_bucket: number;
  sample: number;
  any_defect: number;
  components: DefectProfile["components"];
}

const toProfile = (row: ProfileRow): DefectProfile => ({ sample: row.sample, anyDefect: row.any_defect, components: row.components });

/** Every stored profile with enough sampled cars. */
export async function loadProfileIndex(pool: Pool): Promise<ProfileIndex> {
  const { rows } = await pool.query<ProfileRow>(
    `select make_slug, model_slug, age_bucket, sample, any_defect, components
       from model_defect_profiles where sample >= $1`,
    [MIN_SAMPLE],
  );
  return new ProfileIndex(rows.map((row) => ({ make: row.make_slug, model: row.model_slug, bucket: row.age_bucket, profile: toProfile(row) })));
}

export interface ModelFile {
  bucket: number;
  /** The model's profile, or null when the Dutch register has too few such cars or none were sampled yet. */
  profile: DefectProfile | null;
  /** The average car of the same age group. */
  average: DefectProfile | null;
  /** RDW trade names the model's sample came from. */
  rdwNames: string[];
  refreshedAt: string | null;
}

/** The defect data for one car: its model's profile at its age and the average of that age. */
export async function getModelFile(
  pool: Pool,
  make: string | null,
  model: string | null,
  firstRegistration: string | null,
  now = new Date(),
): Promise<ModelFile | null> {
  const bucket = ageBucket(firstRegistration, now);
  if (bucket === null) return null;
  const [own, average] = await Promise.all([
    make && model
      ? pool.query<ProfileRow & { rdw_names: string[]; refreshed_at: Date }>(
          `select make_slug, model_slug, age_bucket, sample, any_defect, components, rdw_names, refreshed_at
             from model_defect_profiles where make_slug = $1 and model_slug = $2 and age_bucket = $3`,
          [make, model, bucket],
        )
      : null,
    pool.query<{ sample: number; any_defect: number; components: DefectProfile["components"] }>(
      `select sample, any_defect, components from model_defect_profiles where age_bucket = $1 and sample >= $2`,
      [bucket, MIN_SAMPLE],
    ),
  ]);
  const row = own?.rows[0];
  const pooled = poolProfiles(average.rows.map((r) => ({ sample: r.sample, anyDefect: r.any_defect, components: r.components })));
  return {
    bucket,
    profile: row && row.sample >= MIN_SAMPLE ? toProfile(row) : null,
    average: pooled.sample >= MIN_SAMPLE ? pooled : null,
    rdwNames: row?.rdw_names ?? [],
    refreshedAt: row ? new Date(row.refreshed_at).toISOString() : null,
  };
}

export interface DefectDataStatus {
  /** Model and age groups with enough sampled cars. */
  profiles: number;
  /** Cars sampled across those. */
  cars: number;
  lastRunAt: string | null;
  lastError: string | null;
}

/** How far the defect data is, for the catalog page. */
export async function getDefectDataStatus(pool: Pool): Promise<DefectDataStatus> {
  const [profiles, run] = await Promise.all([
    pool.query<{ profiles: number; cars: number }>(
      `select count(*)::int as profiles, coalesce(sum(sample), 0)::int as cars from model_defect_profiles where sample >= $1`,
      [MIN_SAMPLE],
    ),
    pool.query<{ finished_at: Date | null; started_at: Date; error: string | null }>(
      `select started_at, finished_at, error from defect_profile_runs order by id desc limit 1`,
    ),
  ]);
  const last = run.rows[0];
  return {
    profiles: profiles.rows[0].profiles,
    cars: profiles.rows[0].cars,
    lastRunAt: last ? new Date(last.finished_at ?? last.started_at).toISOString() : null,
    lastError: last?.error ?? null,
  };
}
