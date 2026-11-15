import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetcherFromEnv, readList } from "./config";

describe("createFetcherFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("respects robots.txt and uses the default identity unless configured", () => {
    for (const name of ["SCRAPE_USER_AGENT", "SCRAPE_RESPECT_ROBOTS", "SCRAPE_MIN_DELAY_MS", "SCRAPE_MAX_REQUESTS"]) {
      vi.stubEnv(name, undefined);
    }
    const fetcher = createFetcherFromEnv();
    expect(fetcher.respectRobots).toBe(true);
    expect(fetcher.userAgent).toBe("AutoMetaBot/0.1");
  });

  it("reads the settings", () => {
    vi.stubEnv("SCRAPE_USER_AGENT", "AutoMetaBot/0.2 (+https://example.org/bot)");
    vi.stubEnv("SCRAPE_RESPECT_ROBOTS", "false");
    const fetcher = createFetcherFromEnv();
    expect(fetcher.userAgent).toBe("AutoMetaBot/0.2 (+https://example.org/bot)");
    expect(fetcher.respectRobots).toBe(false);
  });

  it("rejects delays under one second and unclear switches", () => {
    vi.stubEnv("SCRAPE_MIN_DELAY_MS", "200");
    expect(() => createFetcherFromEnv()).toThrow(/SCRAPE_MIN_DELAY_MS/);
    vi.stubEnv("SCRAPE_MIN_DELAY_MS", undefined);
    vi.stubEnv("SCRAPE_RESPECT_ROBOTS", "vielleicht");
    expect(() => createFetcherFromEnv()).toThrow(/SCRAPE_RESPECT_ROBOTS/);
  });
});

describe("readList", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("splits a comma-separated value and ignores blanks", () => {
    vi.stubEnv("SCRAPE_SOURCES", " autoscout24, ,kleinanzeigen ");
    expect(readList("SCRAPE_SOURCES")).toEqual(["autoscout24", "kleinanzeigen"]);
  });

  it("is undefined when unset or blank", () => {
    vi.stubEnv("SCRAPE_SOURCES", undefined);
    expect(readList("SCRAPE_SOURCES")).toBeUndefined();
    vi.stubEnv("SCRAPE_SOURCES", " , ");
    expect(readList("SCRAPE_SOURCES")).toBeUndefined();
  });
});
