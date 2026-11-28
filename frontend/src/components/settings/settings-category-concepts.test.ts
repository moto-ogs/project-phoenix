import { describe, expect, it } from "vitest";
import { MOTO_CONCEPTS } from "~/lib/moto-concepts";
import {
  CATEGORY_CONCEPTS,
  settingsCategoryConcept,
} from "./settings-category-concepts";
import { categoryLabels } from "./settings-filter";
import { settingsTabConcept } from "./settings-sections";

const registered = new Set<object>(Object.values(MOTO_CONCEPTS));

describe("settingsCategoryConcept", () => {
  it.each(Object.keys(categoryLabels))(
    "gives the category %s a registered concept of its own",
    async (key) => {
      const loader = CATEGORY_CONCEPTS[key];
      expect(loader).toBeDefined();
      const concept = await loader?.();
      expect(registered.has(concept as object)).toBe(true);
      await expect(settingsCategoryConcept(key, "operations")).resolves.toBe(
        concept,
      );
    },
  );

  it("maps only categories that carry a label", () => {
    expect(Object.keys(CATEGORY_CONCEPTS).sort()).toEqual(
      Object.keys(categoryLabels).sort(),
    );
  });

  it("gives an unknown category the concept of its tab", async () => {
    await expect(
      settingsCategoryConcept("neu-im-backend", "meals"),
    ).resolves.toBe(settingsTabConcept("meals"));
    await expect(
      settingsCategoryConcept("neu-im-backend", "meals"),
    ).resolves.toBe(MOTO_CONCEPTS.mealPlan);
  });
});
