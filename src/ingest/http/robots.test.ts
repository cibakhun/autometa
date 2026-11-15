import { describe, expect, it } from "vitest";
import { parseRobotsTxt, policyFor } from "./robots";

const UA = "AutoMetaBot/0.1";

describe("robots.txt", () => {
  it("applies the * group with longest-match and Allow on ties", () => {
    // Excerpt of suchen.mobile.de/robots.txt as of 2026-11-14.
    const policy = policyFor(
      parseRobotsTxt(`
User-agent: Twitterbot
Allow: /

User-agent: *
Disallow: /fahrzeuge/search.html
Disallow: /fahrzeuge/details.html
Allow: /fahrzeuge/details.html?id=*&vip=1$
Disallow: /fahrzeuge/details.html?id=*&*&vip=1
`),
      UA,
    );
    expect(policy.isAllowed("/fahrzeuge/search.html?ms=1900")).toBe(false);
    expect(policy.isAllowed("/fahrzeuge/details.html?id=123")).toBe(false);
    expect(policy.isAllowed("/fahrzeuge/details.html?id=123&vip=1")).toBe(true);
    expect(policy.isAllowed("/fahrzeuge/details.html?id=123&lang=en&vip=1")).toBe(false);
    expect(policy.isAllowed("/")).toBe(true);
  });

  it("blocks query strings but not plain paths when the rule ends in ?", () => {
    // Excerpt of www.autoscout24.de/robots.txt as of 2026-11-14.
    const policy = policyFor(parseRobotsTxt("User-agent: *\nDisallow: /lst?\nDisallow: /lst/?\nDisallow: /angebote/\n"), UA);
    expect(policy.isAllowed("/lst/volkswagen/golf")).toBe(true);
    expect(policy.isAllowed("/lst/volkswagen/golf?page=2")).toBe(true);
    expect(policy.isAllowed("/lst?atype=C")).toBe(false);
    expect(policy.isAllowed("/lst/?atype=C")).toBe(false);
    expect(policy.isAllowed("/angebote/vw-golf-123")).toBe(false);
  });

  it("matches wildcards inside paths", () => {
    // Excerpt of www.kleinanzeigen.de/robots.txt as of 2026-11-14.
    const policy = policyFor(parseRobotsTxt("User-agent: *\nDisallow: /*/seite:6*\nDisallow: /*autos.km_i*\nDisallow: /*.json\n"), UA);
    expect(policy.isAllowed("/s-autos/seite:5/c216")).toBe(true);
    expect(policy.isAllowed("/s-autos/seite:6/c216")).toBe(false);
    expect(policy.isAllowed("/s-autos/c216+autos.km_i:,50000")).toBe(false);
    expect(policy.isAllowed("/data/x.json")).toBe(false);
  });

  it("prefers a group naming our bot and merges repeated groups", () => {
    const groups = parseRobotsTxt(`
User-agent: *
Disallow: /

User-agent: AutoMetaBot
Disallow: /private

user-agent: autometabot
Crawl-delay: 10
`);
    const policy = policyFor(groups, UA);
    expect(policy.isAllowed("/s-autos/c216")).toBe(true);
    expect(policy.isAllowed("/private/x")).toBe(false);
    expect(policy.crawlDelaySeconds).toBe(10);
  });

  it("treats an empty Disallow as allow-all and ignores comments", () => {
    const policy = policyFor(parseRobotsTxt("# hi\nUser-agent: * # everyone\nDisallow:\n"), UA);
    expect(policy.isAllowed("/anything")).toBe(true);
  });

  it("shares rules between agents listed together", () => {
    const groups = parseRobotsTxt("User-agent: a\nUser-agent: *\nDisallow: /x\n");
    expect(policyFor(groups, UA).isAllowed("/x")).toBe(false);
  });

  it("keeps agents in one group when a Sitemap line sits between them", () => {
    const groups = parseRobotsTxt("User-agent: AutoMetaBot\nSitemap: https://a.example/sitemap.xml\nUser-agent: *\nDisallow: /\n");
    expect(policyFor(groups, UA).isAllowed("/x")).toBe(false);
  });

  it("compares percent-encoded unreserved characters as their plain form", () => {
    const policy = policyFor(parseRobotsTxt("User-agent: *\nDisallow: /private\nDisallow: /%7Euser\nDisallow: /a%2fb\n"), UA);
    expect(policy.isAllowed("/%70rivate/1")).toBe(false);
    expect(policy.isAllowed("/~user")).toBe(false);
    // An encoded slash is a different path from a real one.
    expect(policy.isAllowed("/a/b")).toBe(true);
    expect(policy.isAllowed("/a%2Fb")).toBe(false);
  });

  it("matches a literal * or $ in the path through %2A and %24 in the rule", () => {
    // RFC 9309, section 2.2.3.
    const policy = policyFor(parseRobotsTxt("User-agent: *\nDisallow: /file-with-a-%2A.html\nDisallow: /foo-%24\n"), UA);
    expect(policy.isAllowed("/file-with-a-*.html")).toBe(false);
    expect(policy.isAllowed("/file-with-a-x.html")).toBe(true);
    expect(policy.isAllowed("/foo-$")).toBe(false);
    expect(policy.isAllowed("/foo-")).toBe(true);
  });

  it("matches non-ASCII rules against the encoded path", () => {
    const policy = policyFor(parseRobotsTxt("User-agent: *\nDisallow: /gebrauchtwagen/köln\n"), UA);
    expect(policy.isAllowed(new URL("https://a.example/gebrauchtwagen/köln/1").pathname)).toBe(false);
  });

  it("matches many wildcards against a long path quickly", () => {
    const policy = policyFor(parseRobotsTxt(`User-agent: *\nDisallow: /${"*a".repeat(12)}*b\nDisallow: /*.pdf$\n`), UA);
    const started = performance.now();
    expect(policy.isAllowed(`/${"a".repeat(5000)}`)).toBe(true);
    expect(policy.isAllowed(`/${"a".repeat(5000)}b`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
    expect(policy.isAllowed("/x/file.pdf")).toBe(false);
    expect(policy.isAllowed("/x/file.pdf?download=1")).toBe(true);
  });
});
