import type { Pool, PoolClient } from "pg";
import webpush from "web-push";

/**
 * Web Push: the browser's push service (Google, Mozilla, Apple) delivers a notification to a
 * device that allowed it, even with AutoMeta closed. Sending needs a VAPID key pair; the app makes
 * one on first use and keeps it in app_keys (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY override it).
 * No paid service and no account anywhere.
 */

type Db = Pool | PoolClient;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Opened when the notification is tapped, relative to the site. */
  url: string;
  /** A newer notification with the same tag replaces the older one. */
  tag?: string;
}

/** Push subscription as the browser hands it over (PushSubscription.toJSON()). */
export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function getVapidKeys(db: Db): Promise<VapidKeys> {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (publicKey && privateKey) return { publicKey, privateKey };

  const read = async () => {
    const { rows } = await db.query<{ value: string }>("select value from app_keys where name = 'vapid'");
    return rows[0] ? (JSON.parse(rows[0].value) as VapidKeys) : null;
  };
  const stored = await read();
  if (stored) return stored;
  // Two processes starting at once: the first insert wins, both read it back.
  await db.query("insert into app_keys (name, value) values ('vapid', $1) on conflict (name) do nothing", [
    JSON.stringify(webpush.generateVAPIDKeys()),
  ]);
  return (await read())!;
}

/** Contact the push services may use; any https URL or mailto: address. */
const subject = () => process.env.VAPID_SUBJECT?.trim() || "https://autometa.milasstho.de";

/**
 * The push services of the browsers: Chrome, Edge on Android, Opera, Samsung (Google FCM), Firefox
 * (Mozilla), Safari (Apple), Edge on Windows (WNS). The server sends to a subscription's endpoint,
 * so only these hosts are accepted; otherwise anyone could make it send requests to any address.
 */
export const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  ".push.services.mozilla.com",
  ".push.apple.com",
  ".notify.windows.com",
];

/** Whether a host is one of the hosts, or (for an entry starting with ".") below it. */
export function isPushServiceHost(host: string, hosts: readonly string[] = PUSH_SERVICE_HOSTS): boolean {
  const name = host.toLowerCase();
  return hosts.some((entry) => (entry.startsWith(".") ? name.endsWith(entry) && name.length > entry.length : name === entry));
}

/** A subscription as the browser sends it, with an https endpoint on a known push service; null otherwise. */
export function parseSubscription(value: unknown, hosts: readonly string[] = PUSH_SERVICE_HOSTS): BrowserSubscription | null {
  if (!value || typeof value !== "object") return null;
  const { endpoint, keys } = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== "string" || endpoint.length > 1000) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!isPushServiceHost(url.hostname, hosts)) return null;
  } catch {
    return null;
  }
  const b64 = /^[A-Za-z0-9_-]+=*$/;
  if (typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") return null;
  if (!b64.test(keys.p256dh) || !b64.test(keys.auth) || keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** Max push devices per profile; the oldest beyond go. */
export const MAX_PUSH_DEVICES = 10;

/**
 * Stores a browser's subscription for the profile and device. When it is the profile's first, its
 * saved searches and watch list start reporting from now on, not with everything since saving.
 */
export async function saveSubscription(
  db: Db,
  profileId: number,
  deviceId: number,
  subscription: BrowserSubscription,
  previousEndpoint?: string | null,
): Promise<void> {
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from push_subscriptions where profile_id = $1", [profileId]);
  if (previousEndpoint) await db.query("delete from push_subscriptions where endpoint = $1 and profile_id = $2", [previousEndpoint, profileId]);
  await db.query(
    `insert into push_subscriptions (profile_id, device_id, endpoint, p256dh, auth) values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update set profile_id = excluded.profile_id, device_id = excluded.device_id,
       p256dh = excluded.p256dh, auth = excluded.auth, failures = 0`,
    [profileId, deviceId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth],
  );
  await db.query(
    `delete from push_subscriptions where profile_id = $1 and id not in (
       select id from push_subscriptions where profile_id = $1 order by created_at desc, id desc limit ${MAX_PUSH_DEVICES})`,
    [profileId],
  );
  if (rows[0].n === 0) {
    await db.query("update saved_searches set alerts_from = now() where profile_id = $1", [profileId]);
    await db.query(
      `update favorites f set notified_price_eur = l.price_eur, notified_gone = l.status = 'gone'
         from listings l where l.id = f.listing_id and f.profile_id = $1`,
      [profileId],
    );
  }
}

export async function deleteSubscription(db: Db, profileId: number, endpoint: string): Promise<void> {
  await db.query("delete from push_subscriptions where endpoint = $1 and profile_id = $2", [endpoint, profileId]);
}

export async function countSubscriptions(db: Db, profileId: number | null): Promise<number> {
  if (profileId === null) return 0;
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from push_subscriptions where profile_id = $1", [profileId]);
  return rows[0].n;
}

/** Sends one notification to a subscription; the raw sender, replaced in tests. */
export type SendToSubscription = (subscription: BrowserSubscription, payload: string, keys: VapidKeys) => Promise<void>;

export const pushOptions = (keys: VapidKeys): webpush.RequestOptions => ({
  vapidDetails: { subject: subject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
  // A notification that could not be delivered within 12 hours is stale.
  TTL: 12 * 3600,
  urgency: "high",
  timeout: 15_000,
});

export const webPushSend: SendToSubscription = async (subscription, payload, keys) => {
  await webpush.sendNotification(subscription, payload, pushOptions(keys));
};

/** After this many failed sends in a row a subscription is dropped. */
const MAX_FAILURES = 20;

/**
 * Sends a notification to every push device of the profile. Subscriptions the push service no
 * longer knows (404/410) are removed. Returns how many devices accepted it.
 */
export async function pushToProfile(
  db: Db,
  profileId: number,
  payload: PushPayload,
  send: SendToSubscription = webPushSend,
  log: (message: string) => void = () => {},
): Promise<{ sent: number; failed: number }> {
  const keys = await getVapidKeys(db);
  const { rows } = await db.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    "select id, endpoint, p256dh, auth from push_subscriptions where profile_id = $1",
    [profileId],
  );
  let sent = 0;
  let failed = 0;
  const body = JSON.stringify(payload);
  for (const row of rows) {
    try {
      await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body, keys);
      sent++;
      await db.query("update push_subscriptions set last_sent_at = now(), failures = 0 where id = $1", [row.id]);
    } catch (error) {
      failed++;
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.query("delete from push_subscriptions where id = $1", [row.id]);
        log(`push: subscription ${row.id} expired (${status}), removed`);
      } else {
        await db.query("update push_subscriptions set failures = failures + 1 where id = $1", [row.id]);
        await db.query("delete from push_subscriptions where id = $1 and failures >= $2", [row.id, MAX_FAILURES]);
        log(`push: sending to subscription ${row.id} failed: ${status ?? ""} ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { sent, failed };
}
