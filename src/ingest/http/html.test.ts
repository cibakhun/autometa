import { describe, expect, it } from "vitest";
import { decodeEntities, textOf } from "./html";

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("M&uuml;nchen &amp; K&#246;ln &#x2013; 5&nbsp;&euro;")).toBe("München & Köln – 5 €");
  });

  it("leaves unknown or broken entities alone", () => {
    expect(decodeEntities("&foo; &#0; &#xZZ;")).toBe("&foo; &#0; &#xZZ;");
  });
});

describe("textOf", () => {
  it("removes tags and collapses whitespace", () => {
    expect(textOf('<a href="/x">VW <b>Golf</b>\n  7</a>')).toBe("VW Golf 7");
  });
});
