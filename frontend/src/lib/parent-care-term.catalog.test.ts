import { describe, expect, it, vi } from "vitest";
import de from "~/i18n/messages/de.generated";
import en from "~/i18n/messages/en.generated";
import pl from "~/i18n/messages/pl.generated";
import ru from "~/i18n/messages/ru.generated";
import sq from "~/i18n/messages/sq.generated";
import tr from "~/i18n/messages/tr.generated";
import uk from "~/i18n/messages/uk.generated";
import {
  CARE_TERM_PLACEHOLDERS,
  careTermValuesOf,
} from "~/lib/care-facility-term-value";

// The parents portal names the school's care through `{careTerm}` in every
// language (#6082), like the enrollment flow (#6042): no fixed „OGS“ is left,
// and every language carries the placeholder wherever German does, so
// switching the language keeps „GTS“. The login page knows no school and
// speaks of the care without a name.
const LOCALES = { de, en, pl, ru, sq, tr, uk } as const;
const NAMESPACES = [
  "parentCalendar",
  "parentChildCare",
  "parentChildDetail",
  "parentChild",
  "parentEnroll",
  "parentFirstSteps",
  "parentMealPlan",
  "parentDeclarationProof",
  "parentGroupThreads",
  "parentNews",
  "parentMasterData",
  "parentMessages",
  "parentRequestEdit",
  "parentRequestSharing",
  "parentToday",
  "parentVisibility",
  "notificationPreferences",
  "mealAllergens",
  "mealParticipantList",
  "parentPickupPermission",
  "parentStart",
  "mealOrders",
] as const;

// German declines the term with its article (#8136): „{careNomCap} prüft“
// reads „Die GTS prüft“. Every other language keeps the bare `{careTerm}`.
const CARE_PLACEHOLDER = new RegExp(
  `\\{(${CARE_TERM_PLACEHOLDERS.join("|")})\\}`,
);
const GTS = careTermValuesOf("GTS");

function leaves(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe("care facility term in the parents portal catalogs", () => {
  const germanKeys = NAMESPACES.flatMap((namespace) =>
    leaves(de[namespace], namespace)
      .filter(([, text]) => CARE_PLACEHOLDER.test(text))
      .map(([key]) => key),
  );

  it("covers the texts that used to name the OGS", () => {
    expect(germanKeys).toContain("parentToday.atOgs");
    expect(germanKeys).toContain("parentMessages.ogsTeam");
    expect(germanKeys).toContain("parentMasterData.careSchedule.requestSubmit");
    // Unused catalog entries were removed; all remaining care-term keys stay covered.
    expect(germanKeys.length).toBeGreaterThanOrEqual(113);
  });

  it.each(Object.keys(LOCALES))(
    "%s names no OGS on the login page",
    (locale) => {
      const messages = LOCALES[locale as keyof typeof LOCALES];
      for (const [key, text] of leaves(
        messages.parentAuthShell,
        "parentAuthShell",
      )) {
        expect(text, key).not.toMatch(/\bOGS\b/);
      }
    },
  );

  it.each(Object.keys(LOCALES))(
    "%s formats every enrollment text with the school's term",
    async (locale) => {
      const { createTranslator } =
        await vi.importActual<typeof import("next-intl")>("next-intl");
      const messages = LOCALES[locale as keyof typeof LOCALES];
      const translate = createTranslator({
        locale,
        messages: messages as Record<string, unknown>,
        onError: (error) => {
          throw error;
        },
      }) as unknown as (key: string, values: Record<string, unknown>) => string;
      for (const namespace of NAMESPACES) {
        for (const [key, text] of leaves(messages[namespace], namespace)) {
          expect(text, key).not.toMatch(/\bOGS\b/);
          if (!CARE_PLACEHOLDER.test(text)) continue;
          const values: Record<string, unknown> = {};
          for (const [, name] of text.matchAll(/\{(\w+)/g)) {
            if (name) values[name] = 1;
          }
          Object.assign(values, GTS);
          const formatted = translate(key, values);
          expect(formatted, key).toContain("GTS");
          expect(formatted, key).not.toMatch(/\{care[A-Z]/);
        }
      }
      for (const key of germanKeys) {
        const text = leaves(messages, "").find(([k]) => k === key)?.[1];
        // Only German has the declined forms; the name stays in every text.
        if (locale === "de") {
          expect(text, `${locale} ${key}`).toMatch(CARE_PLACEHOLDER);
        } else {
          expect(text, `${locale} ${key}`).toContain("{careTerm}");
        }
      }
    },
  );
});
