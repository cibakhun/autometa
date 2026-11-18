import type { Pool } from "pg";

/** How each source is doing: listings in the search and its latest import runs. */

export interface SourceHealth {
  id: string;
  name: string;
  kind: string;
  activeListings: number;
  goneListings: number;
  lastRun: RunInfo | null;
  /** End of the last run that stored at least one listing. */
  lastSuccessAt: string | null;
}

export interface RunInfo {
  id: number;
  sourceId: string;
  startedAt: string;
  finishedAt: string | null;
  fetched: number;
  upserted: number;
  skipped: number;
  gone: number;
  error: string | null;
}

const iso = (value: unknown): string | null => (value ? new Date(value as string).toISOString() : null);

function toRun(row: Record<string, unknown>): RunInfo {
  return {
    id: Number(row.id),
    sourceId: row.source_id as string,
    startedAt: iso(row.started_at) as string,
    finishedAt: iso(row.finished_at),
    fetched: Number(row.fetched),
    upserted: Number(row.upserted),
    skipped: Number(row.skipped),
    gone: Number(row.gone),
    error: (row.error as string | null) ?? null,
  };
}

export async function getSourceHealth(pool: Pool): Promise<SourceHealth[]> {
  const { rows } = await pool.query(
    `select s.id, s.name, s.kind,
            (select count(*) from listings l where l.source_id = s.id and l.status = 'active')::int as active_listings,
            (select count(*) from listings l where l.source_id = s.id and l.status = 'gone')::int as gone_listings,
            (select max(r.finished_at) from ingest_runs r where r.source_id = s.id and r.upserted > 0) as last_success_at,
            r.id as run_id, r.started_at, r.finished_at, r.fetched, r.upserted, r.skipped, r.gone, r.error
       from sources s
       left join lateral (
         select * from ingest_runs r where r.source_id = s.id order by r.started_at desc, r.id desc limit 1
       ) r on true
      order by s.name`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    activeListings: row.active_listings,
    goneListings: row.gone_listings,
    lastSuccessAt: iso(row.last_success_at),
    lastRun: row.run_id === null ? null : toRun({ ...row, id: row.run_id, source_id: row.id }),
  }));
}

export async function getRecentRuns(pool: Pool, limit = 40): Promise<RunInfo[]> {
  const { rows } = await pool.query(
    "select * from ingest_runs order by started_at desc, id desc limit $1",
    [limit],
  );
  return rows.map(toRun);
}
