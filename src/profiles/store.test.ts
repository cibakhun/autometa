import { describe, expect, it } from "vitest";
import { deviceLabel, formatLinkCode, newLinkCode, newToken, normalizeLinkCode } from "./store";

describe("link codes", () => {
  it("are 8 characters that cannot be mixed up", () => {
    for (let i = 0; i < 50; i++) expect(newLinkCode()).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });

  it("accept what people type: lower case, spaces, the dash", () => {
    expect(normalizeLinkCode("k7qm-4zpa")).toBe("K7QM4ZPA");
    expect(normalizeLinkCode(" K7QM 4ZPA ")).toBe("K7QM4ZPA");
    expect(formatLinkCode("K7QM4ZPA")).toBe("K7QM-4ZPA");
  });

  it("reject what cannot be a code", () => {
    expect(normalizeLinkCode("K7QM4ZP")).toBeNull();
    expect(normalizeLinkCode("K7QM4ZPO")).toBeNull(); // O is not used
    expect(normalizeLinkCode("")).toBeNull();
  });
});

describe("tokens", () => {
  it("are 32 random bytes, base64url", () => {
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(newToken());
  });
});

describe("deviceLabel", () => {
  it("names browser and system only", () => {
    expect(
      deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"),
    ).toBe("Chrome auf Android");
    expect(
      deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"),
    ).toBe("Safari auf iPhone");
    expect(
      deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"),
    ).toBe("Edge auf Windows");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0")).toBe("Firefox auf Windows");
    expect(deviceLabel(null)).toBe("Unbekanntes Gerät");
  });
});
