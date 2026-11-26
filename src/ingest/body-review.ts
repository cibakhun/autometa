import type { Pool } from "pg";
import { defaultBodyType } from "@/core/body-types";
import { detectBodyType } from "@/core/normalize";
import type { BodyType } from "@/core/types";

/**
 * Applies the body type rules (title words, else the model's usual body: src/core/body-types.ts)
 * to the listings stored before them. AutoScout24 reads every listing again within a day, but
 * Kleinanzeigen's and Quoka's older listings are only checked on their own page and never read
 * from a list again, so without this they would keep an unknown body for as long as they are online.
 *
 * Runs in the worker, next to the imports, once per BODY_RULES_VERSION: it walks the active
 * listings in batches by id and writes the body type where it changes. Bump the version when the
 * rules change. Idempotent; another instance running at the same time skips it.
 */
export const BODY_RULES_VERSION = 1;

const REVIEW_NAME = "body-types";
const BATCH_SIZE = 5000;
/** Sources whose own body type field the adapter reads; their stored value stays when they gave one. */
const BODY_FROM_SOURCE = new Set(["autode", "demo"]);

export interface BodyReviewResult {
  /** False when the stored listings follow these rules already, or another instance reviews them. */
  ran: boolean;
  reviewed: number;
  changed: number;
}

interface Row {
  id: string;
  source_id: string;
  title: string;
  make_slug: string | null;
  model_slug: string | null;
  body_type: BodyType | null;
}

/** The body type a stored listing gets under the current rules. */
export function reviewedBodyType(row: Pick<Row, "source_id" | "title" | "make_slug" | "model_slug" | "body_type">): BodyType | null {
  if (BODY_FROM_SOURCE.has(row.source_id) && row.body_type !== null) return row.body_type;
  return detectBodyType(row.title) ?? defaultBodyType(row.make_slug, row.model_slug);
}

export async function reviewBodyTypes(pool: Pool, shouldStop: () => boolean = () => false): Promise<BodyReviewResult> {
  const result: BodyReviewResult = { ran: false, reviewed: 0, changed: 0 };
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext('autometa-body-review')) as locked");
    if (!lock.rows[0].locked) return result;
    try {
      const done = await client.query<{ version: number }>("select version from listing_reviews where name = $1", [REVIEW_NAME]);
      if ((done.rows[0]?.version ?? 0) >= BODY_RULES_VERSION) return result;
      result.ran = true;

      let lastId = 0;
      for (;;) {
        // Stopped halfway, the version stays unwritten and the next start walks again.
        if (shouldStop()) return result;
        const { rows } = await client.query<Row>(
          `select id, source_id, title, make_slug, model_slug, body_type
             from listings
            where status = 'active' and id > $1
            order by id
            limit $2`,
          [lastId, BATCH_SIZE],
        );
        if (rows.length === 0) break;
        lastId = Number(rows[rows.length - 1].id);
        result.reviewed += rows.length;

        const changes = rows
          .map((row) => ({ id: Number(row.id), body: reviewedBodyType(row), before: row.body_type }))
          .filter((change) => change.body !== change.before);
        if (changes.length === 0) continue;
        const updated = await client.query(
          `update listings l set body_type = v.body
             from unnest($1::bigint[], $2::text[]) as v (id, body)
            where l.id = v.id and l.body_type is distinct from v.body`,
          [changes.map((change) => change.id), changes.map((change) => change.body)],
        );
        result.changed += updated.rowCount ?? 0;
      }

      await client.query(
        `insert into listing_reviews (name, version) values ($1, $2)
         on conflict (name) do update set version = excluded.version, reviewed_at = now()`,
        [REVIEW_NAME, BODY_RULES_VERSION],
      );
      return result;
    } finally {
      await client.query("select pg_advisory_unlock(hashtext('autometa-body-review'))");
    }
  } finally {
    client.release();
  }
}
