import { describe, expect, it } from "vitest";
import { BlockedError, BudgetExceededError, DisallowedError, PoliteFetcher, type PoliteFetcherOptions } from "./fetcher";

type Reply = { status?: number; body?: string; url?: string } | Error;

/** A fake site: answers by URL, records requests and the virtual time they were made at. */
function fakeSite(routes: Record<string, Reply | Reply[]>) {
  let clock = 0;
  const calls: { url: string; at: number; userAgent: string | null }[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, at: clock, userAgent: new Headers(init?.headers).get("user-agent") });
    const route = routes[url];
    const reply = Array.isArray(route) ? (route.length > 1 ? route.shift()! : route[0]) : route;
    if (!reply) return new Response("not found", { status: 404 });
    if (reply instanceof Error) throw reply;
    const response = new Response(reply.body ?? "", { status: reply.status ?? 200 });
    Object.defineProperty(response, "url", { value: reply.url ?? url });
    return response;
  }) as typeof fetch;
  const options: PoliteFetcherOptions = {
    fetchImpl,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    random: () => 0,
    minDelayMs: 1000,
  };
  return { calls, options };
}

const page = (n: number) => `<html><body>${"x".repeat(60_000)} Angebot ${n}</body></html>`;

describe("PoliteFetcher", () => {
  it("identifies itself, reads robots.txt once and spaces requests per host", async () => {
    const site = fakeSite({
      "https://a.example/robots.txt": { body: "User-agent: *\nDisallow: /privat" },
      "https://a.example/s/1": { body: page(1) },
      "https://a.example/s/2": { body: page(2) },
    });
    const fetcher = new PoliteFetcher(site.options);
    await fetcher.getText("https://a.example/s/1");
    await fetcher.getText("https://a.example/s/2");

    expect(site.calls.map((c) => c.url)).toEqual(["https://a.example/robots.txt", "https://a.example/s/1", "https://a.example/s/2"]);
    expect(site.calls.every((c) => c.userAgent === "AutoMetaBot/0.1")).toBe(true);
    expect(site.calls[1].at - site.calls[0].at).toBeGreaterThanOrEqual(1000);
    expect(site.calls[2].at - site.calls[1].at).toBeGreaterThanOrEqual(1000);
  });

  it("refuses URLs that robots.txt disallows without requesting them", async () => {
    const site = fakeSite({ "https://a.example/robots.txt": { body: "User-agent: *\nDisallow: /privat" } });
    const fetcher = new PoliteFetcher(site.options);
    await expect(fetcher.getText("https://a.example/privat/1")).rejects.toBeInstanceOf(DisallowedError);
    expect(site.calls.map((c) => c.url)).toEqual(["https://a.example/robots.txt"]);
  });

  it("skips robots.txt when switched off", async () => {
    const site = fakeSite({ "https://a.example/privat/1": { body: page(1) } });
    const fetcher = new PoliteFetcher({ ...site.options, respectRobots: false });
    await fetcher.getText("https://a.example/privat/1");
    expect(site.calls.map((c) => c.url)).toEqual(["https://a.example/privat/1"]);
  });

  it("follows RFC 9309 when robots.txt is missing or unreachable", async () => {
    const missing = fakeSite({ "https://a.example/robots.txt": { status: 404 }, "https://a.example/x": { body: page(1) } });
    await expect(new PoliteFetcher(missing.options).getText("https://a.example/x")).resolves.toMatchObject({ status: 200 });

    const down = fakeSite({ "https://a.example/robots.txt": { status: 503 } });
    await expect(new PoliteFetcher(down.options).getText("https://a.example/x")).rejects.toBeInstanceOf(DisallowedError);
  });

  it("waits at least the Crawl-delay from robots.txt", async () => {
    const site = fakeSite({
      "https://a.example/robots.txt": { body: "User-agent: *\nCrawl-delay: 7" },
      "https://a.example/1": { body: page(1) },
      "https://a.example/2": { body: page(2) },
    });
    const fetcher = new PoliteFetcher(site.options);
    await fetcher.getText("https://a.example/1");
    await fetcher.getText("https://a.example/2");
    expect(site.calls[2].at - site.calls[1].at).toBeGreaterThanOrEqual(7000);
  });

  it.each([
    [{ status: 403, body: "Forbidden" }, "access denied"],
    [{ status: 429, body: "slow down" }, "rate limited"],
    [{ status: 200, body: "<html><title>Bitte bestätigen</title>Bitte zeigen Sie, dass Sie kein Roboter sind</html>" }, "human check"],
    [{ status: 200, body: '<div id="px-captcha"></div>' }, "captcha"],
    [{ status: 200, body: "<form>", url: "https://a.example/login?next=/x" }, "login"],
  ])("stops on a block (%j) without retrying", async (reply, reason) => {
    const site = fakeSite({ "https://a.example/robots.txt": { status: 404 }, "https://a.example/x": reply });
    const fetcher = new PoliteFetcher(site.options);
    const error = await fetcher.getText("https://a.example/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedError);
    expect((error as BlockedError).reason).toContain(reason);
    expect(site.calls.filter((c) => c.url === "https://a.example/x")).toHaveLength(1);
  });

  it("retries server errors a limited number of times", async () => {
    const site = fakeSite({
      "https://a.example/robots.txt": { status: 404 },
      "https://a.example/x": [{ status: 502 }, { status: 502 }, { body: page(1) }],
    });
    const fetcher = new PoliteFetcher(site.options);
    await expect(fetcher.getText("https://a.example/x")).resolves.toMatchObject({ status: 200 });

    const failing = fakeSite({ "https://a.example/robots.txt": { status: 404 }, "https://a.example/x": { status: 500 } });
    await expect(new PoliteFetcher(failing.options).getText("https://a.example/x")).rejects.toThrow(/HTTP 500/);
    expect(failing.calls.filter((c) => c.url === "https://a.example/x")).toHaveLength(3);
  });

  it("stops when the request budget is used up", async () => {
    const site = fakeSite({ "https://a.example/robots.txt": { status: 404 }, "https://a.example/1": { body: page(1) } });
    const fetcher = new PoliteFetcher({ ...site.options, maxRequests: 2 });
    await fetcher.getText("https://a.example/1");
    await expect(fetcher.getText("https://a.example/1")).rejects.toBeInstanceOf(BudgetExceededError);
    expect(fetcher.requestsMade).toBe(2);
  });
});
