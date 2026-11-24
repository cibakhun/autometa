import type { Pool } from "pg";
import { detectInspection } from "@/core/inspection";
import { judgeListing, LISTING_RULES_VERSION } from "@/core/plausibility";

/**
 * Applies the import rules (src/core/plausibility.ts) to the listings stored before they existed.
 * Only the import runs them, and Kleinanzeigen's and Quoka's older listings stay in the search
 * through their daily check without being read from a list again. So a wanted ad stored a year
 * ago would stay forever, and a first registration typed wrong would stay wrong.
 *
 * Runs at start-up, once per LISTING_RULES_VERSION: walks the active listings in batches by id
 * and takes the ones the rules leave out out of the search (gone_reason 'filtered', which counts
 * neither as sold nor as gone from the portal), and sets a first registration or mileage that
 * cannot be right to unknown. Idempotent; another instance starting at the same time skips it.
 */

const REVIEW_NAME = "listing-rules";
const BATCH_SIZE = 5000;

export interface ReviewResult {
  /** False when the stored listings follow these rules already, or another instance reviews them. */
  ran: boolean;
  /** Active listings looked at. */
  reviewed: number;
  /** Taken out of the search: no car for sale, or a placeholder price. */
  filtered: number;
  /** First registration or mileage set to unknown. */
  corrected: number;
}

interface Row {
  id: string;
  title: string;
  price_eur: number;
  mileage_km: number | null;
  first_registration: string | null;
  power_kw: number | null;
  make_slug: string | null;
  model_slug: string | null;
  hu_basis: string | null;
}

interface Correction {
  id: number;
  firstRegistration: string | null;
  mileageKm: number | null;
  /** Set when the HU date came from the first registration and is worked out again. */
  inspection: { until: string | null; basis: string | null } | null;
}

export async function reviewStoredListings(pool: Pool, now = new Date()): Promise<ReviewResult> {
  const result: ReviewResult = { ran: false, reviewed: 0, filtered: 0, corrected: 0 };
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtext('autometa-review')) as locked");
    if (!lock.rows[0].locked) return result;
    try {
      const done = await client.query<{ version: number }>("select version from listing_reviews where name = $1", [REVIEW_NAME]);
      if ((done.rows[0]?.version ?? 0) >= LISTING_RULES_VERSION) return result;
      result.ran = true;

      let lastId = 0;
      for (;;) {
        const { rows } = await client.query<Row>(
          `select l.id, l.title, l.price_eur, l.mileage_km, to_char(l.first_registration, 'YYYY-MM-DD') as first_registration,
                  l.power_kw, l.make_slug, l.model_slug, l.hu_basis
             from listings l
             join sources s on s.id = l.source_id and s.kind <> 'demo'
            where l.status = 'active' and l.id > $1
            order by l.id
            limit $2`,
          [lastId, BATCH_SIZE],
        );
        if (rows.length === 0) break;
        lastId = Number(rows[rows.length - 1].id);
        result.reviewed += rows.length;

        const filtered: number[] = [];
        const corrections: Correction[] = [];
        for (const row of rows) {
          const facts = {
            title: row.title,
            priceEur: row.price_eur,
            mileageKm: row.mileage_km,
            firstRegistration: row.first_registration,
            powerKw: row.power_kw,
            makeSlug: row.make_slug,
            modelSlug: row.model_slug,
          };
          const verdict = judgeListing(facts, now);
          if (verdict.rejection) {
            filtered.push(Number(row.id));
            continue;
          }
          if (verdict.firstRegistration === row.first_registration && verdict.mileageKm === row.mileage_km) continue;
          // A HU date the title states stays; one worked out from the first registration follows it.
          const inspection =
            row.hu_basis === "registration"
              ? detectInspection({ ...facts, firstRegistration: verdict.firstRegistration, mileageKm: verdict.mileageKm }, now)
              : undefined;
          corrections.push({
            id: Number(row.id),
            firstRegistration: verdict.firstRegistration,
            mileageKm: verdict.mileageKm,
            inspection: inspection === undefined ? null : { until: inspection?.until ?? null, basis: inspection?.basis ?? null },
          });
        }

        if (filtered.length > 0) {
          const gone = await client.query(
            `update listings set status = 'gone', gone_reason = 'filtered', gone_at = now()
              where id = any($1::bigint[]) and status = 'active'`,
            [filtered],
          );
          result.filtered += gone.rowCount ?? 0;
        }
        if (corrections.length > 0) {
          const corrected = await client.query(
            `update listings l
                set first_registration = v.first_registration,
                    first_registration_year_only = l.first_registration_year_only and v.first_registration is not null,
                    mileage_km = v.mileage_km,
                    hu_until = case when v.inspection then v.hu_until else l.hu_until end,
                    hu_basis = case when v.inspection then v.hu_basis else l.hu_basis end
               from unnest($1::bigint[], $2::date[], $3::int[], $4::boolean[], $5::date[], $6::text[])
                    as v (id, first_registration, mileage_km, inspection, hu_until, hu_basis)
              where l.id = v.id and l.status = 'active'`,
            [
              corrections.map((c) => c.id),
              corrections.map((c) => c.firstRegistration),
              corrections.map((c) => c.mileageKm),
              corrections.map((c) => c.inspection !== null),
              corrections.map((c) => c.inspection?.until ?? null),
              corrections.map((c) => c.inspection?.basis ?? null),
            ],
          );
          result.corrected += corrected.rowCount ?? 0;
        }
      }

      await client.query(
        `insert into listing_reviews (name, version) values ($1, $2)
         on conflict (name) do update set version = excluded.version, reviewed_at = now()`,
        [REVIEW_NAME, LISTING_RULES_VERSION],
      );
      return result;
    } finally {
      await client.query("select pg_advisory_unlock(hashtext('autometa-review'))");
    }
  } finally {
    client.release();
  }
}
