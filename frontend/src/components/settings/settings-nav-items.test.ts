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
  const schemaSections = sections.filter((section) =>
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

  it("shows „Lohnexport“ with a capital letter", () => {
    expect(
      sections.find((section) => section.id === "settings-lohnexport")?.label,
    ).toBe("Lohnexport");
  });
});
