import type { Pool, PoolClient } from "pg";

/**
 * Pages exactly as a portal sent them, kept for diagnosis (table scrape_samples). They show how
 * a portal builds its pages, so adapters are written and fixed against the real thing. Only the
 * newest MAX_SAMPLES are kept, each cut at MAX_BODY_CHARS.
 */

export const MAX_SAMPLES = 80;
export const MAX_BODY_CHARS = 3_000_000;

export type SampleReason = "probe" | "probe-script" | "format-error";

export interface NewSample {
  sourceId: string | null;
  url: string;
  status: number;
  reason: SampleReason;
  body: string;
}

export interface SampleInfo {
  id: number;
  sourceId: string | null;
  url: string;
  status: number;
  reason: string;
  length: number;
  truncated: boolean;
  capturedAt: string;
}

export interface Sample extends SampleInfo {
  body: string;
}

type Db = Pool | PoolClient;

export async function saveSample(db: Db, sample: NewSample): Promise<number> {
  const truncated = sample.body.length > MAX_BODY_CHARS;
  // Postgres text cannot hold NUL characters.
  const body = (truncated ? sample.body.slice(0, MAX_BODY_CHARS) : sample.body).replace(/\0/g, "");
  const { rows } = await db.query<{ id: string }>(
    `insert into scrape_samples (source_id, url, status, reason, body, truncated)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [sample.sourceId, sample.url, sample.status, sample.reason, body, truncated],
  );
  await db.query(
    `delete from scrape_samples
      where id not in (select id from scrape_samples order by captured_at desc, id desc limit $1)`,
    [MAX_SAMPLES],
  );
  return Number(rows[0].id);
}

export async function listSamples(db: Db, limit = MAX_SAMPLES): Promise<SampleInfo[]> {
  const { rows } = await db.query(
    `select id, source_id, url, status, reason, length(body) as length, truncated, captured_at
       from scrape_samples order by captured_at desc, id desc limit $1`,
    [limit],
  );
  return rows.map(toInfo);
}

export async function getSample(db: Db, id: number): Promise<Sample | null> {
  const { rows } = await db.query(
    `select id, source_id, url, status, reason, length(body) as length, truncated, captured_at, body
       from scrape_samples where id = $1`,
    [id],
  );
  return rows[0] ? { ...toInfo(rows[0]), body: rows[0].body } : null;
}

function toInfo(row: Record<string, unknown>): SampleInfo {
  return {
    id: Number(row.id),
    sourceId: (row.source_id as string | null) ?? null,
    url: row.url as string,
    status: Number(row.status),
    reason: row.reason as string,
    length: Number(row.length),
    truncated: Boolean(row.truncated),
    capturedAt: new Date(row.captured_at as string).toISOString(),
  };
}

export interface SliceOptions {
  /** Case-insensitive regular expression; only the passages around its matches are returned. */
  grep?: string;
  /** Characters shown before and after each match. */
  context?: number;
  /** Most matches returned. */
  maxMatches?: number;
  /** Without grep: start and length of the slice. */
  from?: number;
  length?: number;
}

/**
 * Cuts a large page down to what one needs to read: a slice, or the passages around the
 * matches of a pattern, each headed by its position.
 */
export function sliceBody(body: string, options: SliceOptions = {}): string {
  if (options.grep) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(options.grep, "gi");
    } catch (error) {
      return `Invalid pattern: ${error instanceof Error ? error.message : String(error)}`;
    }
    const context = clamp(options.context ?? 300, 0, 20_000);
    const maxMatches = clamp(options.maxMatches ?? 20, 1, 200);
    const parts: string[] = [];
    let total = 0;
    let lastEnd = -1;
    for (const match of body.matchAll(pattern)) {
      if (match[0].length === 0) break;
      total += 1;
      const start = Math.max(0, match.index - context);
      if (start < lastEnd) continue; // inside the previous passage already
      if (parts.length >= maxMatches) continue;
      const end = Math.min(body.length, match.index + match[0].length + context);
      parts.push(`--- @${match.index} ---\n${body.slice(start, end)}`);
      lastEnd = end;
    }
    return `${total} matches of /${options.grep}/i, showing ${parts.length}\n\n${parts.join("\n\n")}`;
  }
  const from = clamp(options.from ?? 0, 0, body.length);
  const length = clamp(options.length ?? 50_000, 1, 500_000);
  return body.slice(from, from + length);
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : min;
}
