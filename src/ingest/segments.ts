import type { PoolClient } from "pg";

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

/** Reads and writes the crawl plan on one connection (the import's own, see FetchContext). */
export class SegmentStore<P> {
  constructor(
    private readonly db: PoolClient,
    private readonly sourceId: string,
  ) {}

  /** Adds segments that do not exist yet (retired ones stay retired). */
  async ensure(segments: SegmentDraft<P>[]): Promise<void> {
    if (segments.length === 0) return;
    await this.db.query(
      `insert into crawl_segments (source_id, key, params)
       select $1, key, params from unnest($2::text[], $3::jsonb[]) as s (key, params)
       on conflict (source_id, key) do nothing`,
      [this.sourceId, segments.map((s) => s.key), segments.map((s) => JSON.stringify(s.params))],
    );
  }

  /**
   * Segments to read, the longest untried first; never-tried segments come first of all. Ordering by
   * the last attempt (not the last complete read) lets a segment that keeps failing take its turn
   * like any other instead of using up every run's requests.
   */
  async active(): Promise<Segment<P>[]> {
    const { rows } = await this.db.query(
      `select key, params, last_total, last_started_at, last_completed_at
         from crawl_segments
        where source_id = $1 and not retired
        order by last_started_at asc nulls first, key`,
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

  /** Records an attempt to read a segment, before its first request. */
  async attempted(key: string): Promise<void> {
    await this.db.query("update crawl_segments set last_started_at = now() where source_id = $1 and key = $2", [
      this.sourceId,
      key,
    ]);
  }

  /** Records how many results the source reported for a segment. */
  async counted(key: string, total: number): Promise<void> {
    await this.db.query("update crawl_segments set last_total = $3 where source_id = $1 and key = $2", [
      this.sourceId,
      key,
      total,
    ]);
  }

  async completed(key: string): Promise<void> {
    await this.db.query("update crawl_segments set last_completed_at = now() where source_id = $1 and key = $2", [
      this.sourceId,
      key,
    ]);
  }

  /**
   * Retires a segment and adds its smaller replacements in one transaction. `alsoInTransaction`
   * runs in the same transaction, e.g. to move the retired segment's listings to the new ones.
   */
  async split(key: string, children: SegmentDraft<P>[], alsoInTransaction?: (db: PoolClient) => Promise<void>): Promise<void> {
    await this.db.query("begin");
    try {
      await this.db.query("update crawl_segments set retired = true where source_id = $1 and key = $2", [this.sourceId, key]);
      await this.db.query(
        `insert into crawl_segments (source_id, key, params)
         select $1, key, params from unnest($2::text[], $3::jsonb[]) as s (key, params)
         on conflict (source_id, key) do update set retired = false, params = excluded.params`,
        [this.sourceId, children.map((c) => c.key), children.map((c) => JSON.stringify(c.params))],
      );
      await alsoInTransaction?.(this.db);
      await this.db.query("commit");
    } catch (error) {
      await this.db.query("rollback");
      throw error;
    }
  }
}
