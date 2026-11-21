import type { Pool } from "pg";
import { detectDamage } from "@/core/damage";

/**
 * What a listing is worth comes from comparable intact listings of the same vehicle type:
 * same make and model, first registered at most a year apart, similar mileage, same fuel and
 * gearbox, similar power. Listings whose title mentions damage or whose HU had expired are not
 * comparable, nor are prices below MIN_COMP_PRICE_EUR (giveaways, placeholders, parts).
 * Listings that disappeared in the last GONE_WINDOW_DAYS count with their last price; how long
 * they stayed online counts only for those known to be sold or taken down.
 */
export const MARKET_RULES = {
  minComps: 5,
  minCompPriceEur: 500,
  yearSpan: 1,
  mileageShare: 0.25,
  mileageMinSpanKm: 15_000,
  powerShare: 0.2,
  goneWindowDays: 90,
  /** Days until a listing disappeared are only shown with at least this many samples. */
  minDaySamples: 5,
} as const;

export interface MarketResult {
  /** Active listings that now have a market value. */
  valued: number;
  /** Listings whose market value changed in this run. */
  changed: number;
}

/**
 * Recomputes the market value of every active listing. Listings with too few comparable ones get
 * null. Runs after each import round and at start-up.
 */
export async function updateMarketValues(pool: Pool): Promise<MarketResult> {
  const r = MARKET_RULES;
  const client = await pool.connect();
  let changed = 0;
  try {
    await client.query("begin");
    // One refresh at a time (start-up and import rounds), so an older one cannot overwrite newer values.
    await client.query("select pg_advisory_xact_lock(hashtext('autometa-market'))");
    // The comparable listings go into a temporary table with fresh statistics: estimated from
    // the filters alone, Postgres expects a handful of rows and joins them in nested loops.
    await client.query(
      `create temp table market_comps on commit drop as
       with source_start as (
         -- A listing first seen on the day a portal was first read may have been online for long
         -- before; only listings we saw appear tell how long such cars stay listed.
         select source_id, min(first_seen_at) + interval '1 day' as since from listings group by source_id
       )
       select distinct on (coalesce(l.cluster_id, l.id))
              coalesce(l.cluster_id, l.id) as vehicle, l.make_slug, l.model_slug,
              extract(year from l.first_registration)::int as year,
              l.mileage_km, l.fuel, l.transmission, l.power_kw, l.price_eur,
              -- Only listings known to be sold or taken down: one we merely could not confirm for a
              -- few days ('stale') may well still be online.
              case when l.status = 'gone' and l.first_seen_at > st.since and l.gone_reason is distinct from 'stale'
                   then extract(epoch from l.last_seen_at - l.first_seen_at) / 86400 end as days_listed
         from listings l
         join sources s on s.id = l.source_id and s.active
         join source_start st on st.source_id = l.source_id
        where l.make_slug is not null and l.model_slug is not null
          and l.first_registration is not null and l.mileage_km is not null
          and l.price_eur >= $1
          and l.damage = '{}'
          and l.hu_basis is distinct from 'expired'
          -- hu_until is the first day of the last valid month: expired when we last saw the listing.
          and (l.hu_until is null or l.hu_until >= date_trunc('month', l.last_seen_at)::date)
          and (l.status = 'active' or l.last_seen_at > now() - make_interval(days => $2))
        -- One price per vehicle listed on several portals: an active listing, the cheapest.
        order by coalesce(l.cluster_id, l.id), (l.status = 'active') desc, l.price_eur, l.id`,
      [r.minCompPriceEur, r.goneWindowDays],
    );
    await client.query("analyze market_comps");
    const updated = await client.query(
      `with targets as (
         select l.id, coalesce(l.cluster_id, l.id) as vehicle, l.make_slug, l.model_slug,
                extract(year from l.first_registration)::int as year, l.mileage_km, l.fuel, l.transmission, l.power_kw
           from listings l
          where l.status = 'active' and l.make_slug is not null and l.model_slug is not null
            and l.first_registration is not null and l.mileage_km is not null
       ),
       stats as (
         select t.id, count(*)::int as comps,
                percentile_cont(0.5) within group (order by c.price_eur) as median,
                percentile_cont(0.25) within group (order by c.price_eur) as low,
                percentile_cont(0.75) within group (order by c.price_eur) as high,
                count(c.days_listed)::int as day_samples,
                percentile_cont(0.5) within group (order by c.days_listed) as days
           from targets t
           -- One equality join per neighbouring year keeps the pairs to check small.
           cross join generate_series(-$1::int, $1::int) as span(offset_years)
           join market_comps c on c.make_slug = t.make_slug and c.model_slug = t.model_slug
            and c.year = t.year + span.offset_years
            and c.vehicle <> t.vehicle
            and abs(c.mileage_km - t.mileage_km) <= greatest(t.mileage_km * $2::float8, $3::float8)
            and (t.fuel is null or c.fuel = t.fuel)
            and (t.transmission is null or c.transmission = t.transmission)
            and (t.power_kw is null or c.power_kw is null
                 or c.power_kw between t.power_kw * (1 - $4::float8) and t.power_kw * (1 + $4::float8))
          group by t.id
         having count(*) >= $5
       ),
       result as (
         select l.id,
                (round(s.median / 50) * 50)::int as price,
                (round(s.low / 50) * 50)::int as low,
                (round(s.high / 50) * 50)::int as high,
                s.comps,
                case when s.day_samples >= $6 then round(s.days)::int end as days
           from listings l left join stats s on s.id = l.id
          where l.status = 'active'
       )
       update listings l
          set market_price_eur = r.price, market_low_eur = r.low, market_high_eur = r.high,
              market_comps = r.comps, market_days = r.days
         from result r
        where l.id = r.id
          and (l.market_price_eur, l.market_low_eur, l.market_high_eur, l.market_comps, l.market_days)
              is distinct from (r.price, r.low, r.high, r.comps, r.days)`,
      [r.yearSpan, r.mileageShare, r.mileageMinSpanKm, r.powerShare, r.minComps, r.minDaySamples],
    );
    changed = updated.rowCount ?? 0;
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  const { rows } = await pool.query<{ valued: number }>(
    "select count(*)::int as valued from listings where status = 'active' and market_price_eur is not null",
  );
  return { valued: rows[0].valued, changed };
}

const DAMAGE_BATCH = 2000;

/**
 * Fills in the damage kinds of listings stored before damage was detected on import (damage is
 * null). Returns how many listings it checked.
 */
export async function backfillDamage(pool: Pool): Promise<number> {
  let checked = 0;
  let lastId = 0;
  for (;;) {
    const { rows } = await pool.query<{ id: string; title: string }>(
      "select id, title from listings where damage is null and id > $1 order by id limit $2",
      [lastId, DAMAGE_BATCH],
    );
    if (rows.length === 0) return checked;
    const values = rows.map((row) => ({ id: Number(row.id), d: detectDamage(row.title) }));
    await pool.query(
      `update listings l
          set damage = array(select jsonb_array_elements_text(v.d))
         from jsonb_to_recordset($1::jsonb) as v(id bigint, d jsonb)
        where l.id = v.id and l.damage is null`,
      [JSON.stringify(values)],
    );
    checked += rows.length;
    lastId = values.at(-1)!.id;
  }
}
