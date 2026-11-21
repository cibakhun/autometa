import type { Pool } from "pg";
import type { DamageKind } from "@/core/damage";
import type { InspectionBasis } from "@/core/inspection";
import { estimateRepairs } from "@/core/repairs";
import type { BodyType, Fuel } from "@/core/types";

const BATCH = 5000;

/**
 * Writes the repair estimate of every active listing with damage hints in its title: parts,
 * hours, difficulty, confidence, towing and size class. Only changed rows are written, so the
 * catalog in src/core/repairs.ts can change and the next run brings every listing up to date.
 * A listing whose damage hints went away (a corrected detector) loses its estimate.
 * Returns how many listings changed.
 */
export async function updateRepairEstimates(pool: Pool): Promise<number> {
  const cleared = await pool.query(
    `update listings
        set vehicle_class = null, repair_parts_min_eur = null, repair_parts_max_eur = null,
            repair_hours_min = null, repair_hours_max = null, repair_difficulty = null,
            repair_confidence = null, repair_needs_tow = null
      where repair_difficulty is not null and coalesce(cardinality(damage), 0) = 0`,
  );
  let changed = cleared.rowCount ?? 0;
  let lastId = 0;
  for (;;) {
    const { rows } = await pool.query<{
      id: string;
      damage: DamageKind[];
      make_slug: string | null;
      power_kw: number | null;
      body_type: BodyType | null;
      fuel: Fuel | null;
      hu_basis: InspectionBasis | null;
    }>(
      `select id, damage, make_slug, power_kw, body_type, fuel, hu_basis
         from listings
        where status = 'active' and cardinality(damage) > 0 and id > $1
        order by id limit $2`,
      [lastId, BATCH],
    );
    if (rows.length === 0) return changed;
    const values = rows.map((row) => {
      const estimate = estimateRepairs(row.damage, {
        makeSlug: row.make_slug,
        powerKw: row.power_kw,
        bodyType: row.body_type,
        fuel: row.fuel,
        huBasis: row.hu_basis,
      });
      return {
        id: Number(row.id),
        cls: estimate.vehicleClass,
        pmin: estimate.partsEur[0],
        pmax: estimate.partsEur[1],
        hmin: estimate.hours[0],
        hmax: estimate.hours[1],
        diff: estimate.difficulty,
        conf: estimate.confidence,
        tow: estimate.needsTow,
      };
    });
    const result = await pool.query(
      `update listings l
          set vehicle_class = v.cls, repair_parts_min_eur = v.pmin, repair_parts_max_eur = v.pmax,
              repair_hours_min = v.hmin, repair_hours_max = v.hmax, repair_difficulty = v.diff,
              repair_confidence = v.conf, repair_needs_tow = v.tow
         from jsonb_to_recordset($1::jsonb)
              as v(id bigint, cls text, pmin int, pmax int, hmin real, hmax real, diff smallint, conf text, tow boolean)
        where l.id = v.id
          and (l.vehicle_class, l.repair_parts_min_eur, l.repair_parts_max_eur, l.repair_hours_min, l.repair_hours_max,
               l.repair_difficulty, l.repair_confidence, l.repair_needs_tow)
              is distinct from (v.cls, v.pmin, v.pmax, v.hmin, v.hmax, v.diff, v.conf, v.tow)`,
      [JSON.stringify(values)],
    );
    changed += result.rowCount ?? 0;
    lastId = values.at(-1)!.id;
  }
}
