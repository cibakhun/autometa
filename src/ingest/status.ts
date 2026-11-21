import type { Pool } from "pg";

/** How each source is doing: listings in the search and its latest import runs. */

export interface SourceHealth {
  id: string;
  name: string;
  kind: string;
  activeListings: number;
  goneListings: number;
  /** Active listings seen in a list or confirmed on their own page in the last 24 hours. */
  checked24h: number;
  /** When the active listing seen or confirmed longest ago was, null without active listings. */
  oldestCheckAt: string | null;
  /**
   * Listings that left the search in the last 24 hours: missed in complete list reads (sold),
   * taken down according to their own page, or neither seen nor confirmed for too long.
   */
  goneLastDay: { missed: number; checked: number; stale: number };
  /** The crawl plan, for sources that read their inventory in segments (AutoScout24). */
  plan: PlanHealth | null;
  lastRun: RunInfo | null;
  /** End of the last run that stored at least one listing. */
  lastSuccessAt: string | null;
}

export interface PlanHealth {
  segments: number;
  /** Listings the portal reported for all segments at their last read. */
  listed: number;
  /** Segments read completely in the last 24 hours. */
  readLastDay: number;
  /** Segments never read completely. */
  neverRead: number;
  /** The longest ago a segment was read completely, null when none was. */
  oldestReadAt: string | null;
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
  checked: number;
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
    checked: Number(row.checked ?? 0),
    error: (row.error as string | null) ?? null,
  };
}

export async function getSourceHealth(pool: Pool): Promise<SourceHealth[]> {
  const { rows } = await pool.query(
    `select s.id, s.name, s.kind,
            coalesce(c.active, 0) as active_listings, coalesce(c.gone, 0) as gone_listings,
            coalesce(c.checked_24h, 0) as checked_24h, c.oldest_check_at,
            coalesce(c.missed_24h, 0) as missed_24h, coalesce(c.checked_gone_24h, 0) as checked_gone_24h,
            coalesce(c.stale_24h, 0) as stale_24h,
            p.segments, p.listed, p.read_last_day, p.never_read, p.oldest_read_at,
            (select max(r.finished_at) from ingest_runs r where r.source_id = s.id and r.upserted > 0) as last_success_at,
            r.id as run_id, r.started_at, r.finished_at, r.fetched, r.upserted, r.skipped, r.gone, r.checked, r.error
       from sources s
       left join lateral (
         select count(*) filter (where l.status = 'active')::int as active,
                count(*) filter (where l.status = 'gone')::int as gone,
                count(*) filter (where l.status = 'active' and l.last_seen_at > now() - interval '24 hours')::int as checked_24h,
                min(l.last_seen_at) filter (where l.status = 'active') as oldest_check_at,
                count(*) filter (where l.status = 'gone' and l.gone_reason = 'missed' and l.gone_at > now() - interval '24 hours')::int as missed_24h,
                count(*) filter (where l.status = 'gone' and l.gone_reason = 'checked' and l.gone_at > now() - interval '24 hours')::int as checked_gone_24h,
                count(*) filter (where l.status = 'gone' and l.gone_reason = 'stale' and l.gone_at > now() - interval '24 hours')::int as stale_24h
           from listings l where l.source_id = s.id
       ) c on true
       left join lateral (
         select count(*)::int as segments, coalesce(sum(g.last_total), 0)::int as listed,
                count(*) filter (where g.last_completed_at > now() - interval '24 hours')::int as read_last_day,
                count(*) filter (where g.last_completed_at is null)::int as never_read,
                min(g.last_completed_at) as oldest_read_at
           from crawl_segments g where g.source_id = s.id and not g.retired
       ) p on p.segments > 0
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
    checked24h: row.checked_24h,
    oldestCheckAt: iso(row.oldest_check_at),
    goneLastDay: { missed: row.missed_24h, checked: row.checked_gone_24h, stale: row.stale_24h },
    plan:
      row.segments === null
        ? null
        : {
            segments: row.segments,
            listed: row.listed,
            readLastDay: row.read_last_day,
            neverRead: row.never_read,
            oldestReadAt: iso(row.oldest_read_at),
          },
    lastSuccessAt: iso(row.last_success_at),
    lastRun: row.run_id === null ? null : toRun({ ...row, id: row.run_id, source_id: row.id }),
  }));
}

export interface SourceStats {
  sourceId: string;
  active: number;
  checked24h: number;
}

/**
 * Stores per source how many active listings there are and how many of them were seen in a list
 * or confirmed on their own page in the last 24 hours, for the notice above the search (counting
 * half a million listings on every page view would be too slow). Runs after each import round.
 */
export async function updateSourceStats(pool: Pool): Promise<SourceStats[]> {
  const { rows } = await pool.query<{ id: string; active: number; checked: number }>(
    `with counts as (
       select source_id, count(*)::int as active,
              count(*) filter (where last_seen_at > now() - interval '24 hours')::int as checked
         from listings where status = 'active' group by source_id
     )
     update sources s
        set active_listings = coalesce(c.active, 0), checked_24h = coalesce(c.checked, 0), stats_at = now()
       from sources s2 left join counts c on c.source_id = s2.id
      where s.id = s2.id
     returning s.id, s.active_listings as active, s.checked_24h as checked`,
  );
  return rows
    .map((row) => ({ sourceId: row.id, active: row.active, checked24h: row.checked }))
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

export async function getRecentRuns(pool: Pool, limit = 40): Promise<RunInfo[]> {
  const { rows } = await pool.query(
    "select * from ingest_runs order by started_at desc, id desc limit $1",
    [limit],
  );
  return rows.map(toRun);
}
