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
  constructor(readonly url: string) {
    super(`robots.txt disallows ${url}`);
    this.name = "DisallowedError";
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
  /** Retries for network errors and 5xx answers (never for blocks). */
  maxRetries?: number;
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

/** Text that bot-protection and captcha pages contain. Checked on every page. */
const CHALLENGE_MARKERS: [RegExp, string][] = [
  [/captcha/i, "captcha"],
  [/cf-chl|challenge-platform|cf-turnstile/i, "Cloudflare challenge"],
  [/_Incapsula_Resource|incapsula/i, "Imperva challenge"],
  [/px-captcha|perimeterx/i, "PerimeterX challenge"],
  [/<title>\s*Access Denied\s*<\/title>/i, "access denied page"],
  [/kein Roboter|not a robot|are you a human/i, "human check"],
];

const LOGIN_PATH = /\/(login|signin|sign-in|anmelden|einloggen)(\/|\.|\?|$)/i;

export class PoliteFetcher {
  readonly userAgent: string;
  readonly respectRobots: boolean;
  private readonly minDelayMs: number;
  private readonly jitterRatio: number;
  private readonly maxRequests: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly robots = new Map<string, Promise<RobotsPolicy>>();
  private readonly nextSlot = new Map<string, number>();
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
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  get requestsMade(): number {
    return this.requestCount;
  }

  /** Fetches a page as text, or throws BlockedError / DisallowedError / BudgetExceededError. */
  async getText(url: string): Promise<FetchedPage> {
    const target = new URL(url);
    if (this.respectRobots) {
      const policy = await this.policyFor(target);
      if (!policy.isAllowed(target.pathname + target.search)) throw new DisallowedError(url);
    }

    let attempt = 0;
    for (;;) {
      const page = await this.request(target.href, target.host);
      if (page.status >= 500 && attempt < this.maxRetries) {
        attempt += 1;
        await this.sleep(this.minDelayMs * 2 ** attempt);
        continue;
      }
      this.assertNotBlocked(page);
      if (page.status >= 400) throw new Error(`HTTP ${page.status} for ${page.url}`);
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

  private async loadPolicy(origin: string, host: string): Promise<RobotsPolicy> {
    let page: FetchedPage;
    try {
      page = await this.request(`${origin}/robots.txt`, host);
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      return DISALLOW_ALL; // unreachable: assume nothing is allowed
    }
    if (page.status === 429 || page.status >= 500) return DISALLOW_ALL;
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

  private async request(url: string, host: string): Promise<FetchedPage> {
    if (this.requestCount >= this.maxRequests) throw new BudgetExceededError(this.maxRequests);
    const wait = (this.nextSlot.get(host) ?? 0) - this.now();
    if (wait > 0) await this.sleep(wait);

    this.requestCount += 1;
    const delay = Math.max(this.minDelayMs, this.hostDelays.get(host) ?? 0);
    try {
      const response = await this.fetchImpl(url, {
        headers: { "user-agent": this.userAgent, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8" },
        redirect: "follow",
      });
      return { url: response.url || url, status: response.status, text: await response.text() };
    } finally {
      this.nextSlot.set(host, this.now() + delay * (1 + this.jitterRatio * this.random()));
    }
  }

  private assertNotBlocked(page: FetchedPage): void {
    const reason = BLOCK_STATUSES.get(page.status);
    if (reason) throw new BlockedError(page.url, reason);
    if (LOGIN_PATH.test(new URL(page.url).pathname)) throw new BlockedError(page.url, "redirected to a login page");
    // Real pages can mention these words in passing; challenge pages are short and lead with them.
    const head = page.text.slice(0, 20_000);
    for (const [pattern, label] of CHALLENGE_MARKERS) {
      if (pattern.test(head) && (page.status !== 200 || page.text.length < 50_000)) {
        throw new BlockedError(page.url, label);
      }
    }
  }
}
