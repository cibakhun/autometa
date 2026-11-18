import { describe, expect, it } from "vitest";
import { sliceBody } from "./samples";

describe("reading a stored page", () => {
  const body = `${"a".repeat(1000)}PRICE 12.990 €${"b".repeat(1000)}PRICE 8.500 €${"c".repeat(50)}`;

  it("shows a slice", () => {
    expect(sliceBody(body, { from: 1000, length: 5 })).toBe("PRICE");
    expect(sliceBody("short")).toBe("short");
  });

  it("shows the passages around matches", () => {
    const text = sliceBody(body, { grep: "price \\d", context: 3 });
    expect(text).toContain("2 matches of /price \\d/i, showing 2");
    expect(text).toContain("--- @1000 ---\naaaPRICE 12.9");
    expect(text).toContain("--- @2014 ---\nbbbPRICE 8.50");
  });

  it("merges overlapping passages and caps the number shown", () => {
    expect(sliceBody("x1x2x3", { grep: "\\d", context: 2 })).toBe("3 matches of /\\d/i, showing 1\n\n--- @1 ---\nx1x2");
    expect(sliceBody(body, { grep: "PRICE", context: 0, maxMatches: 1 })).toContain("2 matches of /PRICE/i, showing 1");
  });

  it("reports a broken pattern instead of failing", () => {
    expect(sliceBody(body, { grep: "(" })).toMatch(/^Invalid pattern/);
  });
});
