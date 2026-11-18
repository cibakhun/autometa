import { describe, expect, it } from "vitest";
import { adminToken, escapeHtml, isAdminRequest } from "./admin";

const TOKEN = "0123456789abcdef-token";

describe("admin access", () => {
  it("is off without a token of at least 16 characters", () => {
    expect(adminToken(undefined)).toBeNull();
    expect(adminToken("   ")).toBeNull();
    expect(adminToken("short-token")).toBeNull();
    expect(adminToken(` ${TOKEN} `)).toBe(TOKEN);
  });

  it("lets in only the exact token", () => {
    const request = (token: string) => new Request(`https://example.test/admin/quellen?token=${encodeURIComponent(token)}`);
    expect(isAdminRequest(request(TOKEN), TOKEN)).toBe(true);
    expect(isAdminRequest(request(`${TOKEN}x`), TOKEN)).toBe(false);
    expect(isAdminRequest(request(TOKEN.slice(0, -1)), TOKEN)).toBe(false);
    expect(isAdminRequest(new Request("https://example.test/admin/quellen"), TOKEN)).toBe(false);
    expect(isAdminRequest(request(TOKEN), null)).toBe(false);
  });

  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    expect(escapeHtml(null)).toBe("");
  });
});
