import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PoliteFetcher } from "@/ingest/http/fetcher";
import { migrate } from "@/ingest/migrate";
import { probe } from "@/ingest/probe";
import { getSample, listSamples, MAX_BODY_CHARS, MAX_SAMPLES, saveSample } from "@/ingest/samples";
import { getRecentRuns, getSourceHealth } from "@/ingest/status";
import { emptyTestDatabase } from "./test-database";

/** Stored pages, test fetches and the source status behind /admin/quellen, against Postgres. */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("admin diagnostics", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await emptyTestDatabase();
    await migrate(pool);
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    await pool.query("truncate scrape_samples, ingest_runs, listings, sources cascade");
  });

  it("stores pages, keeps only the newest and cuts very long ones", async () => {
    const big = await saveSample(pool, {
      sourceId: "quoka",
      url: "https://www.quoka.de/big",
      status: 200,
      reason: "format-error",
      body: `x\0${"y".repeat(MAX_BODY_CHARS + 10)}`,
    });
    const stored = await getSample(pool, big);
    expect(stored).toMatchObject({ sourceId: "quoka", status: 200, truncated: true, length: MAX_BODY_CHARS - 1 });
    expect(stored?.body.startsWith("xy")).toBe(true);

    for (let i = 0; i < MAX_SAMPLES + 5; i += 1) {
      await saveSample(pool, { sourceId: null, url: `https://www.quoka.de/${i}`, status: 200, reason: "probe", body: `page ${i}` });
    }
    const samples = await listSamples(pool);
    expect(samples).toHaveLength(MAX_SAMPLES);
    expect(samples[0].url).toBe(`https://www.quoka.de/${MAX_SAMPLES + 4}`);
    expect(await getSample(pool, big)).toBeNull();
  });

  it("fetches a page and its own scripts through the polite fetcher", async () => {
    const requested: string[] = [];
    const routes: Record<string, string> = {
      "https://suche.pkw.de/robots.txt": "User-agent: Googlebot\nDisallow: /fahrzeuge?\n\nUser-agent: *\nDisallow: /privat/\n",
      "https://suche.pkw.de/fahrzeuge": `<html><script src="/app.js"></script><script src="/privat/x.js"></script><script src="https://cdn.example/lib.js"></script></html>`,
      "https://suche.pkw.de/app.js": `fetch("/api/search")`,
    };
    const fetchImpl = (async (input: string | URL) => {
      requested.push(String(input));
      const body = routes[String(input)];
      return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
    }) as typeof fetch;
    const fetcher = new PoliteFetcher({ fetchImpl, sleep: async () => undefined, minDelayMs: 0, random: () => 0 });

    const outcomes = await probe(pool, "https://suche.pkw.de/fahrzeuge", { scripts: true, fetcher });

    expect(outcomes.map((o) => [o.url, o.status ?? o.error?.split(":")[0]])).toEqual([
      ["https://suche.pkw.de/fahrzeuge", 200],
      ["https://suche.pkw.de/app.js", 200],
      ["https://suche.pkw.de/privat/x.js", "DisallowedError"],
    ]);
    // Another site's script and the disallowed one are never requested.
    expect(requested).not.toContain("https://cdn.example/lib.js");
    expect(requested).not.toContain("https://suche.pkw.de/privat/x.js");
    const script = await getSample(pool, outcomes[1].sampleId!);
    expect(script).toMatchObject({ reason: "probe-script", body: `fetch("/api/search")` });
  });

  it("refuses pages outside the known portals", async () => {
    const outcomes = await probe(pool, "https://suchen.mobile.de/fahrzeuge/search.html");
    expect(outcomes[0].error).toMatch(/only https pages of/);
    expect(await listSamples(pool)).toHaveLength(0);
  });

  it("reports listings and the latest run per source", async () => {
    await pool.query(
      `insert into sources (id, name, kind, website_url) values
         ('quoka', 'Quoka', 'scrape', 'https://www.quoka.de'), ('autohero', 'Autohero', 'scrape', null)`,
    );
    await pool.query(
      `insert into ingest_runs (source_id, started_at, finished_at, fetched, upserted) values
         ('quoka', now() - interval '2 hours', now() - interval '110 minutes', 40, 38)`,
    );
    await pool.query(
      `insert into ingest_runs (source_id, started_at, finished_at, fetched, error) values
         ('quoka', now() - interval '1 hour', now() - interval '59 minutes', 0, 'Quoka: no listings found')`,
    );
    const health = await getSourceHealth(pool);
    const quoka = health.find((s) => s.id === "quoka");
    expect(quoka).toMatchObject({ activeListings: 0, lastRun: { fetched: 0, error: "Quoka: no listings found" } });
    expect(quoka?.lastSuccessAt).not.toBeNull();
    expect(health.find((s) => s.id === "autohero")).toMatchObject({ lastRun: null, lastSuccessAt: null });
    expect((await getRecentRuns(pool)).map((r) => r.fetched)).toEqual([0, 40]);
  });
});
