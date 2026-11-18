/**
 * robots.txt parsing and matching following RFC 9309:
 * - a crawler obeys the group whose user-agent line matches its product token
 *   (case-insensitive), otherwise the "*" group; groups for the same agent are merged;
 * - the longest matching Allow/Disallow pattern wins, Allow wins a tie;
 * - "*" matches any run of characters and a trailing "$" anchors the end;
 * - percent-encoded unreserved characters are decoded before comparing, reserved ones are not.
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
}

export interface RobotsPolicy {
  /** True when the path (including its query string) may be fetched. */
  isAllowed(pathWithQuery: string): boolean;
  /** Crawl-delay of the matching group, if the site sets one. */
  crawlDelaySeconds: number | null;
}

export function parseRobotsTxt(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySeconds: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    // Other records, such as Sitemap, belong to no group and must not split one (RFC 9309).
    if (key !== "allow" && key !== "disallow" && key !== "crawl-delay") continue;
    lastWasAgent = false;
    if (!current) continue;
    if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelaySeconds = seconds;
    } else if (value) {
      // An empty Disallow means "allow everything" and adds no rule.
      current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  return groups;
}

const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

/**
 * Brings a path or pattern into the form RFC 9309 compares: non-ASCII characters
 * percent-encoded, percent-encoded unreserved characters decoded, other escapes upper-case.
 */
export function normalizePath(value: string): string {
  return value
    .replace(/[^\x00-\x7f]/gu, (char) => encodeURIComponent(char))
    .replace(/%[0-9a-f]{2}/gi, (escape) => {
      const char = String.fromCharCode(parseInt(escape.slice(1), 16));
      return UNRESERVED.test(char) ? char : escape.toUpperCase();
    });
}

interface CompiledPattern {
  /** The literal pieces between the "*" wildcards. */
  segments: string[];
  /** The pattern ended in "$", so the last piece must end the path. */
  anchored: boolean;
}

function compile(pattern: string): CompiledPattern {
  const anchored = pattern.endsWith("$");
  return { segments: (anchored ? pattern.slice(0, -1) : pattern).split("*"), anchored };
}

/**
 * Wildcard match without backtracking: the first piece must start the path and every later
 * piece is taken at its earliest position, which leaves the most room for the rest. Runs in
 * O(path × pattern), so a hostile robots.txt cannot stall the run the way a regex could.
 */
function matches({ segments, anchored }: CompiledPattern, path: string): boolean {
  const [first, ...rest] = segments;
  if (!path.startsWith(first)) return false;
  if (rest.length === 0) return !anchored || path.length === first.length;

  let position = first.length;
  const last = rest.pop()!;
  for (const segment of rest) {
    const found = path.indexOf(segment, position);
    if (found === -1) return false;
    position = found + segment.length;
  }
  if (anchored) return path.length - last.length >= position && path.endsWith(last);
  return path.indexOf(last, position) !== -1;
}

/** Picks the groups that apply to `userAgent` and merges them into one policy. */
export function policyFor(groups: RobotsGroup[], userAgent: string): RobotsPolicy {
  // The product token: "AutoMetaBot/0.1 (+https://…)" and "AutoMetaBot (+https://…)" -> "autometabot".
  const token = userAgent.trim().split(/[\s/]/)[0].toLowerCase();
  let selected = groups.filter((g) => g.agents.some((a) => a !== "*" && a === token));
  if (selected.length === 0) selected = groups.filter((g) => g.agents.includes("*"));

  const rules = selected
    .flatMap((g) => g.rules)
    .map((rule) => {
      const pattern = normalizePath(rule.pattern);
      return { allow: rule.allow, length: pattern.length, compiled: compile(pattern) };
    });
  const delays = selected.map((g) => g.crawlDelaySeconds).filter((d): d is number => d !== null);

  return {
    crawlDelaySeconds: delays.length > 0 ? Math.max(...delays) : null,
    isAllowed(pathWithQuery: string) {
      // A literal "*" or "$" in the path is compared in encoded form, so that a rule can match
      // it by writing %2A or %24 (RFC 9309, 2.2.3), while "*" and "$" in rules stay operators.
      const path = normalizePath(pathWithQuery || "/").replace(/\*/g, "%2A").replace(/\$/g, "%24");
      let best: { allow: boolean; length: number } | null = null;
      for (const rule of rules) {
        if (!matches(rule.compiled, path)) continue;
        if (!best || rule.length > best.length || (rule.length === best.length && rule.allow && !best.allow)) {
          best = { allow: rule.allow, length: rule.length };
        }
      }
      return best ? best.allow : true;
    },
  };
}

export const ALLOW_ALL: RobotsPolicy = { isAllowed: () => true, crawlDelaySeconds: null };
export const DISALLOW_ALL: RobotsPolicy = { isAllowed: () => false, crawlDelaySeconds: null };
