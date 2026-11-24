import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LISTING_RULES_VERSION } from "@/core/plausibility";
import type { NormalizedListing } from "@/core/types";
import type { RawListing, SourceAdapter, SourceInfo } from "@/ingest/adapter";
import { updateMarketValues } from "@/ingest/market";
import { migrate } from "@/ingest/migrate";
import { reviewStoredListings } from "@/ingest/review";
import { runIngest } from "@/ingest/run";
import { seedReferenceData } from "@/ingest/seed";
import { emptyTestDatabase } from "./test-database";

/**
 * Data quality against a real Postgres: listings stored before an import rule existed are reviewed
 * at start-up. Set TEST_DATABASE_URL to a database whose name contains "test"; it is wiped.
 */
const url = process.env.TEST_DATABASE_URL;

const NOW = new Date("2026-11-24T10:00:00Z");
const PORTAL: SourceInfo = { id: "portal-q", name: "Portal Q", kind: "scrape", websiteUrl: "https://q.example" };
const DEMO: SourceInfo = { id: "demo-q", name: "Demo Q", kind: "demo", websiteUrl: null };

function car(source: SourceInfo, externalId: string, overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    sourceId: source.id,
    externalId,
    url: `https://q.example/angebot/${externalId}`,
    title: "Volkswagen Golf 1.5 TSI",
    makeSlug: "volkswagen",
    modelSlug: "golf",
    makeRaw: "Volkswagen",
    modelRaw: "Golf",
    variant: "1.5 TSI",
    priceEur: 20_000,
    mileageKm: 50_000,
    firstRegistration: "2020-03-01",
    fuel: "petrol",
    transmission: "manual",
    powerKw: 96,
    bodyType: null,
    color: null,
    sellerType: null,
    sellerName: null,
    zip: "10115",
    city: "Berlin",
    lat: null,
    lng: null,
    imageUrl: null,
    ...overrides,
  };
}

/** An adapter that stores the given listings as they are, like one written before the rules. */
function portal(source: SourceInfo, listings: NormalizedListing[]): SourceAdapter {
  return {
    source,
    fullSnapshot: false,
    normalize: (raw: RawListing) => ({ ...(raw.payload as unknown as NormalizedListing) }),
    async *fetch() {
      for (const listing of listings) yield { externalId: listing.externalId, payload: listing as unknown as Record<string, unknown> };
    },
  };
}

describe.skipIf(!url)("reviewing stored listings against the import rules", () => {
  let pool: Pool;

  const row = async (externalId: string) => {
    const { rows } = await pool.query<{
      status: string;
      gone_reason: string | null;
      first_registration: string | null;
      first_registration_year_only: boolean;
      mileage_km: number | null;
      hu_basis: string | null;
    }>(
      `select status, gone_reason, to_char(first_registration, 'YYYY-MM-DD') as first_registration, first_registration_year_only,
              mileage_km, hu_basis
         from listings where external_id = $1`,
      [externalId],
    );
    return rows[0];
  };

  beforeAll(async () => {
    pool = await emptyTestDatabase();
    await migrate(pool);
    await seedReferenceData(pool);
  }, 60_000);

  beforeEach(async () => {
    await pool.query("delete from sources");
    await pool.query("delete from listing_reviews");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("takes wanted ads and placeholder prices out and corrects what cannot be right, once per rules version", async () => {
    await runIngest(
      pool,
      portal(PORTAL, [
        car(PORTAL, "ok"),
        car(PORTAL, "swap-ok", { title: "VW Golf 7 Tausch möglich" }),
        car(PORTAL, "wanted", { title: "Suchen Golf 3 1,8 75PS /90PS für Bastler", priceEur: 200 }),
        car(PORTAL, "swap", { title: "iphone 18 pro max weschel gegen eine transporter", priceEur: 100, mileageKm: 0, firstRegistration: "2026-01-01" }),
        car(PORTAL, "962", { title: "Porsche 962", makeSlug: "porsche", modelSlug: "962", priceEur: 9_999_999, powerKw: 470 }),
        car(PORTAL, "puma", { title: "Ford Puma 1.0 EcoBoost", makeSlug: "ford", modelSlug: "puma", priceEur: 2_992_661, powerKw: 124, mileageKm: 0, firstRegistration: null }),
        car(PORTAL, "997", {
          title: "Porsche 911 Carrera 4s 997.1",
          makeSlug: "porsche",
          modelSlug: "911",
          priceEur: 42_900,
          firstRegistration: "2025-08-01",
          firstRegistrationYearOnly: true,
        }),
        car(PORTAL, "corsa", { title: "Opel Corsa A GSI", makeSlug: "opel", modelSlug: "corsa", priceEur: 6500, mileageKm: 0, firstRegistration: "1984-05-01" }),
        car(PORTAL, "future", { title: "Hyundai IONIQ 3 Trend", makeSlug: "hyundai", modelSlug: null, firstRegistration: "2027-01-01" }),
      ]),
    );
    await runIngest(pool, portal(DEMO, [car(DEMO, "demo-wanted", { title: "Suche Golf 7" })]));
    // A HU date worked out from the first registration, as the import stores it for young cars.
    await pool.query("update listings set hu_until = '2028-08-01', hu_basis = 'registration' where external_id = '997'");
    // A listing that already left the search stays as it is.
    await pool.query("update listings set status = 'gone', gone_reason = 'missed' where external_id = 'puma'");

    const first = await reviewStoredListings(pool, NOW);
    expect(first).toEqual({ ran: true, reviewed: 8, filtered: 3, corrected: 3 });

    expect(await row("ok")).toMatchObject({ status: "active", gone_reason: null, first_registration: "2020-03-01", mileage_km: 50_000 });
    expect(await row("swap-ok")).toMatchObject({ status: "active" });
    for (const id of ["wanted", "swap", "962"]) expect(await row(id), id).toMatchObject({ status: "gone", gone_reason: "filtered" });
    expect(await row("puma")).toMatchObject({ status: "gone", gone_reason: "missed" });
    expect(await row("997")).toMatchObject({ status: "active", first_registration: null, first_registration_year_only: false, hu_basis: null });
    expect(await row("corsa")).toMatchObject({ status: "active", first_registration: "1984-05-01", mileage_km: null });
    expect(await row("future")).toMatchObject({ status: "active", first_registration: null });
    expect(await row("demo-wanted")).toMatchObject({ status: "active" });

    const { rows } = await pool.query<{ version: number }>("select version from listing_reviews");
    expect(rows).toEqual([{ version: LISTING_RULES_VERSION }]);
    expect(await reviewStoredListings(pool, NOW)).toEqual({ ran: false, reviewed: 0, filtered: 0, corrected: 0 });
  });

  it("writes place names as the postal code data does where the portal's are cut or misspelled", async () => {
    await runIngest(
      pool,
      portal(PORTAL, [
        car(PORTAL, "kreutz", { zip: "14550", city: "Gross kreutz" }),
        car(PORTAL, "vohburg", { zip: "85088", city: "Vohburg a.d.Donau, St" }),
        car(PORTAL, "kreuznach", { zip: "55543", city: "Bad Kreuznach, Stadt" }),
        car(PORTAL, "elsewhere", { zip: "85088", city: "Ingolstadt" }),
      ]),
    );
    const { rows } = await pool.query<{ external_id: string; city: string }>("select external_id, city from listings order by external_id");
    expect(Object.fromEntries(rows.map((r) => [r.external_id, r.city]))).toEqual({
      kreutz: "Groß Kreutz",
      vohburg: "Vohburg an der Donau",
      kreuznach: "Bad Kreuznach",
      elsewhere: "Ingolstadt",
    });
  });

  it("leaves listings taken out by the rules out of the market values", async () => {
    // Six comparable Golfs and a wanted ad at a giveaway price, all within the gone window.
    const golfs = [17_000, 18_000, 19_000, 20_000, 21_000, 22_000].map((price, i) => car(PORTAL, `golf-${i}`, { priceEur: price }));
    await runIngest(pool, portal(PORTAL, [...golfs, car(PORTAL, "wanted", { title: "Suche Golf 1.5 TSI", priceEur: 600 })]));
    await reviewStoredListings(pool, NOW);
    await updateMarketValues(pool);
    const { rows } = await pool.query<{ external_id: string; market_price_eur: number | null }>(
      "select external_id, market_price_eur from listings where status = 'active' order by external_id",
    );
    expect(rows.map((r) => r.external_id)).not.toContain("wanted");
    // The median of the five other Golfs; with the 600 € wanted ad it would be 19,500 €.
    expect(rows.find((r) => r.external_id === "golf-0")).toMatchObject({ market_price_eur: 20_000 });
  });
});
