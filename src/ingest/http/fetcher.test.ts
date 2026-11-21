import { describe, expect, it } from "vitest";
import { BlockedError, BudgetExceededError, DisallowedError, PoliteFetcher, type PoliteFetcherOptions } from "./fetcher";

type Reply = { status?: number; body?: string; location?: string } | Error;

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
    return new Response(reply.body ?? "", {
      status: reply.status ?? 200,
      headers: reply.location ? { location: reply.location } : {},
    });
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
    // The message names the rule, so a refused run says why.
    await expect(fetcher.getText("https://a.example/privat/2")).rejects.toThrow("(Disallow: /privat)");
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
    await expect(new PoliteFetcher(down.options).getText("https://a.example/x")).rejects.toThrow("(robots.txt answered 503)");
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
    [{ status: 200, body: '<div id="px-captcha"></div>' }, "PerimeterX"],
    [{ status: 503, body: "<html><title>Just a moment...</title></html>" }, "access denied page"],
    [{ status: 302, location: "/login?next=/x" }, "login"],
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
  it("starts no request after its deadline and then ends like at its budget", async () => {
    const site = fakeSite({ "https://a.example/robots.txt": { status: 404 }, "https://a.example/1": { body: page(1) } });
    // Robots.txt at 0, the page at 1,000 ms, the next one would be due at 2,000 ms.
    const fetcher = new PoliteFetcher({ ...site.options, deadline: 1500 });
    await fetcher.getText("https://a.example/1");
    expect(fetcher.requestsLeft).toBeGreaterThan(0);
    const error = await fetcher.getText("https://a.example/1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BudgetExceededError);
    expect((error as BudgetExceededError).reason).toBe("time");
    expect(fetcher.requestsLeft).toBe(0);
    expect(site.calls).toHaveLength(2);
  });

  it("changes its pause on request and measures how long answers take", async () => {
    const site = fakeSite({ "https://a.example/robots.txt": { status: 404 }, "https://a.example/1": { body: page(1) } });
    const fetcher = new PoliteFetcher(site.options);
    expect(fetcher.averageResponseMs).toBeNull();
    await fetcher.getText("https://a.example/1");
    fetcher.setDelay(3000);
    expect(fetcher.delayMs).toBe(3000);
    await fetcher.getText("https://a.example/1");
    await fetcher.getText("https://a.example/1");
    // The pause after a request is read when it ends, so the new one applies from the second gap on.
    expect(site.calls.map((c) => c.at)).toEqual([0, 1000, 2000, 5000]);
    expect(fetcher.averageResponseMs).toBe(0);
  });

  it("retries network errors and treats an unreachable robots.txt as disallow-all", async () => {
    const flaky = fakeSite({
      "https://a.example/robots.txt": { status: 404 },
      "https://a.example/x": [new TypeError("fetch failed"), { body: page(1) }],
    });
    await expect(new PoliteFetcher(flaky.options).getText("https://a.example/x")).resolves.toMatchObject({ status: 200 });
    expect(flaky.calls.filter((c) => c.url === "https://a.example/x")).toHaveLength(2);

    const down = fakeSite({ "https://a.example/robots.txt": new TypeError("fetch failed") });
    const error = await new PoliteFetcher(down.options).getText("https://a.example/x").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DisallowedError);
    expect((error as DisallowedError).reason).toMatch(/^robots.txt unreachable: /);
    expect(down.calls.map((c) => c.url)).toEqual(["https://a.example/robots.txt"]);
  });

  it.each([
    [{ status: 403, body: "Forbidden" }, "access denied"],
    [{ status: 429 }, "rate limited"],
    [{ status: 200, body: "<html><title>Just a moment...</title></html>" }, "access denied page"],
  ])("stops the run when robots.txt itself is blocked (%j)", async (reply, reason) => {
    const site = fakeSite({ "https://a.example/robots.txt": reply, "https://a.example/x": { body: page(1) } });
    const error = await new PoliteFetcher(site.options).getText("https://a.example/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedError);
    expect((error as BlockedError).reason).toContain(reason);
    expect(site.calls.map((c) => c.url)).toEqual(["https://a.example/robots.txt"]);
  });

  it("blocks a long challenge page but not a long page that mentions a captcha", async () => {
    const padded = `<html><head><title>Access Denied</title></head><body>${"x".repeat(80_000)}</body></html>`;
    // The word sits inside the scanned head; only the page length keeps it from counting.
    const mentions = `<html><body>Kontaktformular mit Captcha ${"x".repeat(60_000)}</body></html>`;
    const site = fakeSite({
      "https://a.example/robots.txt": { status: 404 },
      "https://a.example/blocked": { body: padded },
      "https://a.example/ok": { body: mentions },
    });
    const fetcher = new PoliteFetcher(site.options);
    await expect(fetcher.getText("https://a.example/blocked")).rejects.toBeInstanceOf(BlockedError);
    await expect(fetcher.getText("https://a.example/ok")).resolves.toMatchObject({ status: 200 });
  });

  it("spaces concurrent requests to the same host", async () => {
    const site = fakeSite({
      "https://a.example/robots.txt": { status: 404 },
      "https://a.example/1": { body: page(1) },
      "https://a.example/2": { body: page(2) },
      "https://a.example/3": { body: page(3) },
    });
    const fetcher = new PoliteFetcher(site.options);
    await Promise.all([1, 2, 3].map((n) => fetcher.getText(`https://a.example/${n}`)));
    const times = site.calls.map((c) => c.at);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(1000);
  });

  it("never spends more than the budget when requests run concurrently", async () => {
    const site = fakeSite(Object.fromEntries([1, 2, 3, 4].map((n) => [`https://a.example/${n}`, { body: page(n) }])));
    const fetcher = new PoliteFetcher({ ...site.options, respectRobots: false, maxRequests: 2 });
    await fetcher.getText("https://a.example/1");
    // The next three all have to wait for the host's next slot; only one may still go out.
    const results = await Promise.allSettled([2, 3, 4].map((n) => fetcher.getText(`https://a.example/${n}`)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof BudgetExceededError)).toHaveLength(2);
    expect(site.calls).toHaveLength(2);
    expect(fetcher.requestsMade).toBe(2);
  });

  it("follows redirects one paced hop at a time, each counting against the budget", async () => {
    const site = fakeSite({
      "https://a.example/robots.txt": { status: 404 },
      "https://a.example/alt": { status: 301, location: "/neu" },
      "https://a.example/neu": { body: page(1) },
    });
    const fetcher = new PoliteFetcher(site.options);
    await expect(fetcher.getText("https://a.example/alt")).resolves.toMatchObject({ url: "https://a.example/neu", status: 200 });
    expect(fetcher.requestsMade).toBe(3);
    expect(site.calls[2].at - site.calls[1].at).toBeGreaterThanOrEqual(1000);

    const loop = fakeSite({ "https://a.example/a": { status: 302, location: "/a" } });
    const looping = new PoliteFetcher({ ...loop.options, respectRobots: false });
    await expect(looping.getText("https://a.example/a")).rejects.toThrow(/redirects/);
    expect(loop.calls).toHaveLength(6);
  });

  it("checks every redirect target against robots.txt of its host before requesting it", async () => {
    const site = fakeSite({
      "https://a.example/robots.txt": { status: 404 },
      "https://a.example/x": { status: 302, location: "https://b.example/privat/1" },
      "https://b.example/robots.txt": { body: "User-agent: *\nDisallow: /privat" },
    });
    const error = await new PoliteFetcher(site.options).getText("https://a.example/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DisallowedError);
    expect((error as DisallowedError).url).toBe("https://b.example/privat/1");
    expect(site.calls.map((c) => c.url)).not.toContain("https://b.example/privat/1");
  });

  it("stops at a redirect that carries a challenge page instead of following it", async () => {
    const site = fakeSite({
      "https://a.example/robots.txt": { status: 404 },
      "https://a.example/x": { status: 302, location: "/ok", body: "<html><title>Just a moment...</title></html>" },
      "https://a.example/ok": { body: page(1) },
    });
    await expect(new PoliteFetcher(site.options).getText("https://a.example/x")).rejects.toBeInstanceOf(BlockedError);
    expect(site.calls.map((c) => c.url)).not.toContain("https://a.example/ok");
  });

  it("stops on a blocking status even when its body breaks off", async () => {
    const broken = () =>
      new ReadableStream({
        pull(controller) {
          controller.error(new TypeError("terminated"));
        },
      });
    const fetchFor = (blockedUrl: string, calls: string[]) =>
      (async (input: string | URL) => {
        calls.push(String(input));
        if (String(input) === blockedUrl) return new Response(broken(), { status: 429 });
        if (String(input).endsWith("/robots.txt")) return new Response("", { status: 404 });
        return new Response(page(1));
      }) as typeof fetch;
    let clock = 0;
    const base = { now: () => clock, sleep: async (ms: number) => void (clock += ms), minDelayMs: 1000 };

    const pageCalls: string[] = [];
    const onPage = new PoliteFetcher({ ...base, fetchImpl: fetchFor("https://a.example/x", pageCalls) });
    await expect(onPage.getText("https://a.example/x")).rejects.toBeInstanceOf(BlockedError);
    expect(pageCalls.filter((u) => u === "https://a.example/x")).toHaveLength(1);

    const robotsCalls: string[] = [];
    const onRobots = new PoliteFetcher({ ...base, fetchImpl: fetchFor("https://a.example/robots.txt", robotsCalls) });
    await expect(onRobots.getText("https://a.example/x")).rejects.toBeInstanceOf(BlockedError);
    expect(robotsCalls).toEqual(["https://a.example/robots.txt"]);
  });

  it("does not retry a 4xx whose body breaks off", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      calls.push(String(input));
      const broken = new ReadableStream({
        pull(controller) {
          controller.error(new TypeError("terminated"));
        },
      });
      return new Response(broken, { status: 404 });
    }) as typeof fetch;
    let clock = 0;
    const fetcher = new PoliteFetcher({ fetchImpl, now: () => clock, sleep: async (ms) => void (clock += ms) });
    // robots.txt answers 404 too, which RFC 9309 reads as "no robots.txt": the page is then requested.
    await expect(fetcher.getText("https://a.example/x")).rejects.toThrow(/HTTP 404/);
    expect(calls).toEqual(["https://a.example/robots.txt", "https://a.example/x"]);
  });

  it("gives up on a body that never ends and frees the host for the next request", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      calls.push(String(input));
      if (String(input) !== "https://a.example/endless") return new Response(page(1));
      const signal = init!.signal!;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const timer = setInterval(() => controller.enqueue(new TextEncoder().encode("x")), 5);
          signal.addEventListener("abort", () => {
            clearInterval(timer);
            controller.error(signal.reason);
          });
        },
      });
      return new Response(body);
    }) as typeof fetch;
    let clock = 0;
    const fetcher = new PoliteFetcher({
      fetchImpl,
      respectRobots: false,
      timeoutMs: 50,
      maxRetries: 1,
      now: () => clock,
      sleep: async (ms) => void (clock += ms),
    });

    const error = await fetcher.getText("https://a.example/endless").catch((e: unknown) => e);
    expect((error as Error).name).toBe("TimeoutError");
    expect(calls.filter((u) => u === "https://a.example/endless")).toHaveLength(2);
    await expect(fetcher.getText("https://a.example/next")).resolves.toMatchObject({ status: 200 });
  });

  it("keeps waiting when a sleep ends before the host's next slot", async () => {
    const site = fakeSite({
      "https://a.example/robots.txt": { status: 404 },
      "https://a.example/1": { body: page(1) },
      "https://a.example/2": { body: page(2) },
    });
    let clock = 0;
    const fetcher = new PoliteFetcher({
      ...site.options,
      now: () => clock,
      // Wakes after half the requested time, like a timer that fires early.
      sleep: async (ms) => {
        clock += Math.ceil(ms / 2);
      },
      fetchImpl: (async (input: string | URL, init?: RequestInit) => {
        times.push(clock);
        return site.options.fetchImpl!(input, init);
      }) as typeof fetch,
    });
    const times: number[] = [];
    await fetcher.getText("https://a.example/1");
    await fetcher.getText("https://a.example/2");
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(1000);
  });

  it("stops at a redirect to a login page without requesting it", async () => {
    const site = fakeSite({
      "https://a.example/robots.txt": { status: 404 },
      "https://a.example/x": { status: 302, location: "https://a.example/anmelden?ziel=/x" },
    });
    const error = await new PoliteFetcher(site.options).getText("https://a.example/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlockedError);
    expect(site.calls.map((c) => c.url)).toEqual(["https://a.example/robots.txt", "https://a.example/x"]);
  });
});
