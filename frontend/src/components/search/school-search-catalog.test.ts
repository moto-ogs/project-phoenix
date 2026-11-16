import { describe, expect, it } from "vitest";

import { settingsConcept } from "~/lib/concepts/settings";

import { matchEntries, searchEntry } from "./school-search-catalog";

function entry(label: string, context?: string, extra?: string) {
  return searchEntry(
    { id: label, label, context, href: `/${label}`, concept: settingsConcept },
    extra,
  );
}

describe("matchEntries", () => {
  const entries = [
    entry("Zeiterfassung", undefined, "Pausen buchen"),
    entry("Arbeitszeitmodelle", "Datenverwaltung"),
    entry("Mein Dienstplan"),
    entry("Dienstarten", "Datenverwaltung"),
    entry("Zeitkonten übertragen", "Kalender und Export"),
  ];

  it("ranks a name start before a word start before the middle of a word", () => {
    expect(matchEntries(entries, "dienst").map((hit) => hit.label)).toEqual([
      "Dienstarten",
      "Mein Dienstplan",
    ]);
    expect(matchEntries(entries, "zeit").map((hit) => hit.label)).toEqual([
      "Zeiterfassung",
      "Zeitkonten übertragen",
      "Arbeitszeitmodelle",
    ]);
  });

  it("finds by place and by further words after the name, ignoring accents", () => {
    expect(matchEntries(entries, "DATENVERW").map((hit) => hit.label)).toEqual([
      "Arbeitszeitmodelle",
      "Dienstarten",
    ]);
    expect(matchEntries(entries, "pausen").map((hit) => hit.label)).toEqual([
      "Zeiterfassung",
    ]);
    expect(matchEntries(entries, "ubertr").map((hit) => hit.label)).toEqual([
      "Zeitkonten übertragen",
    ]);
  });

  it("keeps the limit and offers only main pages without text", () => {
    expect(matchEntries(entries, "e", 2)).toHaveLength(2);
    const primary = searchEntry({
      id: "home",
      label: "Startseite",
      href: "/home",
      concept: settingsConcept,
      primary: true,
    });
    expect(matchEntries([...entries, primary], "  ")).toEqual([primary]);
  });
});
