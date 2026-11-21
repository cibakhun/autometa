import { describe, expect, it } from "vitest";
import { PoliteFetcher } from "../http/fetcher";
import { RdwClient, RdwQueryError, soqlDate, soqlIn, soqlString, soqlUrl } from "./rdw";

/** Pacing without real waiting: sleeping moves a fake clock forward. */
function virtualClock() {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
}

/** A client whose fetcher answers from a function and records the decoded URLs. */
function client(answer: (url: URL) => Response) {
  const urls: URL[] = [];
  const fetcher = new PoliteFetcher({
    respectRobots: false,
    minDelayMs: 1000,
    ...virtualClock(),
    fetchImpl: (async (input: string | URL) => {
      const url = new URL(String(input));
      urls.push(url);
      return answer(url);
    }) as typeof fetch,
  });
  return { rdw: new RdwClient(fetcher), urls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const param = (url: URL, name: string) => url.searchParams.get(`$${name}`);

describe("SoQL building", () => {
  it("quotes strings and lists", () => {
    expect(soqlString("L'AUTO")).toBe("'L''AUTO'");
    expect(soqlIn("merk", ["VW", "VOLKSWAGEN"])).toBe("merk in('VW','VOLKSWAGEN')");
    expect(soqlDate(new Date("2024-11-21T15:00:00Z"))).toBe("'2024-11-21T00:00:00'");
  });

  it("builds a resource URL with $ parameters", () => {
    const url = new URL(soqlUrl("a34c-vvps", { select: "kenteken", where: "kenteken in('AB12CD')", limit: 5 }));
    expect(url.origin + url.pathname).toBe("https://opendata.rdw.nl/resource/a34c-vvps.json");
    expect(param(url, "where")).toBe("kenteken in('AB12CD')");
    expect(param(url, "limit")).toBe("5");
  });
});

describe("RdwClient", () => {
  it("counts trade names of passenger cars of a make", async () => {
    const { rdw, urls } = client(() =>
      json([
        { handelsbenaming: "GOLF", n: "51234" },
        { handelsbenaming: " GOLF VARIANT ", n: "9000" },
        { n: "12" },
      ]),
    );
    expect(await rdw.tradeNames(["VOLKSWAGEN", "VW"])).toEqual([
      { name: "GOLF", cars: 51234 },
      { name: "GOLF VARIANT", cars: 9000 },
    ]);
    expect(param(urls[0], "where")).toBe("voertuigsoort='Personenauto' AND merk in('VOLKSWAGEN','VW')");
    expect(param(urls[0], "group")).toBe("handelsbenaming");
  });

  it("reads defects of plates since a date", async () => {
    const { rdw, urls } = client(() =>
      json([
        { kenteken: "AB12CD", gebrek_identificatie: "RA2 " },
        { kenteken: "AB12CD" },
      ]),
    );
    expect(await rdw.defectsOf(["AB12CD", "XY99ZZ"], new Date("2024-11-21T00:00:00Z"))).toEqual([{ plate: "AB12CD", code: "RA2" }]);
    expect(param(urls[0], "where")).toBe("kenteken in('AB12CD','XY99ZZ') AND meld_datum_door_keuringsinstantie_dt >= '2024-11-21T00:00:00'");
  });

  it("asks nothing for no plates", async () => {
    const { rdw, urls } = client(() => json([]));
    expect(await rdw.defectsOf([], new Date())).toEqual([]);
    expect(urls).toHaveLength(0);
  });

  it("keeps one name per defect code", async () => {
    const { rdw } = client(() =>
      json([
        { gebrek_identificatie: "AC1", gebrek_omschrijving: "Remschijf versleten" },
        { gebrek_identificatie: "AC1", gebrek_omschrijving: "Remschijf versleten (oud)" },
        { gebrek_identificatie: "AC2" },
      ]),
    );
    expect(await rdw.defectCodes()).toEqual([{ code: "AC1", description: "Remschijf versleten" }]);
  });

  it("passes on RDW's explanation of a refused query", async () => {
    const { rdw } = client(() => json({ message: "No such column: datum_x", errorCode: "query.soql.no-such-column" }, 400));
    const error = await rdw.countVehicles("datum_x > 1").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RdwQueryError);
    expect((error as RdwQueryError).message).toContain("No such column: datum_x");
  });

  it("refuses an answer that is not a list", async () => {
    const { rdw } = client(() => json({ error: true }));
    await expect(rdw.countVehicles("1=1")).rejects.toThrow(/no list/);
  });
});
