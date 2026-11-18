import { describe, expect, it } from "vitest";
import { isProbeAllowed, scriptUrls } from "./probe";

describe("test fetches by hand", () => {
  it("only go to the known portals over https", () => {
    const allowed = (url: string) => isProbeAllowed(new URL(url));
    expect(allowed("https://www.quoka.de/anzeigen/auto-motorrad/automarkt/")).toBe(true);
    expect(allowed("https://suche.pkw.de/fahrzeuge")).toBe(true);
    expect(allowed("https://pkw.de/")).toBe(true);
    expect(allowed("https://www.autohero.com/de/search/")).toBe(true);
    expect(allowed("http://www.quoka.de/")).toBe(false);
    expect(allowed("https://suchen.mobile.de/fahrzeuge/search.html")).toBe(false);
    expect(allowed("https://quoka.de.evil.example/")).toBe(false);
    expect(allowed("https://notpkw.de/")).toBe(false);
    expect(allowed("https://user:pw@www.quoka.de/")).toBe(false);
    expect(allowed("https://www.quoka.de:8443/")).toBe(false);
  });

  it("find a page's external scripts", () => {
    const html = `
      <script src="/_next/static/chunks/main.js"></script>
      <script async src='https://static.pkw.de/app.js?v=1&amp;x=2'></script>
      <script type="application/json">{"src": "not-a-script"}</script>
      <script src="/_next/static/chunks/main.js"></script>`;
    expect(scriptUrls(html, "https://suche.pkw.de/fahrzeuge")).toEqual([
      "https://suche.pkw.de/_next/static/chunks/main.js",
      "https://static.pkw.de/app.js?v=1&x=2",
    ]);
  });
});
