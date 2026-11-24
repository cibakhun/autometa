import { describe, expect, it } from "vitest";
import type { CheckResult, ListingRef } from "../adapter";
import { BlockedError, PoliteFetcher, type FetchedPage } from "../http/fetcher";
import { kleinanzeigenFacts, kleinanzeigenVerdict } from "./kleinanzeigen";
import { CHECK_GROUP, checkListingPages, MAX_NOT_FOR_SALE_IN_GROUP, MAX_PRICE_CHANGES_IN_GROUP, MAX_UNCLEAR_IN_A_ROW, portalText } from "./listing-check";
import { quokaDisallowedRedirect, quokaVerdict } from "./quoka";

type Reply = { status?: number; body?: string; location?: string };

/** A fake portal: answers by URL; anything unknown is 404. */
function fakeSite(routes: Record<string, Reply>, options: { maxRequests?: number } = {}) {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    requested.push(url);
    const reply = routes[url];
    if (!reply) return new Response("not found", { status: 404 });
    return new Response(reply.body ?? "", { status: reply.status ?? 200, headers: reply.location ? { location: reply.location } : {} });
  }) as typeof fetch;
  const fetcher = new PoliteFetcher({ fetchImpl, sleep: async () => undefined, minDelayMs: 0, random: () => 0, ...options });
  return { fetcher, requested };
}

const KA = "https://www.kleinanzeigen.de";
const adUrl = (id: string) => `${KA}/s-anzeige/bmw-320d/${id}-216-3331`;
const ref = (id: string, priceEur = 12500): ListingRef => ({ externalId: id, url: adUrl(id), priceEur });
const adPage = (id: string, extra = "") => ({ body: `<html><head><link rel="canonical" href="${adUrl(id)}"></head><body><h1>BMW 320d</h1>${extra}</body></html>` });

async function collect(source: AsyncIterable<CheckResult>) {
  const results: CheckResult[] = [];
  for await (const result of source) results.push(result);
  return results;
}

function kleinanzeigenChecks(routes: Record<string, Reply>, due: ListingRef[], options: { maxRequests?: number } = {}) {
  const site = fakeSite({ [`${KA}/robots.txt`]: { body: "User-agent: *\nDisallow: /m-einloggen.html\n" }, ...routes }, options);
  const logs: string[] = [];
  const run = collect(checkListingPages(due, { fetcher: site.fetcher, log: (m) => logs.push(m), verdict: kleinanzeigenVerdict }));
  return { run, site, logs };
}

describe("checkListingPages with Kleinanzeigen's ad pages", () => {
  it("tells online, taken down and unclear ads apart", async () => {
    const { run, logs } = kleinanzeigenChecks(
      {
        [adUrl("1")]: adPage("1"),
        // 2 is not there any more.
        [adUrl("3")]: adPage("3", `<h1><span>Gelöscht</span> • BMW 320d</h1>`),
        [adUrl("4")]: { status: 301, location: `${KA}/s-autos/c216` },
        [`${KA}/s-autos/c216`]: { body: "<html>Autos</html>" },
        [adUrl("5")]: { status: 410 },
        [adUrl("6")]: { body: "<html>Wartungsarbeiten</html>" },
        [adUrl("7")]: adPage("7", "<p>Fehlerspeicher gelöscht, Anzeige bis Sonntag online</p>"),
        [adUrl("8")]: { status: 400 },
      },
      ["1", "2", "3", "4", "5", "6", "7", "8"].map(ref),
    );
    expect(await run).toEqual([
      { externalId: "1", outcome: "active" },
      { externalId: "2", outcome: "gone" },
      { externalId: "3", outcome: "gone" },
      { externalId: "4", outcome: "gone" },
      { externalId: "5", outcome: "gone" },
      { externalId: "6", outcome: "unclear" },
      { externalId: "7", outcome: "active" },
      { externalId: "8", outcome: "unclear" },
    ]);
    expect(logs.at(-1)).toBe("checked 8 listing pages: 2 online, 4 taken down, 2 unclear");
  });

  it("does not take an ad down for what its seller wrote", async () => {
    const page = adPage(
      "10",
      `<meta name="description" content="Anzeige gelöscht und neu eingestellt">
       <div id="viewad-description" class="box"><h2>Beschreibung</h2>
       <p id="viewad-description-text" itemprop="description">Meine alte Anzeige wurde gelöscht,<br>daher neu eingestellt.</p></div>
       <script type="application/ld+json">{"description":"Diese Anzeige ist nicht mehr verfügbar ab Montag"}</script>`,
    );
    const { run } = kleinanzeigenChecks({ [adUrl("10")]: page }, [ref("10")]);
    expect(await run).toEqual([{ externalId: "10", outcome: "active" }]);
    expect(portalText(page.body)).not.toMatch(/gelöscht|verfügbar/);
  });

  it("follows an ad that moved to a new address with the same id", async () => {
    const moved = `${KA}/s-anzeige/bmw-320d-touring/9-216-3331`;
    const { run } = kleinanzeigenChecks({ [adUrl("9")]: { status: 301, location: moved }, [moved]: adPage("9") }, [ref("9")]);
    expect(await run).toEqual([{ externalId: "9", outcome: "active" }]);
  });

  it("stops at the run's budget and keeps what it checked", async () => {
    const { run, site } = kleinanzeigenChecks({ [adUrl("1")]: adPage("1"), [adUrl("2")]: adPage("2") }, ["1", "2", "3"].map(ref), {
      // robots.txt and two ads.
      maxRequests: 3,
    });
    expect(await run).toEqual([
      { externalId: "1", outcome: "active" },
      { externalId: "2", outcome: "active" },
    ]);
    expect(site.requested).not.toContain(adUrl("3"));
  });

  it("does not believe a group in which nearly every ad is gone, and stops", async () => {
    const due = Array.from({ length: CHECK_GROUP * 2 }, (_, i) => ref(String(i + 1)));
    // Every page answers 404, as a portal might for a bot it no longer serves.
    const { run, logs, site } = kleinanzeigenChecks({}, due);
    expect(await run).toEqual([]);
    expect(site.requested).toHaveLength(1 + CHECK_GROUP);
    expect(logs.some((line) => line.startsWith("checks stopped: 25 of 25 listings in a row look taken down"))).toBe(true);
  });

  it("passes on a group with many but not nearly all ads gone", async () => {
    const due = Array.from({ length: CHECK_GROUP }, (_, i) => ref(String(i + 1)));
    const online = Object.fromEntries(["1", "2", "3", "4", "5"].map((id) => [adUrl(id), adPage(id)]));
    const { run } = kleinanzeigenChecks(online, due);
    const results = await run;
    expect(results).toHaveLength(CHECK_GROUP);
    expect(results.filter((r) => r.outcome === "gone")).toHaveLength(20);
  });

  it("stops after too many unclear pages in a row", async () => {
    const due = Array.from({ length: MAX_UNCLEAR_IN_A_ROW + 5 }, (_, i) => ref(String(i + 1)));
    const routes = Object.fromEntries(due.map((r) => [r.url, { body: "<html>Bitte Cookies zulassen</html>" }]));
    const { run, logs } = kleinanzeigenChecks(routes, due);
    const results = await run;
    expect(results).toHaveLength(MAX_UNCLEAR_IN_A_ROW);
    expect(results.every((r) => r.outcome === "unclear")).toBe(true);
    expect(logs.some((line) => line.includes("unclear pages in a row"))).toBe(true);
  });

  it("ends the run at a block and hands on what it checked before", async () => {
    const site = fakeSite({
      [`${KA}/robots.txt`]: { body: "User-agent: *\n" },
      [adUrl("1")]: adPage("1"),
      [adUrl("3")]: { status: 429 },
    });
    const results: CheckResult[] = [];
    const run = async () => {
      for await (const result of checkListingPages(["1", "2", "3", "4"].map(ref), { fetcher: site.fetcher, log: () => undefined, verdict: kleinanzeigenVerdict })) {
        results.push(result);
      }
    };
    await expect(run()).rejects.toBeInstanceOf(BlockedError);
    expect(results).toEqual([
      { externalId: "1", outcome: "active" },
      { externalId: "2", outcome: "gone" },
    ]);
    expect(site.requested).not.toContain(adUrl("4"));
  });

  it("stops at once when robots.txt forbids the ad pages", async () => {
    const site = fakeSite({ [`${KA}/robots.txt`]: { body: "User-agent: *\nDisallow: /s-anzeige/\n" } });
    const logs: string[] = [];
    const results = await collect(
      checkListingPages([ref("1"), ref("2")], { fetcher: site.fetcher, log: (m) => logs.push(m), verdict: kleinanzeigenVerdict }),
    );
    expect(results).toEqual([]);
    expect(site.requested).toEqual([`${KA}/robots.txt`]);
    expect(logs[0]).toMatch(/^checks stopped: robots.txt forbids/);
  });
});

/** The boxes under an ad's title as Kleinanzeigen shows them: price, then the day it was put online. */
const priceBoxes = (price: string, day = "18.11.2026") =>
  `<div class="boxedarticle--flex--container"><h2 class="boxedarticle--price" id="viewad-price">
     ${price}</h2></div>
   <div id="viewad-extra-info" class="boxedarticle--details--full">
     <div><i class="icon icon-small icon-calendar-gray-simple"></i><span>${day}</span></div>
     <div><i class="icon icon-small icon-eye-gray-simple"></i><span id="viewad-cntr-num"></span></div>
   </div>`;

describe("checkListingPages reading the price on Kleinanzeigen's ad pages", () => {
  const facts = (_ref: ListingRef, page: FetchedPage) => kleinanzeigenFacts(page, Date.parse("2026-11-23T22:00:00Z"));

  it("hands on the price and the day put online of ads that are online", async () => {
    const site = fakeSite({
      [`${KA}/robots.txt`]: { body: "User-agent: *\n" },
      [adUrl("1")]: adPage("1", priceBoxes("11.900 € VB")),
      [adUrl("2")]: adPage("2", priceBoxes("VB")),
      [adUrl("3")]: adPage("3", `<h1><span>Gelöscht</span> • BMW 320d</h1>${priceBoxes("9.000 €")}`),
    });
    const logs: string[] = [];
    const results = await collect(
      checkListingPages([ref("1"), ref("2"), ref("3")], { fetcher: site.fetcher, log: (m) => logs.push(m), verdict: kleinanzeigenVerdict, facts }),
    );
    expect(results).toEqual([
      { externalId: "1", outcome: "active", priceEur: 11900, listedOn: "2026-11-18" },
      // "VB" alone is no price: the stored one stays.
      { externalId: "2", outcome: "active", listedOn: "2026-11-18" },
      // Nothing is read from an ad that is taken down.
      { externalId: "3", outcome: "gone" },
    ]);
    expect(logs.at(-1)).toBe("checked 3 listing pages: 2 online, 1 taken down, 0 unclear, 1 new prices");
  });

  it("does not believe prices when too many in a group changed, but keeps the outcomes", async () => {
    const due = Array.from({ length: CHECK_GROUP }, (_, i) => ref(String(i + 1), 12500));
    const changed = MAX_PRICE_CHANGES_IN_GROUP + 1;
    const routes = Object.fromEntries(due.map((r, i) => [r.url, adPage(r.externalId, priceBoxes(i < changed ? "2.019 €" : "12.500 € VB"))]));
    const logs: string[] = [];
    const site = fakeSite({ [`${KA}/robots.txt`]: { body: "User-agent: *\n" }, ...routes });
    const results = await collect(checkListingPages(due, { fetcher: site.fetcher, log: (m) => logs.push(m), verdict: kleinanzeigenVerdict, facts }));
    expect(results).toHaveLength(CHECK_GROUP);
    expect(results.every((r) => r.outcome === "active" && r.priceEur === undefined && r.listedOn === "2026-11-18")).toBe(true);
    expect(logs.some((line) => line.startsWith(`prices ignored: ${changed} of ${CHECK_GROUP} listing pages`))).toBe(true);
  });

  describe("dealers buying up cars", () => {
    const buyerFacts = (ref: ListingRef, page: FetchedPage) => kleinanzeigenFacts(page, Date.parse("2026-11-23T22:00:00Z"), ref);
    const buyer = `<p id="viewad-description-text" itemprop="description">KFZ Handel Berlin kauft ihr Auto auf.</p>`;
    const titled = (id: string): ListingRef => ({ ...ref(id), title: "Unfallwagen Motorschaden Getriebeschaden" });

    it("hands on that an online ad offers no car, with its other facts", async () => {
      const site = fakeSite({ [`${KA}/robots.txt`]: { body: "User-agent: *\n" }, [adUrl("1")]: adPage("1", priceBoxes("12.500 € VB") + buyer) });
      const results = await collect(checkListingPages([titled("1")], { fetcher: site.fetcher, log: () => undefined, verdict: kleinanzeigenVerdict, facts: buyerFacts }));
      expect(results).toEqual([{ externalId: "1", outcome: "active", priceEur: 12500, listedOn: "2026-11-18", notForSale: true }]);
    });

    it("does not believe it for too many ads of a group, but keeps their outcomes", async () => {
      const due = Array.from({ length: CHECK_GROUP }, (_, i) => titled(String(i + 1)));
      const flagged = MAX_NOT_FOR_SALE_IN_GROUP + 1;
      const routes = Object.fromEntries(due.map((r, i) => [r.url, adPage(r.externalId, priceBoxes("12.500 € VB") + (i < flagged ? buyer : ""))]));
      const logs: string[] = [];
      const site = fakeSite({ [`${KA}/robots.txt`]: { body: "User-agent: *\n" }, ...routes });
      const results = await collect(checkListingPages(due, { fetcher: site.fetcher, log: (m) => logs.push(m), verdict: kleinanzeigenVerdict, facts: buyerFacts }));
      expect(results).toHaveLength(CHECK_GROUP);
      expect(results.every((r) => r.outcome === "active" && r.notForSale === undefined && r.priceEur === 12500)).toBe(true);
      expect(logs.some((line) => line.startsWith(`buyer ads ignored: ${flagged} of ${CHECK_GROUP} listing pages`))).toBe(true);
    });
  });

  it("passes on a group in which some prices changed", async () => {
    const due = Array.from({ length: CHECK_GROUP }, (_, i) => ref(String(i + 1), 12500));
    const routes = Object.fromEntries(
      due.map((r, i) => [r.url, adPage(r.externalId, priceBoxes(i < MAX_PRICE_CHANGES_IN_GROUP ? "11.000 €" : "12.500 € VB"))]),
    );
    const site = fakeSite({ [`${KA}/robots.txt`]: { body: "User-agent: *\n" }, ...routes });
    const results = await collect(checkListingPages(due, { fetcher: site.fetcher, log: () => undefined, verdict: kleinanzeigenVerdict, facts }));
    expect(results.filter((r) => r.priceEur === 11000)).toHaveLength(MAX_PRICE_CHANGES_IN_GROUP);
    expect(results.filter((r) => r.priceEur === 12500)).toHaveLength(CHECK_GROUP - MAX_PRICE_CHANGES_IN_GROUP);
  });
});

describe("checkListingPages with Quoka's ad pages", () => {
  const QUOKA = "https://www.quoka.de";
  const quokaAd = (id: string) => `${QUOKA}/anzeigen/auto-motorrad/automarkt/anzeige/vw-golf-7/${id}.html`;

  it("counts a redirect to the not-found page robots.txt forbids as taken down", async () => {
    const site = fakeSite({
      [`${QUOKA}/robots.txt`]: { body: "User-agent: *\nAllow: /\nDisallow: /Detailansicht-AdNotFound/\n" },
      [quokaAd("abc12345")]: { body: `<html><link rel="canonical" href="${quokaAd("abc12345")}"><h1>VW Golf 7</h1></html>` },
      // A cookie wall at the ad's address says nothing about the ad.
      [quokaAd("mno97531")]: { body: "<html><p>Wir verwenden Cookies</p></html>" },
      // The seller's words are not Quoka's notice.
      [quokaAd("pqr86420")]: {
        body: `<html><link rel="canonical" href="${quokaAd("pqr86420")}"><div class="description">Alte Anzeige wurde gelöscht, Auto ist noch da.</div></html>`,
      },
      [quokaAd("def67890")]: { status: 301, location: `${QUOKA}/Detailansicht-AdNotFound/?id=def67890` },
      [quokaAd("ghi13579")]: { status: 302, location: `${QUOKA}/anzeigen/auto-motorrad/automarkt/` },
      [`${QUOKA}/anzeigen/auto-motorrad/automarkt/`]: { body: "<html>Automarkt</html>" },
      [quokaAd("jkl24680")]: { body: "<html><p>Diese Anzeige ist nicht mehr verfügbar.</p></html>" },
    });
    const due = ["abc12345", "def67890", "ghi13579", "jkl24680", "mno97531", "pqr86420"].map((id) => ({ externalId: id, url: quokaAd(id), priceEur: 2500 }));
    const results = await collect(
      checkListingPages(due, { fetcher: site.fetcher, log: () => undefined, verdict: quokaVerdict, disallowedRedirect: quokaDisallowedRedirect }),
    );
    expect(results).toEqual([
      { externalId: "abc12345", outcome: "active" },
      { externalId: "def67890", outcome: "gone" },
      { externalId: "ghi13579", outcome: "gone" },
      { externalId: "jkl24680", outcome: "gone" },
      { externalId: "mno97531", outcome: "unclear" },
      { externalId: "pqr86420", outcome: "active" },
    ]);
    expect(site.requested).not.toContain(`${QUOKA}/Detailansicht-AdNotFound/?id=def67890`);
  });
});
