import type { Pool } from "pg";
import { readBoolean } from "./http/config";
import { DEFAULT_USER_AGENT, PoliteFetcher } from "./http/fetcher";
import { saveSample } from "./samples";

/**
 * A test fetch by hand from the server (/admin/quellen): fetches one page of a known portal
 * through PoliteFetcher, so robots.txt, pacing and block detection apply exactly as for the
 * import, and stores what came back in scrape_samples. With scripts, it also fetches the page's
 * own JavaScript files, which show where a page that loads its listings later gets them from.
 */

/** Portals a test fetch may go to, with their subdomains. mobile.de stays out on purpose. */
export const PROBE_DOMAINS = ["autoscout24.de", "kleinanzeigen.de", "quoka.de", "autohero.com", "auto.de", "pkw.de"];

const MAX_SCRIPTS = 12;

export function isProbeAllowed(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  if (url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PROBE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** The src of every external script, resolved against the page, without duplicates. */
export function scriptUrls(html: string, base: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi)) {
    try {
      urls.add(new URL(match[2].replace(/&amp;/g, "&"), base).href);
    } catch {
      // not a URL
    }
  }
  return [...urls];
}

export interface ProbeOptions {
  /** Also fetch the page's own scripts (same portal domain only). */
  scripts?: boolean;
  fetcher?: PoliteFetcher;
}

export interface ProbeOutcome {
  url: string;
  sampleId?: number;
  status?: number;
  error?: string;
}

export function createProbeFetcher(): PoliteFetcher {
  return new PoliteFetcher({
    userAgent: process.env.SCRAPE_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    respectRobots: readBoolean("SCRAPE_RESPECT_ROBOTS", true),
    // A handful of requests by hand; one second apart is the floor the import uses as well.
    minDelayMs: 1000,
    maxRequests: 2 + MAX_SCRIPTS * 2,
  });
}

export async function probe(pool: Pool, rawUrl: string, options: ProbeOptions = {}): Promise<ProbeOutcome[]> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return [{ url: rawUrl, error: "not a valid URL" }];
  }
  if (!isProbeAllowed(url)) {
    return [{ url: rawUrl, error: `only https pages of ${PROBE_DOMAINS.join(", ")} may be fetched` }];
  }
  const fetcher = options.fetcher ?? createProbeFetcher();
  const outcomes: ProbeOutcome[] = [];

  const page = await fetchOne(pool, fetcher, url.href, "probe", outcomes);
  if (page && options.scripts) {
    const scripts = scriptUrls(page, url.href).filter((src) => isProbeAllowed(new URL(src))).slice(0, MAX_SCRIPTS);
    for (const src of scripts) await fetchOne(pool, fetcher, src, "probe-script", outcomes);
  }
  return outcomes;
}

async function fetchOne(
  pool: Pool,
  fetcher: PoliteFetcher,
  url: string,
  reason: "probe" | "probe-script",
  outcomes: ProbeOutcome[],
): Promise<string | null> {
  try {
    const page = await fetcher.getText(url);
    const sampleId = await saveSample(pool, { sourceId: null, url: page.url, status: page.status, reason, body: page.text });
    outcomes.push({ url: page.url, sampleId, status: page.status });
    return page.text;
  } catch (error) {
    outcomes.push({ url, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
    return null;
  }
}
