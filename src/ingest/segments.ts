import type { Pool } from "pg";

/**
 * Crawl plan of a scraped source: the parts ("segments") its inventory is read in, for example
 * "Volkswagen, 5.000 to 5.999 EUR", and when each was last read completely. A segment that has
 * more results than the portal lets us page through is retired and replaced by smaller ones.
 */
export interface Segment<P> {
  key: string;
  params: P;
  lastTotal: number | null;
  lastStartedAt: Date | null;
  lastCompletedAt: Date | null;
}

export interface SegmentDraft<P> {
  key: string;
  params: P;
}

export class SegmentStore<P> {
  constructor(
    private readonly pool: Pool,
    private readonly sourceId: string,
  ) {}

  /** Adds segments that do not exist yet (retired ones stay retired). */
  async ensure(segments: SegmentDraft<P>[]): Promise<void> {
    if (segments.length === 0) return;
    await this.pool.query(
      `insert into crawl_segments (source_id, key, params)
       select $1, key, params from unnest($2::text[], $3::jsonb[]) as s (key, params)
       on conflict (source_id, key) do nothing`,
      [this.sourceId, segments.map((s) => s.key), segments.map((s) => JSON.stringify(s.params))],
    );
  }

  /** Segments to read, the longest unread first; never-read segments come first of all. */
  async active(): Promise<Segment<P>[]> {
    const { rows } = await this.pool.query(
      `select key, params, last_total, last_started_at, last_completed_at
         from crawl_segments
        where source_id = $1 and not retired
        order by coalesce(last_completed_at, last_started_at) asc nulls first, key`,
      [this.sourceId],
    );
    return rows.map((row) => ({
      key: row.key,
      params: row.params as P,
      lastTotal: row.last_total,
      lastStartedAt: row.last_started_at,
      lastCompletedAt: row.last_completed_at,
    }));
  }

  async started(key: string, total: number | null): Promise<void> {
    await this.pool.query(
      "update crawl_segments set last_started_at = now(), last_total = $3 where source_id = $1 and key = $2",
      [this.sourceId, key, total],
    );
  }

  async completed(key: string): Promise<void> {
    await this.pool.query("update crawl_segments set last_completed_at = now() where source_id = $1 and key = $2", [
      this.sourceId,
      key,
    ]);
  }

  /** Retires a segment and adds its smaller replacements in one transaction. */
  async split(key: string, children: SegmentDraft<P>[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("update crawl_segments set retired = true where source_id = $1 and key = $2", [this.sourceId, key]);
      await client.query(
        `insert into crawl_segments (source_id, key, params)
         select $1, key, params from unnest($2::text[], $3::jsonb[]) as s (key, params)
         on conflict (source_id, key) do update set retired = false, params = excluded.params`,
        [this.sourceId, children.map((c) => c.key), children.map((c) => JSON.stringify(c.params))],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
