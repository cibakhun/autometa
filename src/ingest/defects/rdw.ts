import { HttpStatusError, type PoliteFetcher } from "../http/fetcher";

/**
 * Read access to the open data of the Dutch vehicle authority RDW (opendata.rdw.nl, CC0) through
 * its official Socrata API. Every call is one SoQL query that returns only what we need:
 * counts, number plates of a sample, or the defects of those plates. Nothing is crawled.
 */

export const RDW_BASE = "https://opendata.rdw.nl/resource";

export const RDW_DATASETS = {
  /** Gekentekende voertuigen: every vehicle with a Dutch number plate (make, trade name, dates). */
  vehicles: "m9d7-ebf2",
  /** Geconstateerde gebreken: every defect found at a periodic inspection, per plate. */
  defects: "a34c-vvps",
  /** Gebreken: the list of defect codes with their Dutch names. */
  defectCodes: "hx2c-gt7k",
} as const;

/** A SoQL string literal. */
export const soqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;
export const soqlIn = (column: string, values: readonly string[]) => `${column} in(${values.map(soqlString).join(",")})`;
/** A floating timestamp literal for a UTC date: '2026-11-21T00:00:00'. */
export const soqlDate = (date: Date) => soqlString(`${date.toISOString().slice(0, 10)}T00:00:00`);

/** The URL of a SoQL query; parameter names without the leading "$". */
export function soqlUrl(dataset: string, params: Record<string, string | number>): string {
  const query = Object.entries(params)
    .map(([name, value]) => `$${name}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${RDW_BASE}/${dataset}.json?${query}`;
}

/** RDW refused a query, with its own explanation (e.g. an unknown column). */
export class RdwQueryError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`RDW answered ${status}: ${detail || "no details"} (${url})`);
    this.name = "RdwQueryError";
  }
}

/** Passenger cars only (no vans, motorbikes or trailers). */
export const PASSENGER_CARS = "voertuigsoort='Personenauto'";

export class RdwClient {
  constructor(private readonly fetcher: PoliteFetcher) {}

  get requestsMade(): number {
    return this.fetcher.requestsMade;
  }

  get requestsLeft(): number {
    return this.fetcher.requestsLeft;
  }

  async query<T extends Record<string, unknown>>(dataset: string, params: Record<string, string | number>): Promise<T[]> {
    const url = soqlUrl(dataset, params);
    let text: string;
    try {
      text = (await this.fetcher.getText(url)).text;
    } catch (error) {
      if (error instanceof HttpStatusError) throw new RdwQueryError(url, error.status, socrataMessage(error.body));
      throw error;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`RDW sent no JSON for ${url}: ${text.slice(0, 200)}`);
    }
    if (!Array.isArray(data)) throw new Error(`RDW sent no list for ${url}: ${text.slice(0, 200)}`);
    return data as T[];
  }

  /** The defect list: code and Dutch name. A code with several versions comes once. */
  async defectCodes(): Promise<{ code: string; description: string }[]> {
    const rows = await this.query<{ gebrek_identificatie?: string; gebrek_omschrijving?: string }>(RDW_DATASETS.defectCodes, {
      select: "gebrek_identificatie,gebrek_omschrijving",
      order: "gebrek_identificatie",
      limit: 50_000,
    });
    const codes = new Map<string, string>();
    for (const row of rows) {
      const code = row.gebrek_identificatie?.trim();
      const description = row.gebrek_omschrijving?.trim();
      if (code && description && !codes.has(code)) codes.set(code, description);
    }
    return [...codes].map(([code, description]) => ({ code, description }));
  }

  /** Trade names (handelsbenaming) of passenger cars of these makes, with how many cars carry each. */
  async tradeNames(makes: readonly string[]): Promise<{ name: string; cars: number }[]> {
    const rows = await this.query<{ handelsbenaming?: string; n?: string }>(RDW_DATASETS.vehicles, {
      select: "handelsbenaming,count(*) AS n",
      where: `${PASSENGER_CARS} AND ${soqlIn("merk", makes)}`,
      group: "handelsbenaming",
      order: "count(*) DESC",
      limit: 2000,
    });
    return rows
      .filter((row) => row.handelsbenaming && row.handelsbenaming.trim())
      .map((row) => ({ name: row.handelsbenaming!.trim(), cars: Number(row.n ?? 0) }));
  }

  /** How many vehicles match a SoQL condition. */
  async countVehicles(where: string): Promise<number> {
    const rows = await this.query<{ n?: string }>(RDW_DATASETS.vehicles, { select: "count(*) AS n", where });
    return Number(rows[0]?.n ?? 0);
  }

  /** Number plates of matching vehicles, a slice in plate order. */
  async vehiclePlates(where: string, limit: number, offset: number): Promise<string[]> {
    const rows = await this.query<{ kenteken?: string }>(RDW_DATASETS.vehicles, {
      select: "kenteken",
      where,
      order: "kenteken",
      limit,
      offset,
    });
    return rows.map((row) => row.kenteken ?? "").filter(Boolean);
  }

  /** Defects found on these plates since a date: one row per plate and defect code. */
  async defectsOf(plates: readonly string[], since: Date): Promise<{ plate: string; code: string }[]> {
    if (plates.length === 0) return [];
    const rows = await this.query<{ kenteken?: string; gebrek_identificatie?: string }>(RDW_DATASETS.defects, {
      select: "kenteken,gebrek_identificatie",
      where: `${soqlIn("kenteken", plates)} AND meld_datum_door_keuringsinstantie_dt >= ${soqlDate(since)}`,
      limit: 50_000,
    });
    return rows
      .filter((row) => row.kenteken && row.gebrek_identificatie)
      .map((row) => ({ plate: row.kenteken!, code: row.gebrek_identificatie!.trim() }));
  }
}

/** Socrata explains a refused query in a JSON body ({"message": ...}); else the start of the text. */
function socrataMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; errorCode?: unknown };
    if (typeof parsed.message === "string") return parsed.message.slice(0, 300);
  } catch {
    // not JSON
  }
  return body.replace(/\s+/g, " ").trim().slice(0, 300);
}
