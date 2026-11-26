import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { settingsConcept } from "~/lib/concepts/settings";
import type { SchemaTab } from "~/lib/settings-api";
import { TAB_LABELS } from "./settings-filter";
import {
  activeSettingsSectionId,
  settingsSectionHref,
  settingsSectionsFor,
} from "./settings-nav-items";
import { settingsTabIsPlaced } from "./settings-sections";

const tabs = [
  { id: "settings-operations", label: "Betrieb", icon: settingsConcept },
  { id: "settings-gdpr", label: "Datenschutz", icon: settingsConcept },
  { id: "settings-devices", label: "Geräte", icon: settingsConcept },
];

describe("activeSettingsSectionId", () => {
  it("prefers the section the address names", () => {
    expect(
      activeSettingsSectionId(
        { tabs, highlightTabId: "settings-devices" },
        "gdpr",
      ),
    ).toBe("settings-gdpr");
  });

  it("uses the section of a deep-linked setting without ?tab=", () => {
    expect(
      activeSettingsSectionId(
        { tabs, highlightTabId: "settings-devices" },
        null,
      ),
    ).toBe("settings-devices");
  });

  it("falls back to the first section for an unknown or hidden value", () => {
    expect(activeSettingsSectionId({ tabs }, "gibtsnicht")).toBe(
      "settings-operations",
    );
    expect(
      activeSettingsSectionId({ tabs, highlightTabId: "settings-x" }, null),
    ).toBe("settings-operations");
  });

  it("has no section when the list is empty", () => {
    expect(activeSettingsSectionId({ tabs: [] }, null)).toBe("");
  });
});

describe("settingsSectionHref", () => {
  it("names the section in the address", () => {
    expect(settingsSectionHref("settings-gdpr")).toBe("/settings?tab=gdpr");
  });
});

// Die Bereiche, die die Registry des Backends kennt. Ein Bereich steht dort
// als `Tab: "…"` an der Einstellung oder als Konstante `…Tab = "…"`.
function backendTabKeys(): string[] {
  const defaultsDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../backend/modules/settings/internal/defaults",
  );
  const keys = new Set<string>();
  for (const filename of readdirSync(defaultsDirectory)) {
    if (!filename.endsWith(".go") || filename.endsWith("_test.go")) {
      continue;
    }
    const source = readFileSync(resolve(defaultsDirectory, filename), "utf8");
    for (const match of source.matchAll(/Tab(?::|\s*=)\s*"([^"]+)"/g)) {
      keys.add(match[1]!);
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function tabWithOneSetting(key: string): SchemaTab {
  return {
    key,
    label: key,
    categories: [
      {
        key: "allgemein",
        label: "allgemein",
        items: [
          {
            key: `${key}.wert`,
            label: "Wert",
            description: "",
            type: "boolean",
            default: true,
            value: true,
            is_default: true,
            writable: true,
            visible: true,
            sort_order: 1,
            access_policy: "shared",
            levels: "schule",
            source: "default",
          },
        ],
      },
    ],
  };
}

// #8132: fünf Bereiche trugen dasselbe Zahnrad, einer hieß „lohnexport“.
describe("settingsSectionsFor", () => {
  const keys = backendTabKeys();
  const sections = settingsSectionsFor(
    { tabs: keys.map(tabWithOneSetting) },
    { schemaFailed: false, nfcEnabled: true, canManageHomeBlocks: true },
  );
  // „Startseite für alle“ ist handgeschrieben (#2875), auch wenn ihre
  // Schalter im Schema unter `startseite` stehen.
  const schemaSections = sections.filter(
    (section) =>
      section.id !== "settings-startseite" &&
      keys.includes(section.id.replace(/^settings-/, "")),
  );

  it("reads the areas of the backend registry", () => {
    expect(keys).toEqual(
      expect.arrayContaining(["operations", "lohnexport", "datev"]),
    );
    expect(schemaSections.length).toBeGreaterThan(10);
  });

  it("names every area of the backend registry in German", () => {
    const unnamed = keys.filter((key) => {
      const label = TAB_LABELS[key];
      return label === undefined || label === key || !/^\p{Lu}/u.test(label);
    });
    expect(unnamed).toEqual([]);
  });

  it("gives every area in the sidebar a symbol of its own", () => {
    const labelsBySymbol = new Map<unknown, string[]>();
    for (const section of sections) {
      const labels = labelsBySymbol.get(section.icon.icon) ?? [];
      labelsBySymbol.set(section.icon.icon, [...labels, section.label]);
    }
    const shared = [...labelsBySymbol.values()].filter(
      (labels) => labels.length > 1,
    );
    expect(shared).toEqual([]);
  });

  it("keeps the gear for „Betrieb“ alone", () => {
    expect(
      sections
        .filter((section) => section.icon === settingsConcept)
        .map((section) => section.label),
    ).toEqual(["Betrieb"]);
  });

  // #8153: ein Bereich ohne festen Platz fiel ans Ende, und „Sicherheit“
  // stand zwischen den Bereichen des Trägers.
  it("places every area of the sidebar in a group", () => {
    const unplaced = schemaSections
      .map((section) => section.id.replace(/^settings-/, ""))
      .filter((key) => !settingsTabIsPlaced(key));
    expect(unplaced).toEqual([]);
  });

  it("lists the areas of the Träger last, after Personalisierung", () => {
    const labels = sections.map((section) => section.label);
    const traeger = sections
      .filter((section) => section.traeger)
      .map((section) => section.label);
    expect(traeger).toEqual(
      expect.arrayContaining([
        "Zuständigkeiten",
        "Betreuungsverträge",
        "Monatsbeitrag",
        "Einsatzplanung",
        "Lohnexport",
        "Dashboard",
        "Briefkopf",
      ]),
    );
    expect(traeger).not.toContain("Sicherheit");
    expect(labels.slice(-traeger.length)).toEqual(traeger);
    expect(labels.slice(-traeger.length - 2, -traeger.length)).toEqual([
      "Startseite für alle",
      "Personalisierung",
    ]);
  });

  it("keeps the order of the schema inside each group", () => {
    const schemaOrder = keys.map((key) => `settings-${key}`);
    for (const traeger of [false, true]) {
      const group = schemaSections
        .filter((section) => (section.traeger === true) === traeger)
        .map((section) => section.id);
      expect(group).toEqual(schemaOrder.filter((id) => group.includes(id)));
    }
  });

  it("shows „Lohnexport“ with a capital letter", () => {
    expect(
      sections.find((section) => section.id === "settings-lohnexport")?.label,
    ).toBe("Lohnexport");
  });
});
