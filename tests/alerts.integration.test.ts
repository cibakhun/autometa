import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { countSubscriptions, getVapidKeys, pushToProfile, saveSubscription, type BrowserSubscription, type SendToSubscription } from "@/alerts/push";
import { runAlerts } from "@/alerts/run";
import { DEFAULT_FLIP_SETTINGS } from "@/core/flip";
import { migrate } from "@/ingest/migrate";
import { seedReferenceData } from "@/ingest/seed";
import { favoriteIds, getFavorites, setFavorite } from "@/profiles/favorites";
import { findSavedSearch, listSavedSearches, openNewOfSearch, saveSearch, setSearchNotify } from "@/profiles/searches";
import { createLinkCode, createProfile, findDevice, joinWithCode, listDevices, removeDevice } from "@/profiles/store";
import { parseFilters } from "@/search/filters";
import { searchListings } from "@/search/query";
import { emptyTestDatabase } from "./test-database";

/**
 * Profiles, watch list, saved searches and the alert job against a real Postgres. Set
 * TEST_DATABASE_URL to a database whose name contains "test"; its public schema is wiped first.
 */
const url = process.env.TEST_DATABASE_URL;

interface Car {
  title?: string;
  model?: string;
  price: number;
  /** Hours ago AutoMeta first saw it. */
  seenHoursAgo?: number;
  cluster?: number | null;
  status?: "active" | "gone";
}

let next = 0;
/** 10:00 German time: no night rest. */
const DAY = new Date("2026-11-23T09:00:00Z");
const NIGHT = new Date("2026-11-23T23:30:00Z");

describe.skipIf(!url)("alerts against Postgres", () => {
  let pool: Pool;
  const sent: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
  let failWith: number | null = null;
  const fakeSend: SendToSubscription = async (subscription, payload) => {
    if (failWith !== null) throw Object.assign(new Error("push service says no"), { statusCode: failWith });
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
  };
  const run = (now = DAY) => runAlerts(pool, { send: fakeSend, now });

  async function addCar(car: Car): Promise<number> {
    next += 1;
    const { rows } = await pool.query<{ id: string }>(
      `insert into listings (source_id, external_id, url, title, make_slug, model_slug, make_raw, model_raw, price_eur,
                             mileage_km, first_registration, seller_type, cluster_id, status, first_seen_at, zip, city)
       values ('alert-test', $1, 'https://example.org/' || $1, $2, 'volkswagen', $3, 'VW', $3, $4,
               150000, '2010-01-01', 'private', $5, $6, now() - make_interval(hours => $7::int), '10115', 'Berlin')
       returning id`,
      [`car-${next}`, car.title ?? `VW Golf ${next}`, car.model ?? "golf", car.price, car.cluster ?? null, car.status ?? "active", car.seenHoursAgo ?? 0],
    );
    return Number(rows[0].id);
  }

  const subscription = (name: string): BrowserSubscription => ({
    endpoint: `https://push.example/${name}`,
    keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
  });

  /** A profile with one device that receives pushes. */
  async function pushProfile(name: string) {
    const device = await createProfile(pool, "Chrome auf Android");
    await saveSubscription(pool, device.profileId, device.deviceId, subscription(name));
    return device;
  }

  beforeAll(async () => {
    pool = await emptyTestDatabase();
    await migrate(pool);
    await seedReferenceData(pool);
    await pool.query("insert into sources (id, name, kind) values ('alert-test', 'Testbörse', 'scrape')");
  }, 60_000);

  beforeEach(async () => {
    await pool.query("delete from listings; delete from profiles; delete from app_keys");
    sent.length = 0;
    failWith = null;
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe("profiles", () => {
    it("finds a device by its token only", async () => {
      const device = await createProfile(pool, "Firefox auf Windows");
      expect(await findDevice(pool, device.token)).toEqual({ profileId: device.profileId, deviceId: device.deviceId });
      expect(await findDevice(pool, "x".repeat(43))).toBeNull();
      expect(await findDevice(pool, "not a token")).toBeNull();
      const stored = await pool.query("select token_hash from profile_devices where id = $1", [device.deviceId]);
      expect(stored.rows[0].token_hash.toString("hex")).not.toContain(Buffer.from(device.token).toString("hex"));
    });

    it("lets a second device join with a code, once, and brings its lists along", async () => {
      const pc = await createProfile(pool, "Chrome auf Windows");
      const phone = await createProfile(pool, "Safari auf iPhone");
      const golf = await addCar({ price: 2500 });
      const polo = await addCar({ price: 1500, model: "polo" });
      await setFavorite(pool, pc.profileId, golf, true);
      await setFavorite(pool, phone.profileId, polo, true);
      await saveSearch(pool, pc.profileId, "make=volkswagen&priceMax=3000", DEFAULT_FLIP_SETTINGS);
      await saveSearch(pool, phone.profileId, "make=volkswagen&priceMax=3000", DEFAULT_FLIP_SETTINGS);
      await saveSearch(pool, phone.profileId, "make=volkswagen&model=polo", DEFAULT_FLIP_SETTINGS);
      await saveSubscription(pool, phone.profileId, phone.deviceId, subscription("phone"));

      const { code } = await createLinkCode(pool, pc.profileId);
      const joined = await joinWithCode(pool, code.toLowerCase(), phone.token, "Safari auf iPhone");
      expect(joined).toEqual({ token: phone.token, profileId: pc.profileId });
      expect(await joinWithCode(pool, code, phone.token, "Safari auf iPhone")).toBeNull();

      expect(await findDevice(pool, phone.token)).toMatchObject({ profileId: pc.profileId });
      expect([...(await favoriteIds(pool, pc.profileId, [golf, polo]))].sort()).toEqual([golf, polo].sort());
      expect((await listSavedSearches(pool, pc.profileId)).map((s) => s.query).sort()).toEqual([
        "make=volkswagen&model=polo",
        "make=volkswagen&priceMax=3000",
      ]);
      expect(await countSubscriptions(pool, pc.profileId)).toBe(1);
      const { rows } = await pool.query("select 1 from profiles where id = $1", [phone.profileId]);
      expect(rows).toHaveLength(0);

      const devices = await listDevices(pool, { profileId: pc.profileId, deviceId: pc.deviceId });
      expect(devices.map((d) => [d.label, d.current, d.pushes])).toEqual(
        expect.arrayContaining([
          ["Chrome auf Windows", true, 0],
          ["Safari auf iPhone", false, 1],
        ]),
      );
      expect(await removeDevice(pool, { profileId: pc.profileId, deviceId: pc.deviceId }, phone.deviceId)).toBe(true);
      expect(await findDevice(pool, phone.token)).toBeNull();
      expect(await countSubscriptions(pool, pc.profileId)).toBe(0);
    });

    it("gives a browser without profile a new device, and rejects wrong or expired codes", async () => {
      const pc = await createProfile(pool, "Chrome auf Windows");
      const { code } = await createLinkCode(pool, pc.profileId);
      expect(await joinWithCode(pool, "AAAA-AAAA", null, "x")).toBeNull();
      const joined = await joinWithCode(pool, code, null, "Chrome auf Android");
      expect(joined?.profileId).toBe(pc.profileId);
      expect(joined?.token).not.toBe(pc.token);

      const late = await createLinkCode(pool, pc.profileId);
      await pool.query("update profile_link_codes set expires_at = now() - interval '1 minute'");
      expect(await joinWithCode(pool, late.code, null, "x")).toBeNull();
    });
  });

  describe("watch list", () => {
    it("keeps the price when saved and shows gone listings last", async () => {
      const device = await createProfile(pool, "x");
      const a = await addCar({ price: 2500 });
      const b = await addCar({ price: 1800 });
      expect(await setFavorite(pool, device.profileId, a, true)).toBe(true);
      expect(await setFavorite(pool, device.profileId, b, true)).toBe(true);
      expect(await setFavorite(pool, device.profileId, 999_999_999, true)).toBe(false);
      await pool.query("update listings set price_eur = 2200 where id = $1", [a]);
      await pool.query("update listings set status = 'gone', gone_reason = 'checked', gone_at = now() where id = $1", [b]);

      const list = await getFavorites(pool, device.profileId);
      expect(list.map((item) => [item.id, item.status, item.savedPriceEur, item.priceEur, item.priceBeforeDropEur])).toEqual([
        [a, "active", 2500, 2200, 2500],
        [b, "gone", 1800, 1800, null],
      ]);
      expect(await setFavorite(pool, device.profileId, a, false)).toBe(false);
      expect(await favoriteIds(pool, device.profileId, [a, b])).toEqual(new Set([b]));
    });

    it("pushes a price drop and a vanished listing once", async () => {
      const device = await pushProfile("watch");
      const a = await addCar({ title: "Polo", price: 2100, model: "polo" });
      const b = await addCar({ title: "Corsa", price: 900 });
      await setFavorite(pool, device.profileId, a, true);
      await setFavorite(pool, device.profileId, b, true);
      await run();
      expect(sent).toEqual([]);

      await pool.query("update listings set price_eur = 1800 where id = $1", [a]);
      await pool.query("update listings set status = 'gone' where id = $1", [b]);
      expect((await run()).favoritePushes).toBe(1);
      expect(sent[0].payload).toMatchObject({ title: "Merkliste: 2 Änderungen", url: "/merkliste" });
      expect(sent[0].payload.body).toContain("Polo: 2.100 € → 1.800 €");

      await run();
      expect(sent).toHaveLength(1);
      // Up again, then down to above the reported price: nothing to report.
      await pool.query("update listings set price_eur = 2000 where id = $1", [a]);
      await run();
      await pool.query("update listings set price_eur = 1900 where id = $1", [a]);
      await run();
      expect(sent).toHaveLength(2);
      expect(sent[1].payload.body).toBe("Polo: 2.000 € → 1.900 €");
    });

    it("waits for the morning at night", async () => {
      const device = await pushProfile("night");
      const a = await addCar({ price: 2100 });
      await setFavorite(pool, device.profileId, a, true);
      await pool.query("update listings set price_eur = 1800 where id = $1", [a]);
      await run(NIGHT);
      expect(sent).toHaveLength(0);
      await run(DAY);
      expect(sent).toHaveLength(1);
    });
  });

  describe("saved searches", () => {
    it("saves a search once per profile, normalized, with the flip settings", async () => {
      const device = await createProfile(pool, "x");
      const first = await saveSearch(pool, device.profileId, "?priceMax=3000&make=volkswagen&page=4", DEFAULT_FLIP_SETTINGS);
      expect(first).toMatchObject({ name: "Volkswagen · bis 3.000 €", created: true });
      const again = await saveSearch(pool, device.profileId, "make=volkswagen&priceMax=3000", { ...DEFAULT_FLIP_SETTINGS, level: 5 });
      expect(again).toEqual({ ...first, created: false });
      expect(await findSavedSearch(pool, device.profileId, "priceMax=3000&make=volkswagen")).toEqual({ id: first.id, name: first.name });
      const { rows } = await pool.query("select flip_settings from saved_searches where id = $1", [first.id]);
      expect(rows[0].flip_settings.level).toBe(5);
    });

    it("pushes new and cheaper vehicles once, and only after saving", async () => {
      const device = await pushProfile("search");
      await addCar({ price: 2000, seenHoursAgo: 5 });
      const search = await saveSearch(pool, device.profileId, "make=volkswagen&model=golf&priceMax=3000", DEFAULT_FLIP_SETTINGS);
      await run();
      expect(sent).toEqual([]);

      const fresh = await addCar({ title: "Golf neu", price: 2500 });
      await addCar({ title: "Golf zu teuer", price: 4500 });
      await addCar({ title: "Polo", price: 1000, model: "polo" });
      const result = await run();
      expect(result).toMatchObject({ searchPushes: 1, vehicles: 1 });
      expect(sent[0].payload).toMatchObject({ url: `/angebot/${fresh}` });
      expect(sent[0].payload.title).toBe(`1 neu: ${search.name}`);

      await run();
      expect(sent).toHaveLength(1);

      // An expensive one that gets cheap enough, and the reported one dropping further: both again.
      const pricey = (await pool.query("select id from listings where title = 'Golf zu teuer'")).rows[0].id;
      await pool.query("update listings set price_eur = 2900 where id = $1", [pricey]);
      await pool.query("update listings set price_eur = 2300 where id = $1", [fresh]);
      await run();
      expect(sent).toHaveLength(2);
      expect(sent[1].payload.title).toBe(`2 günstiger: ${search.name}`);
      expect(sent[1].payload.body).toContain("(vorher 4.500\u00a0€)");
      expect(sent[1].payload.url).toMatch(new RegExp(`^/suchauftraege/${search.id}/neu\\?ab=`));
      const { rows } = await pool.query("select last_alert_count from saved_searches where id = $1", [search.id]);
      expect(rows[0].last_alert_count).toBe(2);
    });

    it("reports a vehicle on several portals once, and not when a portal had it before", async () => {
      const device = await pushProfile("dupes");
      const search = await saveSearch(pool, device.profileId, "make=volkswagen&model=golf", DEFAULT_FLIP_SETTINGS);
      await pool.query("update saved_searches set alerts_from = now() - interval '1 day' where id = $1", [search.id]);
      // Known for days on one portal, new on another today: not new.
      await addCar({ price: 3000, cluster: 1, seenHoursAgo: 72 });
      await addCar({ price: 2900, cluster: 1, seenHoursAgo: 1 });
      // New today on two portals: one vehicle.
      await addCar({ price: 4000, cluster: 2, seenHoursAgo: 2 });
      const cheapest = await addCar({ price: 3900, cluster: 2, seenHoursAgo: 1 });
      expect((await run()).vehicles).toBe(1);
      expect(sent[0].payload.url).toBe(`/angebot/${cheapest}`);
      // The other portal's listing gets cheaper than the reported one: still the same vehicle,
      // but it is a price drop, so it counts.
      const other = (await pool.query("select id from listings where cluster_id = 2 and price_eur = 4000")).rows[0].id;
      await pool.query("update listings set price_eur = 3800 where id = $1", [other]);
      await run();
      expect(sent).toHaveLength(2);
    });

    it("stays quiet at night, without push devices or with pushes off, and reports from switching on", async () => {
      const quiet = await pushProfile("quiet");
      const silent = await createProfile(pool, "no push");
      const a = await saveSearch(pool, quiet.profileId, "make=volkswagen", DEFAULT_FLIP_SETTINGS);
      await saveSearch(pool, silent.profileId, "make=volkswagen", DEFAULT_FLIP_SETTINGS);
      await addCar({ price: 1000 });
      await run(NIGHT);
      expect(sent).toHaveLength(0);
      await run(DAY);
      expect(sent.map((s) => s.endpoint)).toEqual(["https://push.example/quiet"]);

      await setSearchNotify(pool, quiet.profileId, a.id, false);
      await addCar({ price: 1100 });
      await run();
      expect(sent).toHaveLength(1);
      await setSearchNotify(pool, quiet.profileId, a.id, true);
      await run();
      // Switched back on: what came in while it was off is not pushed.
      expect(sent).toHaveLength(1);
      await addCar({ price: 1200 });
      await run();
      expect(sent).toHaveLength(2);
    });

    it("drops subscriptions the push service no longer knows and tries again later otherwise", async () => {
      const device = await pushProfile("gone");
      await saveSearch(pool, device.profileId, "make=volkswagen", DEFAULT_FLIP_SETTINGS);
      await addCar({ price: 1000 });
      failWith = 500;
      expect((await run()).searchPushes).toBe(0);
      expect(await countSubscriptions(pool, device.profileId)).toBe(1);
      failWith = 410;
      await run();
      expect(await countSubscriptions(pool, device.profileId)).toBe(0);
      failWith = null;
      await saveSubscription(pool, device.profileId, device.deviceId, subscription("again"));
      // The first device for pushes again: reporting starts now, not with the waiting car.
      await run();
      expect(sent).toHaveLength(0);
    });

    it("counts new ones since last opened and opens them with 'seit'", async () => {
      const device = await createProfile(pool, "x");
      const search = await saveSearch(pool, device.profileId, "make=volkswagen&model=golf", DEFAULT_FLIP_SETTINGS);
      await pool.query("update saved_searches set seen_at = now() - interval '2 hours' where id = $1", [search.id]);
      await addCar({ price: 1000, seenHoursAgo: 5 });
      await addCar({ price: 1100, seenHoursAgo: 1 });
      const [listed] = await listSavedSearches(pool, device.profileId);
      expect(listed).toMatchObject({ total: 2, fresh: 1 });

      const target = await openNewOfSearch(pool, device.profileId, search.id);
      const params = new URL(target!, "https://x").searchParams;
      expect(params.get("make")).toBe("volkswagen");
      const result = await searchListings(pool, parseFilters(params), null);
      expect(result.items.map((item) => item.priceEur)).toEqual([1100]);
      expect((await listSavedSearches(pool, device.profileId))[0].fresh).toBe(0);
      expect(await openNewOfSearch(pool, device.profileId + 1, search.id)).toBeNull();
    });
  });

  it("makes its VAPID key pair once and keeps it", async () => {
    const first = await getVapidKeys(pool);
    expect(first.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(await getVapidKeys(pool)).toEqual(first);
    const device = await pushProfile("test");
    expect(await pushToProfile(pool, device.profileId, { title: "Test", body: "", url: "/" }, fakeSend)).toEqual({ sent: 1, failed: 0 });
  });
});
