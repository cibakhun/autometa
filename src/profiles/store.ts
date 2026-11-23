import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Pool, PoolClient } from "pg";

/**
 * Profiles without accounts: a profile holds a person's watch list, saved searches and push
 * devices. Each browser using it keeps a random token in a cookie; the database stores only its
 * SHA-256 hash. Another device joins with a short code that is valid for 30 minutes.
 */

export const PROFILE_COOKIE = "autometa_profil";
/** Browsers keep cookies for at most 400 days; every write renews it. */
export const PROFILE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

export const LINK_CODE_MINUTES = 30;
/** Limits per profile, so a stray script cannot fill the database. */
export const MAX_DEVICES = 20;

type Db = Pool | PoolClient;

export const newToken = () => randomBytes(32).toString("base64url");
export const hashSecret = (value: string) => createHash("sha256").update(value).digest();
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Letters and digits that cannot be mixed up (no 0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/** "K7QM4ZPA" shown as "K7QM-4ZPA". */
export const formatLinkCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** What a person typed, as stored: upper case, without spaces or dashes; null when it cannot be a code. */
export function normalizeLinkCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((char) => CODE_ALPHABET.includes(char)) ? code : null;
}

export function newLinkCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

/** "Chrome auf Android", "Safari auf iPhone": enough to tell one's devices apart, nothing more. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  if (browser && system) return `${browser} auf ${system}`;
  return browser ?? system ?? "Unbekanntes Gerät";
}

export interface Device {
  profileId: number;
  deviceId: number;
}

/** The device and profile a cookie token belongs to, or null. Notes the visit at most hourly. */
export async function findDevice(db: Db, token: string | undefined | null): Promise<Device | null> {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const { rows } = await db.query<{ id: string; profile_id: string }>(
    `with device as (select id, profile_id from profile_devices where token_hash = $1),
          seen as (update profile_devices set last_seen_at = now()
                    where token_hash = $1 and last_seen_at < now() - interval '1 hour')
     select id, profile_id from device`,
    [hashSecret(token)],
  );
  return rows[0] ? { profileId: Number(rows[0].profile_id), deviceId: Number(rows[0].id) } : null;
}

/** A new device of a profile; returns the token for its cookie. */
export async function addDevice(db: Db, profileId: number, label: string): Promise<{ token: string; deviceId: number }> {
  const token = newToken();
  const { rows } = await db.query<{ id: string }>(
    "insert into profile_devices (token_hash, profile_id, label) values ($1, $2, $3) returning id",
    [hashSecret(token), profileId, label.slice(0, 60)],
  );
  // Only the most recently used devices stay.
  await db.query(
    `delete from profile_devices where profile_id = $1 and id not in (
       select id from profile_devices where profile_id = $1 order by last_seen_at desc, id desc limit ${MAX_DEVICES})`,
    [profileId],
  );
  return { token, deviceId: Number(rows[0].id) };
}

/** A new profile with this device as its first; returns the token for its cookie. */
export async function createProfile(db: Db, label: string): Promise<Device & { token: string }> {
  const { rows } = await db.query<{ id: string }>("insert into profiles default values returning id");
  const profileId = Number(rows[0].id);
  const { token, deviceId } = await addDevice(db, profileId, label);
  return { profileId, deviceId, token };
}

/** A code another device can enter within LINK_CODE_MINUTES to use this profile. */
export async function createLinkCode(db: Db, profileId: number): Promise<{ code: string; expiresAt: string }> {
  await db.query("delete from profile_link_codes where expires_at < now()");
  const code = newLinkCode();
  const { rows } = await db.query<{ expires_at: Date }>(
    `insert into profile_link_codes (code_hash, profile_id, expires_at)
     values ($1, $2, now() + make_interval(mins => ${LINK_CODE_MINUTES})) returning expires_at`,
    [hashSecret(code), profileId],
  );
  return { code, expiresAt: new Date(rows[0].expires_at).toISOString() };
}

/**
 * Lets this browser use the profile behind a code. What the browser had saved before moves along
 * when no other device used its old profile; otherwise only the browser (and its pushes) moves.
 * Returns the cookie token to keep (a new one when the browser had none), or null for an unknown
 * or expired code.
 */
export async function joinWithCode(
  pool: Pool,
  input: string,
  token: string | undefined | null,
  label: string,
): Promise<{ token: string; profileId: number } | null> {
  const code = normalizeLinkCode(input);
  if (!code) return null;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ profile_id: string }>(
      "delete from profile_link_codes where code_hash = $1 and expires_at > now() returning profile_id",
      [hashSecret(code)],
    );
    if (!rows[0]) {
      await client.query("rollback");
      return null;
    }
    const target = Number(rows[0].profile_id);
    const current = await findDevice(client, token);
    let result: { token: string; profileId: number };
    if (!current) {
      result = { token: (await addDevice(client, target, label)).token, profileId: target };
    } else {
      if (current.profileId !== target) await moveDevice(client, current, target);
      result = { token: token!, profileId: target };
    }
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function moveDevice(client: PoolClient, device: Device, target: number) {
  const source = device.profileId;
  const { rows } = await client.query<{ others: number }>(
    "select count(*)::int as others from profile_devices where profile_id = $1 and id <> $2",
    [source, device.deviceId],
  );
  await client.query("update profile_devices set profile_id = $1 where id = $2", [target, device.deviceId]);
  await client.query("update push_subscriptions set profile_id = $1 where device_id = $2", [target, device.deviceId]);
  if (rows[0].others > 0) return;

  // The old profile was this browser's alone: its lists join the new profile, then it goes.
  await client.query(
    `insert into favorites (profile_id, listing_id, saved_price_eur, notified_price_eur, notified_gone, created_at)
     select $1, listing_id, saved_price_eur, notified_price_eur, notified_gone, created_at from favorites where profile_id = $2
     on conflict (profile_id, listing_id) do nothing`,
    [target, source],
  );
  await client.query(
    `delete from saved_searches s where s.profile_id = $2
        and exists (select 1 from saved_searches t where t.profile_id = $1 and t.query = s.query)`,
    [target, source],
  );
  await client.query("update saved_searches set profile_id = $1 where profile_id = $2", [target, source]);
  await client.query("update push_subscriptions set profile_id = $1 where profile_id = $2", [target, source]);
  await client.query("delete from profiles where id = $1", [source]);
}

export interface DeviceInfo {
  id: number;
  label: string;
  lastSeenAt: string;
  current: boolean;
  /** Push subscriptions of this device. */
  pushes: number;
}

export async function listDevices(db: Db, device: Device): Promise<DeviceInfo[]> {
  const { rows } = await db.query(
    `select d.id, d.label, d.last_seen_at,
            (select count(*)::int from push_subscriptions p where p.device_id = d.id) as pushes
       from profile_devices d where d.profile_id = $1
      order by d.last_seen_at desc, d.id desc`,
    [device.profileId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    label: row.label ?? "Unbekanntes Gerät",
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    current: Number(row.id) === device.deviceId,
    pushes: row.pushes,
  }));
}

/** Removes another device of the same profile (and its pushes). The current one cannot remove itself here. */
export async function removeDevice(db: Db, device: Device, deviceId: number): Promise<boolean> {
  if (deviceId === device.deviceId) return false;
  const { rowCount } = await db.query("delete from profile_devices where id = $1 and profile_id = $2", [deviceId, device.profileId]);
  return (rowCount ?? 0) > 0;
}

export async function getQuietNights(db: Db, profileId: number): Promise<boolean> {
  const { rows } = await db.query<{ quiet_nights: boolean }>("select quiet_nights from profiles where id = $1", [profileId]);
  return rows[0]?.quiet_nights ?? true;
}

export async function setQuietNights(db: Db, profileId: number, on: boolean): Promise<void> {
  await db.query("update profiles set quiet_nights = $2 where id = $1", [profileId, on]);
}
