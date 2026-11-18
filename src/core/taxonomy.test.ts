import { describe, expect, it } from "vitest";
import { normalizeText, resolveMakeModel } from "./normalize";
import { MAKES } from "./taxonomy";

describe("taxonomy", () => {
  it("has unique make slugs and unique model slugs per make", () => {
    const makeSlugs = MAKES.map((make) => make.slug);
    expect(new Set(makeSlugs).size).toBe(makeSlugs.length);
    for (const make of MAKES) {
      const modelSlugs = make.models.map((model) => model.slug);
      expect(new Set(modelSlugs).size, make.slug).toBe(modelSlugs.length);
    }
  });

  it("uses URL-safe slugs and normalized aliases", () => {
    for (const make of MAKES) {
      expect(make.slug).toMatch(/^[a-z0-9-]+$/);
      for (const alias of make.aliases ?? []) expect(normalizeText(alias), `${make.slug}: ${alias}`).toBe(alias);
      for (const model of make.models) {
        expect(model.slug, `${make.slug}`).toMatch(/^[a-z0-9-]+$/);
        for (const alias of model.aliases ?? []) expect(normalizeText(alias), `${make.slug}/${model.slug}: ${alias}`).toBe(alias);
      }
    }
  });

  it("resolves every model by its own name", () => {
    for (const make of MAKES) {
      for (const model of make.models) {
        expect(resolveMakeModel(make.name, model.name).modelSlug, `${make.name} ${model.name}`).toBe(model.slug);
      }
    }
  });
});
