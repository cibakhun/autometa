/**
 * robots.txt parsing and matching following RFC 9309:
 * - a crawler obeys the group whose user-agent line matches its product token
 *   (case-insensitive), otherwise the "*" group; groups for the same agent are merged;
 * - the longest matching Allow/Disallow pattern wins, Allow wins a tie;
 * - "*" matches any run of characters and a trailing "$" anchors the end.
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

  for (const rawLine of text.split(/\r?\n/)) {
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
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelaySeconds = seconds;
    }
  }
  return groups;
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Picks the groups that apply to `userAgent` and merges them into one policy. */
export function policyFor(groups: RobotsGroup[], userAgent: string): RobotsPolicy {
  const token = userAgent.split("/")[0].trim().toLowerCase();
  let selected = groups.filter((g) => g.agents.some((a) => a !== "*" && a === token));
  if (selected.length === 0) selected = groups.filter((g) => g.agents.includes("*"));

  const rules = selected.flatMap((g) => g.rules).map((rule) => ({ ...rule, regex: patternToRegExp(rule.pattern) }));
  const delays = selected.map((g) => g.crawlDelaySeconds).filter((d): d is number => d !== null);

  return {
    crawlDelaySeconds: delays.length > 0 ? Math.max(...delays) : null,
    isAllowed(pathWithQuery: string) {
      const path = pathWithQuery || "/";
      let best: { allow: boolean; length: number } | null = null;
      for (const rule of rules) {
        if (!rule.regex.test(path)) continue;
        const length = rule.pattern.length;
        if (!best || length > best.length || (length === best.length && rule.allow && !best.allow)) {
          best = { allow: rule.allow, length };
        }
      }
      return best ? best.allow : true;
    },
  };
}

export const ALLOW_ALL: RobotsPolicy = { isAllowed: () => true, crawlDelaySeconds: null };
export const DISALLOW_ALL: RobotsPolicy = { isAllowed: () => false, crawlDelaySeconds: null };
