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
    (key) => {
      const concept = CATEGORY_CONCEPTS[key];
      expect(concept).toBeDefined();
      expect(registered.has(concept as object)).toBe(true);
      expect(settingsCategoryConcept(key, "operations")).toBe(concept);
    },
  );

  it("maps only categories that carry a label", () => {
    expect(Object.keys(CATEGORY_CONCEPTS).sort()).toEqual(
      Object.keys(categoryLabels).sort(),
    );
  });

  it("gives an unknown category the concept of its tab", () => {
    expect(settingsCategoryConcept("neu-im-backend", "meals")).toBe(
      settingsTabConcept("meals"),
    );
    expect(settingsCategoryConcept("neu-im-backend", "meals")).toBe(
      MOTO_CONCEPTS.mealPlan,
    );
  });
});
