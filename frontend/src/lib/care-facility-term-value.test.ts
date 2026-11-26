import { describe, expect, it } from "vitest";
import de from "~/i18n/messages/de.generated";
import en from "~/i18n/messages/en.generated";
import pl from "~/i18n/messages/pl.generated";
import ru from "~/i18n/messages/ru.generated";
import sq from "~/i18n/messages/sq.generated";
import tr from "~/i18n/messages/tr.generated";
import uk from "~/i18n/messages/uk.generated";
import {
  CARE_TERM_PLACEHOLDERS,
  careFacilityName,
  careTermValues,
  careTermValuesOf,
  normalizeCareArticle,
} from "./care-facility-term-value";

// #8136: a school with its own care name chooses the article, and every
// fixed German text declines the name with it.
describe("care term declension", () => {
  it("keeps „die“ for a feminine name, as before the article existed", () => {
    expect(careTermValuesOf("OGS", "die")).toEqual({
      careTerm: "OGS",
      careNom: "die OGS",
      careNomCap: "Die OGS",
      careAcc: "die OGS",
      careAccShort: "OGS",
      careDat: "der OGS",
      careGen: "der OGS",
      careIn: "in der OGS",
      careInCap: "In der OGS",
      careBei: "bei der OGS",
      careVon: "von der OGS",
      careVonCap: "Von der OGS",
      careYourNom: "deine OGS",
      careYourNomCap: "Deine OGS",
      careYourAcc: "deine OGS",
      careYourGen: "deiner OGS",
      careThisAcc: "diese OGS",
      careThisDat: "dieser OGS",
      carePron: "sie",
      carePronCap: "Sie",
      carePoss: "ihr",
    });
  });

  it("declines a masculine name", () => {
    expect(careTermValuesOf("Hort", "der")).toEqual({
      careTerm: "Hort",
      careNom: "der Hort",
      careNomCap: "Der Hort",
      careAcc: "den Hort",
      careAccShort: "den Hort",
      careDat: "dem Hort",
      careGen: "vom Hort",
      careIn: "im Hort",
      careInCap: "Im Hort",
      careBei: "beim Hort",
      careVon: "vom Hort",
      careVonCap: "Vom Hort",
      careYourNom: "dein Hort",
      careYourNomCap: "Dein Hort",
      careYourAcc: "deinen Hort",
      careYourGen: "von deinem Hort",
      careThisAcc: "diesen Hort",
      careThisDat: "diesem Hort",
      carePron: "er",
      carePronCap: "Er",
      carePoss: "sein",
    });
  });

  it("declines a neuter name", () => {
    expect(careTermValuesOf("Lernhaus", "das")).toEqual({
      careTerm: "Lernhaus",
      careNom: "das Lernhaus",
      careNomCap: "Das Lernhaus",
      careAcc: "das Lernhaus",
      careAccShort: "das Lernhaus",
      careDat: "dem Lernhaus",
      careGen: "vom Lernhaus",
      careIn: "im Lernhaus",
      careInCap: "Im Lernhaus",
      careBei: "beim Lernhaus",
      careVon: "vom Lernhaus",
      careVonCap: "Vom Lernhaus",
      careYourNom: "dein Lernhaus",
      careYourNomCap: "Dein Lernhaus",
      careYourAcc: "dein Lernhaus",
      careYourGen: "von deinem Lernhaus",
      careThisAcc: "dieses Lernhaus",
      careThisDat: "diesem Lernhaus",
      carePron: "es",
      carePronCap: "Es",
      carePoss: "sein",
    });
  });

  it("reads „die OGS“ for missing or unknown metadata", () => {
    expect(normalizeCareArticle(undefined)).toBe("die");
    expect(normalizeCareArticle("den")).toBe("die");
    expect(normalizeCareArticle("Der")).toBe("die");
    expect(careTermValuesOf(undefined).careNomCap).toBe("Die OGS");
    expect(careTermValuesOf("  ", "der").careTerm).toBe("OGS");
    expect(careTermValuesOf("Ganztag").careAcc).toBe("die Ganztag");
    expect(careTermValues([]).careIn).toBe("in der OGS");
  });

  it("keeps „die“ for the presets whatever article is stored, as the backend", () => {
    expect(careTermValuesOf("OGS", "der").careNomCap).toBe("Die OGS");
    expect(careTermValuesOf(" GTS ", "das").careAcc).toBe("die GTS");
    expect(careFacilityName(undefined, "der").article).toBe("die");
  });

  it("names every school of an account once, each with its own article", () => {
    const mixed = careTermValues([
      careFacilityName("OGS", "die"),
      careFacilityName("Hort", "der"),
      careFacilityName(" OGS ", "die"),
    ]);
    expect(mixed.careTerm).toBe("OGS/Hort");
    expect(mixed.careNomCap).toBe("Die OGS/der Hort");
    expect(mixed.careAcc).toBe("die OGS/den Hort");
    expect(mixed.careIn).toBe("in der OGS/im Hort");
    expect(mixed.carePron).toBe("sie/er");
    expect(mixed.carePoss).toBe("ihr/sein");

    // One article for all schools reads as one name, as before #8136.
    const same = careTermValues([
      careFacilityName("GTS", "die"),
      careFacilityName("OGS", "die"),
      careFacilityName("GTS", "die"),
    ]);
    expect(same.careTerm).toBe("GTS/OGS");
    expect(same.careInCap).toBe("In der GTS/OGS");
    expect(same.carePron).toBe("sie");
  });

  it("covers every placeholder name", () => {
    expect(Object.keys(careTermValuesOf("OGS")).sort()).toEqual(
      [...CARE_TERM_PLACEHOLDERS].sort(),
    );
  });
});

function leaves(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, prefix ? `${prefix}.${key}` : key),
  );
}

// A misspelt placeholder would reach families as „{careNmo}“.
describe("care placeholders in the catalogs", () => {
  const known = new Set<string>(CARE_TERM_PLACEHOLDERS);

  it("uses only placeholders the frontend fills", () => {
    const used = new Set<string>();
    for (const [key, text] of leaves(de)) {
      for (const [, name] of text.matchAll(/\{(care[A-Za-z]*)[,}]/g)) {
        expect(known.has(name!), `${key}: {${name}}`).toBe(true);
        used.add(name!);
      }
    }
    // A form no German text uses any more is dead code in the helper; a
    // base form may live on through its sentence-start variant.
    expect(
      [...known].filter((name) => !used.has(name) && !used.has(`${name}Cap`)),
    ).toEqual([]);
  });

  it("writes no fixed article in front of the name", () => {
    for (const [key, text] of leaves(de)) {
      expect(text, key).not.toMatch(
        /\b(der|die|das|dem|den|des|deine|deiner|diese|dieser) \{careTerm\}(?!-)/i,
      );
    }
  });

  it.each(Object.entries({ en, pl, ru, sq, tr, uk }))(
    "%s keeps the bare name: German articles do not fit another language",
    (_locale, messages) => {
      for (const [key, text] of leaves(messages)) {
        for (const [, name] of text.matchAll(/\{(care[A-Za-z]*)[,}]/g)) {
          expect(name, key).toBe("careTerm");
        }
      }
    },
  );
});
