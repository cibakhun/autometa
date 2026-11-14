import { describe, expect, it } from "vitest";
import { createDemoAdapter } from "./demo";

async function collect(count: number) {
  const adapter = createDemoAdapter({ count, seed: 7 });
  const raws = [];
  for await (const raw of adapter.fetch()) raws.push(raw);
  return { adapter, raws };
}

describe("demo adapter", () => {
  it("is deterministic", async () => {
    const a = await collect(20);
    const b = await collect(20);
    expect(a.raws).toEqual(b.raws);
  });

  it("normalizes every generated listing onto the taxonomy", async () => {
    const { adapter, raws } = await collect(500);
    const listings = raws.map((raw) => adapter.normalize(raw));
    for (const listing of listings) {
      expect(listing).not.toBeNull();
      expect(listing!.makeSlug).not.toBeNull();
      expect(listing!.modelSlug).not.toBeNull();
      expect(listing!.priceEur).toBeGreaterThan(0);
      expect(listing!.fuel).not.toBeNull();
      expect(listing!.firstRegistration).toMatch(/^\d{4}-\d{2}-01$/);
      if (listing!.sellerType === "private") expect(listing!.sellerName).toBeNull();
    }
  });
});
