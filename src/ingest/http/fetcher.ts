import { ALLOW_ALL, DISALLOW_ALL, parseRobotsTxt, policyFor, type RobotsPolicy } from "./robots";

/**
 * The one way scrapers talk to other websites. It identifies itself honestly, waits between
 * requests to the same host, follows robots.txt (unless switched off) and stops the whole run
 * as soon as a site signals that it does not want us: 401/403/429, a captcha or a login wall.
 * It never retries a block, rotates identities or tries to look like a browser.
 */

export const DEFAULT_USER_AGENT = "AutoMetaBot/0.1";

/** The site refused us (block, rate limit, captcha, login). The run must stop. */
export class BlockedError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`Blocked by ${new URL(url).host}: ${reason} (${url})`);
    this.name = "BlockedError";
  }
}

/** robots.txt does not allow this URL for our user agent. */
export class DisallowedError extends Error {
  constructor(
    readonly url: string,
    readonly reason?: string,
  ) {
    super(`robots.txt disallows ${url}${reason ? ` (${reason})` : ""}`);
    this.name = "DisallowedError";
  }
}

/** The site answered with an error status (other than a block). */
export class HttpStatusError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    /** The start of the error page, for APIs that explain what was wrong. */
    readonly body = "",
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpStatusError";
  }
}

/** The per-run request budget is used up. */
export class BudgetExceededError extends Error {
  constructor(readonly maxRequests: number) {
    super(`Request budget of ${maxRequests} used up`);
    this.name = "BudgetExceededError";
  }
}

export interface FetchedPage {
  url: string;
  status: number;
  text: string;
}

export interface PoliteFetcherOptions {
  userAgent?: string;
  /** Minimum pause between two requests to the same host. A larger Crawl-delay wins. */
  minDelayMs?: number;
  /** Extra random pause, as a share of the delay (0.2 = up to 20 % longer). */
  jitterRatio?: number;
  respectRobots?: boolean;
  /** Most requests one run may make, robots.txt included. */
  maxRequests?: number;
  /** Retries for network errors, timeouts and 5xx answers (never for blocks, 4xx or the budget). */
  maxRetries?: number;
  /** Longest time one request may take, body included, before it counts as a network error. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

const BLOCK_STATUSES = new Map([
  [401, "login required (401)"],
  [403, "access denied (403)"],
  [429, "rate limited (429)"],
]);

/**
 * Signatures that only bot-protection interstitials carry. They count on every page, however
 * long, because a site can pad a block page.
 */
const CHALLENGE_SIGNATURES: [RegExp, string][] = [
  [/<title>\s*(Access Denied|Just a moment\.\.\.|Attention Required! \| Cloudflare)\s*<\/title>/i, "access denied page"],
  [/_cf_chl_opt|cf-chl-/i, "Cloudflare challenge"],
  [/_Incapsula_Resource/i, "Imperva challenge"],
  [/px-captcha/i, "PerimeterX challenge"],
];

/**
 * Words a challenge page uses but a real page may mention in passing, for example in a
 * contact form. They count on error answers and on short pages only.
 */
const CHALLENGE_WORDS: [RegExp, string][] = [
  [/captcha|cf-turnstile/i, "captcha"],
  [/kein Roboter|not a robot|are you a human/i, "human check"],
];

/** Redirects are followed by hand, so every hop goes through robots.txt, budget and pacing. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

const LOGIN_PATH = /\/(login|signin|sign-in|anmelden|einloggen)(\/|\.|\?|$)/i;

export class PoliteFetcher {
  readonly userAgent: string;
  readonly respectRobots: boolean;
  private readonly minDelayMs: number;
  private readonly jitterRatio: number;
  private readonly maxRequests: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly robots = new Map<string, Promise<RobotsPolicy>>();
  private readonly nextSlot = new Map<string, number>();
  /** Tail of the request queue per host: requests to one host run one after another. */
  private readonly hostQueues = new Map<string, Promise<void>>();
  /** Crawl-delay per host when robots.txt asks for more than minDelayMs. */
  private readonly hostDelays = new Map<string, number>();
  private requestCount = 0;

  constructor(options: PoliteFetcherOptions = {}) {
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.respectRobots = options.respectRobots ?? true;
    this.minDelayMs = options.minDelayMs ?? 5000;
    this.jitterRatio = options.jitterRatio ?? 0.2;
    this.maxRequests = options.maxRequests ?? 500;
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  get requestsMade(): number {
    return this.requestCount;
  }

  /** Requests this run may still make before BudgetExceededError. */
  get requestsLeft(): number {
    return Math.max(0, this.maxRequests - this.requestCount);
  }

  /** Fetches a page as text, or throws BlockedError / DisallowedError / BudgetExceededError. */
  async getText(url: string): Promise<FetchedPage> {
    const target = new URL(url);
    await this.assertAllowed(target);

    let attempt = 0;
    for (;;) {
      let page: FetchedPage;
      try {
        page = await this.follow(target, true);
      } catch (error) {
        if (!isNetworkError(error) || attempt >= this.maxRetries) throw error;
        attempt += 1;
        await this.sleep(this.minDelayMs * 2 ** attempt);
        continue;
      }
      this.assertNotBlocked(page);
      if (page.status >= 500 && attempt < this.maxRetries) {
        attempt += 1;
        await this.sleep(this.minDelayMs * 2 ** attempt);
        continue;
      }
      if (page.status >= 400) throw new HttpStatusError(page.url, page.status, page.text.slice(0, 500));
      return page;
    }
  }

  /** The robots.txt policy for a host, fetched once per run (RFC 9309 rules for errors). */
  policyFor(target: URL): Promise<RobotsPolicy> {
    const origin = target.origin;
    let policy = this.robots.get(origin);
    if (!policy) {
      policy = this.loadPolicy(origin, target.host);
      this.robots.set(origin, policy);
    }
    return policy;
  }

  private async assertAllowed(target: URL): Promise<void> {
    if (!this.respectRobots) return;
    const policy = await this.policyFor(target);
    const path = target.pathname + target.search;
    if (!policy.isAllowed(path)) throw new DisallowedError(target.href, policy.why?.(path));
  }

  private async loadPolicy(origin: string, host: string): Promise<RobotsPolicy> {
    let page: FetchedPage;
    try {
      page = await this.follow(new URL(`${origin}/robots.txt`), false);
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      // Unreachable: assume nothing is allowed.
      const message = error instanceof Error ? error.message : String(error);
      return { ...DISALLOW_ALL, why: () => `robots.txt unreachable: ${message}` };
    }
    // A site that answers robots.txt with 401, 403, 429, a captcha or a login page does not
    // want bots. RFC 9309 would read 401/403 as "no robots.txt"; our rule is to stop instead.
    this.assertNotBlocked(page);
    if (page.status >= 500) return { ...DISALLOW_ALL, why: () => `robots.txt answered ${page.status}` };
    if (page.status >= 400) return ALLOW_ALL; // no robots.txt: everything is allowed
    const policy = policyFor(parseRobotsTxt(page.text), this.userAgent);
    if (policy.crawlDelaySeconds !== null) {
      // Respect a longer Crawl-delay from now on.
      const delay = policy.crawlDelaySeconds * 1000;
      this.nextSlot.set(host, Math.max(this.nextSlot.get(host) ?? 0, this.now() + delay));
      this.hostDelays.set(host, delay);
    }
    return policy;
  }

  /**
   * Requests a URL and follows up to five redirects by hand. Each hop is its own request with
   * budget and pacing. A hop to a login page stops the run before it is requested, and for
   * pages (not robots.txt) each hop must be allowed by the robots.txt of its host.
   */
  private async follow(start: URL, checkRobots: boolean): Promise<FetchedPage> {
    let current = start;
    for (let hops = 0; ; hops++) {
      const response = await this.dispatch(current);
      if (REDIRECT_STATUSES.has(response.status)) {
        // A challenge can sit on the redirect itself; do not follow it to a normal-looking page.
        this.assertNotBlocked({ url: current.href, status: response.status, text: response.text });
      }
      if (!REDIRECT_STATUSES.has(response.status) || !response.location) {
        return { url: current.href, status: response.status, text: response.text };
      }
      if (hops >= MAX_REDIRECTS) throw new Error(`More than ${MAX_REDIRECTS} redirects from ${start.href}`);
      const next = new URL(response.location, current);
      if (next.protocol !== "https:" && next.protocol !== "http:") {
        throw new Error(`Redirect to unsupported URL ${next.href}`);
      }
      if (LOGIN_PATH.test(next.pathname)) throw new BlockedError(next.href, "redirected to a login page");
      if (checkRobots) await this.assertAllowed(next);
      current = next;
    }
  }

  /**
   * One HTTP request. Requests to the same host wait in line, so two callers can never share
   * a slot. The budget is checked and taken right before sending, with nothing in between.
   */
  private async dispatch(url: URL): Promise<{ status: number; location: string | null; text: string }> {
    const host = url.host;
    const previous = this.hostQueues.get(host) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => (release = resolve));
    this.hostQueues.set(host, previous.then(() => turn));
    await previous;
    try {
      // Re-read the deadline after each wake: a Crawl-delay found meanwhile may have moved it.
      for (let wait = this.waitFor(host); wait > 0; wait = this.waitFor(host)) await this.sleep(wait);
      if (this.requestCount >= this.maxRequests) throw new BudgetExceededError(this.maxRequests);
      this.requestCount += 1;

      try {
        const response = await this.fetchImpl(url.href, {
          headers: { "user-agent": this.userAgent, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8" },
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const location = response.headers.get("location");
        if (BLOCK_STATUSES.has(response.status)) {
          // The status alone stops the run. Skip the body, so a broken one cannot turn it into a retry.
          await response.body?.cancel().catch(() => undefined);
          return { status: response.status, location, text: "" };
        }
        if (response.status >= 400 && response.status < 500) {
          // A 4xx is never retried, so a body that breaks off must not cause a retry either.
          return { status: response.status, location, text: await response.text().catch(() => "") };
        }
        return { status: response.status, location, text: await response.text() };
      } finally {
        // Read the delay now, not before the request: robots.txt may have raised it meanwhile.
        const delay = Math.max(this.minDelayMs, this.hostDelays.get(host) ?? 0);
        const next = this.now() + delay * (1 + this.jitterRatio * this.random());
        this.nextSlot.set(host, Math.max(this.nextSlot.get(host) ?? 0, next));
      }
    } finally {
      release();
    }
  }

  private waitFor(host: string): number {
    return (this.nextSlot.get(host) ?? 0) - this.now();
  }

  private assertNotBlocked(page: FetchedPage): void {
    const reason = BLOCK_STATUSES.get(page.status);
    if (reason) throw new BlockedError(page.url, reason);
    if (LOGIN_PATH.test(new URL(page.url).pathname)) throw new BlockedError(page.url, "login page");
    const head = page.text.slice(0, 20_000);
    for (const [pattern, label] of CHALLENGE_SIGNATURES) {
      if (pattern.test(head)) throw new BlockedError(page.url, label);
    }
    // Real pages can mention these words in passing; challenge pages are short and lead with them.
    if (page.status !== 200 || page.text.length < 50_000) {
      for (const [pattern, label] of CHALLENGE_WORDS) {
        if (pattern.test(head)) throw new BlockedError(page.url, label);
      }
    }
  }
}

/**
 * Errors worth another try: the request got no complete answer (DNS, connection, TLS, reset)
 * or ran past timeoutMs.
 */
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error as { name?: unknown } | null)?.name === "TimeoutError";
}
