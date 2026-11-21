import type { Pool } from "pg";
import type { DamageKind } from "@/core/damage";
import { ageBucket, coveredComponents, hiddenDefectRisk } from "@/core/defects";
import type { InspectionBasis } from "@/core/inspection";
import { estimateRepairs, unclearDamageRisk, type RepairEstimate } from "@/core/repairs";
import type { BodyType, Fuel } from "@/core/types";
import { loadProfileIndex, type ProfileIndex } from "@/search/defects";

const BATCH = 5000;

export interface RiskInput {
  damage: DamageKind[];
  makeSlug: string | null;
  modelSlug: string | null;
  firstRegistration: string | null;
  fuel: Fuel | null;
  priceEur: number;
  marketEur: number | null;
}

/**
 * The two parts of a listing's risk buffer in euros. Hidden: defects the next inspection usually
 * finds on such a car, from its model's profile or else the average car of its age, without the
 * component groups the repair jobs already cover; null for cars outside the age groups or before
 * any profile exists. Unclear: a worse damage than named when the price is far below market;
 * null without a market value.
 */
export function riskParts(input: RiskInput, estimate: RepairEstimate, profiles: ProfileIndex, now = new Date()) {
  const bucket = ageBucket(input.firstRegistration, now);
  const profile = bucket === null ? null : (profiles.model(input.makeSlug, input.modelSlug, bucket) ?? profiles.average(bucket));
  const hidden = hiddenDefectRisk(profile, estimate.vehicleClass, coveredComponents(estimate.jobs.map((j) => j.job.id)));
  const unclear = unclearDamageRisk(input.damage, { fuel: input.fuel, vehicleClass: estimate.vehicleClass }, input.priceEur, input.marketEur);
  return {
    hiddenEur: hidden?.eur ?? null,
    unclearEur: input.marketEur === null ? null : (unclear?.eur ?? 0),
  };
}

/**
 * Writes the repair estimate of every active listing with damage hints in its title: parts,
 * hours, difficulty, confidence, towing, size class and risk buffer. Only changed rows are
 * written, so the catalog in src/core/repairs.ts and the defect profiles can change and the next
 * run brings every listing up to date. A listing whose damage hints went away (a corrected
 * detector) loses its estimate. Runs after the market values, which the risk buffer uses.
 * Returns how many listings changed.
 */
export async function updateRepairEstimates(pool: Pool, now = new Date()): Promise<number> {
  const profiles = await loadProfileIndex(pool);
  const cleared = await pool.query(
    `update listings
        set vehicle_class = null, repair_parts_min_eur = null, repair_parts_max_eur = null,
            repair_hours_min = null, repair_hours_max = null, repair_difficulty = null,
            repair_confidence = null, repair_needs_tow = null,
            repair_risk_hidden_eur = null, repair_risk_unclear_eur = null
      where repair_difficulty is not null and coalesce(cardinality(damage), 0) = 0`,
  );
  let changed = cleared.rowCount ?? 0;
  let lastId = 0;
  for (;;) {
    const { rows } = await pool.query<{
      id: string;
      damage: DamageKind[];
      make_slug: string | null;
      model_slug: string | null;
      first_registration: string | null;
      price_eur: number;
      market_price_eur: number | null;
      power_kw: number | null;
      body_type: BodyType | null;
      fuel: Fuel | null;
      hu_basis: InspectionBasis | null;
      hu_until: string | null;
    }>(
      `select id, damage, make_slug, model_slug, to_char(first_registration, 'YYYY-MM-DD') as first_registration,
              price_eur, market_price_eur, power_kw, body_type, fuel, hu_basis, to_char(hu_until, 'YYYY-MM-DD') as hu_until
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
        huUntil: row.hu_until,
      }, now);
      const risk = riskParts(
        {
          damage: row.damage,
          makeSlug: row.make_slug,
          modelSlug: row.model_slug,
          firstRegistration: row.first_registration,
          fuel: row.fuel,
          priceEur: row.price_eur,
          marketEur: row.market_price_eur,
        },
        estimate,
        profiles,
        now,
      );
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
        rh: risk.hiddenEur,
        ru: risk.unclearEur,
        // What the estimate was computed from, so a row an import changed meanwhile is left for the next run.
        damage: row.damage,
        make: row.make_slug,
        model: row.model_slug,
        reg: row.first_registration,
        price: row.price_eur,
        market: row.market_price_eur,
        kw: row.power_kw,
        body: row.body_type,
        fuel: row.fuel,
        hub: row.hu_basis,
        huu: row.hu_until,
      };
    });
    const result = await pool.query(
      `update listings l
          set vehicle_class = v.cls, repair_parts_min_eur = v.pmin, repair_parts_max_eur = v.pmax,
              repair_hours_min = v.hmin, repair_hours_max = v.hmax, repair_difficulty = v.diff,
              repair_confidence = v.conf, repair_needs_tow = v.tow,
              repair_risk_hidden_eur = v.rh, repair_risk_unclear_eur = v.ru
         from jsonb_to_recordset($1::jsonb)
              as v(id bigint, cls text, pmin int, pmax int, hmin real, hmax real, diff smallint, conf text, tow boolean,
                   rh int, ru int, damage jsonb, make text, model text, reg date, price int, market int,
                   kw int, body text, fuel text, hub text, huu date)
        where l.id = v.id
          and to_jsonb(l.damage) = v.damage
          and (l.make_slug, l.model_slug, l.first_registration, l.price_eur, l.market_price_eur,
               l.power_kw, l.body_type, l.fuel, l.hu_basis, l.hu_until)
              is not distinct from (v.make, v.model, v.reg, v.price, v.market, v.kw, v.body, v.fuel, v.hub, v.huu)
          and (l.vehicle_class, l.repair_parts_min_eur, l.repair_parts_max_eur, l.repair_hours_min, l.repair_hours_max,
               l.repair_difficulty, l.repair_confidence, l.repair_needs_tow, l.repair_risk_hidden_eur, l.repair_risk_unclear_eur)
              is distinct from (v.cls, v.pmin, v.pmax, v.hmin, v.hmax, v.diff, v.conf, v.tow, v.rh, v.ru)`,
      [JSON.stringify(values)],
    );
    changed += result.rowCount ?? 0;
    lastId = values.at(-1)!.id;
  }
}
