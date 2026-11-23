import type { Pool, PoolClient } from "pg";
import { DEFAULT_FLIP_SETTINGS, parseFlipSettings } from "@/core/flip";
import { Params } from "@/lib/db";
import { parseFilters } from "@/search/filters";
import { buildWhere, resolveZip, searchListings } from "@/search/query";
import { favoritesAlert, isQuietTime, searchAlert, type FavoriteChange } from "./messages";
import { pushToProfile, webPushSend, type PushPayload, type SendToSubscription } from "./push";

/**
 * The alert job (run by the worker every few minutes): pushes what each saved search found since
 * its last push, and price drops and vanished listings on watch lists.
 *
 * A saved search reports a vehicle once: new to AutoMeta (on no portal before) or cheaper, within
 * the last LOOKBACK_HOURS and after the search was saved or its pushes switched on. Reported ones
 * are kept in saved_search_hits, so a vehicle that only matches later (e.g. once its market value
 * is computed at the end of an import round) is still reported, and none twice unless its price
 * drops again. During the night rest nothing is sent and nothing marked; 7:00 brings it all.
 */

export const LOOKBACK_HOURS = 48;
/** Reported vehicles are remembered a little longer than the lookback. */
const HITS_KEEP_HOURS = 72;
/** Only one alert run at a time, also across two containers during a deploy. */
const ALERT_LOCK_KEY = 4_120_231_123;

export interface AlertRunResult {
  skipped: boolean;
  searchesChecked: number;
  searchPushes: number;
  favoritePushes: number;
  /** Vehicles reported by search pushes. */
  vehicles: number;
}

export interface AlertOptions {
  send?: SendToSubscription;
  log?: (message: string) => void;
  /** For tests: the moment that decides the night rest. Defaults to the database clock. */
  now?: Date;
}

export async function runAlerts(pool: Pool, options: AlertOptions = {}): Promise<AlertRunResult> {
  const log = options.log ?? (() => {});
  const send = options.send ?? webPushSend;
  const result: AlertRunResult = { skipped: false, searchesChecked: 0, searchPushes: 0, favoritePushes: 0, vehicles: 0 };
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [ALERT_LOCK_KEY])).rows[0].ok;
    if (!locked) return { ...result, skipped: true };
    const now = options.now ?? (await client.query<{ now: Date }>("select now()")).rows[0].now;
    const quiet = isQuietTime(now);

    await client.query(`delete from saved_search_hits where alerted_at < now() - make_interval(hours => ${HITS_KEEP_HOURS})`);
    await client.query("delete from profile_link_codes where expires_at < now()");

    // Its own connection: what sending learns about dead subscriptions stays, whatever the search's transaction does.
    const push = async (profileId: number, payload: PushPayload) => (await pushToProfile(pool, profileId, payload, send, log)).sent;
    await alertSearches(client, quiet, push, result, log);
    await alertFavorites(client, quiet, push, result);
    return result;
  } finally {
    if (locked) await client.query("select pg_advisory_unlock($1)", [ALERT_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

type Push = (profileId: number, payload: PushPayload) => Promise<number>;

async function alertSearches(client: PoolClient, quiet: boolean, push: Push, result: AlertRunResult, log: (message: string) => void) {
  // Only profiles with a push device; the others see "neu" on their list of saved searches.
  const { rows: searches } = await client.query(
    `select s.id, s.profile_id, s.name, s.query, s.flip_settings,
            greatest(s.alerts_from, now() - make_interval(hours => ${LOOKBACK_HOURS})) as since
       from saved_searches s join profiles p on p.id = s.profile_id
      where s.notify and (not $1 or not p.quiet_nights)
        and exists (select 1 from push_subscriptions ps where ps.profile_id = s.profile_id)
      order by s.id`,
    [quiet],
  );
  for (const search of searches) {
    result.searchesChecked++;
    // One snapshot for the search and the marking, so a listing stored in between is neither
    // marked unreported nor reported twice.
    await client.query("begin isolation level repeatable read");
    try {
      const since = new Date(search.since).toISOString();
      const filters = { ...parseFilters(new URLSearchParams(search.query)), seit: since, page: 1 };
      const settings = parseFlipSettings(search.flip_settings ?? DEFAULT_FLIP_SETTINGS);
      const origin = filters.zip ? await resolveZip(client, filters.zip) : null;
      const found = await searchListings(client, filters, origin, settings, { notAlertedBy: Number(search.id) });
      const sent =
        found.total === 0
          ? 0
          : await push(Number(search.profile_id), searchAlert({ id: Number(search.id), name: search.name }, found.total, found.items, since));
      // Nothing new, or nobody got it (all devices failed): try again next run.
      if (sent === 0) {
        await client.query("rollback");
        continue;
      }
      const params = new Params();
      const { where } = buildWhere(filters, origin, params, settings, { notAlertedBy: Number(search.id) });
      const searchParam = params.add(Number(search.id));
      await client.query(
        `insert into saved_search_hits (search_id, listing_id)
         select ${searchParam}, l.id from listings l where ${where}
         on conflict (search_id, listing_id) do update set alerted_at = now()`,
        params.values,
      );
      await client.query("update saved_searches set last_alert_at = now(), last_alert_count = $2 where id = $1", [search.id, found.total]);
      await client.query("commit");
      result.searchPushes++;
      result.vehicles += found.total;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      log(`alerts: saved search ${search.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function alertFavorites(client: PoolClient, quiet: boolean, push: Push, result: AlertRunResult) {
  const { rows } = await client.query(
    `select f.profile_id, f.listing_id, f.notified_price_eur, f.notified_gone, l.title, l.price_eur, l.status = 'gone' as gone,
            p.quiet_nights, exists (select 1 from push_subscriptions ps where ps.profile_id = f.profile_id) as has_push
       from favorites f
       join listings l on l.id = f.listing_id
       join profiles p on p.id = f.profile_id
      where l.price_eur <> f.notified_price_eur or (l.status = 'gone') <> f.notified_gone
      order by f.profile_id, f.created_at`,
  );
  const byProfile = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = byProfile.get(Number(row.profile_id)) ?? [];
    list.push(row);
    byProfile.set(Number(row.profile_id), list);
  }

  for (const [profileId, list] of byProfile) {
    // Worth a push: cheaper than last reported, or gone (and not reported as gone yet).
    const changes: FavoriteChange[] = list
      .filter((row) => (row.gone && !row.notified_gone) || (!row.gone && row.price_eur < row.notified_price_eur))
      .map((row) => ({
        listingId: Number(row.listing_id),
        title: row.title,
        priceEur: row.price_eur,
        previousEur: row.notified_price_eur,
        gone: row.gone,
      }));
    const canPush = list[0].has_push && !(quiet && list[0].quiet_nights);
    if (changes.length > 0 && canPush) {
      if ((await push(profileId, favoritesAlert(changes))) === 0) continue;
      result.favoritePushes++;
    }
    // Without a push device, changes are only noted; at night, reportable ones wait for the morning.
    const keep = changes.length > 0 && !canPush && list[0].has_push ? new Set(changes.map((change) => change.listingId)) : new Set<number>();
    const settle = list.filter((row) => !keep.has(Number(row.listing_id))).map((row) => Number(row.listing_id));
    if (settle.length === 0) continue;
    await client.query(
      `update favorites f set notified_price_eur = l.price_eur, notified_gone = l.status = 'gone'
         from listings l where l.id = f.listing_id and f.profile_id = $1 and f.listing_id = any($2::int8[])`,
      [profileId, settle],
    );
  }
}
