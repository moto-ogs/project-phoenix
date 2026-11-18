import { describe, expect, it } from "vitest";
import type { StaffChange } from "~/lib/traeger-staff-api";
import { staffChangeText } from "./staff-record-format";

const change = ({
  kind = "changed",
  field = "birthday",
  value = "",
}: {
  kind?: StaffChange["kind"];
  field?: StaffChange["field"];
  value?: string;
}): StaffChange => ({
  kind,
  field,
  value,
  schoolName: "",
  occurredAt: "2026-11-18T10:00:00Z",
});

// #7379: Korrekturen an Name und Geburtstag im Verlauf der Akte.
describe("staffChangeText for a corrected person", () => {
  it("names a birthday set for the first time", () => {
    expect(staffChangeText(change({}))).toBe("Geburtstag eingetragen");
  });

  it("keeps the old value of a replaced name", () => {
    expect(
      staffChangeText(change({ field: "first_name", value: "Mira" })),
    ).toBe("Vorname ersetzt, vorher „Mira“");
  });

  it("says a removed birthday is gone, not replaced", () => {
    expect(
      staffChangeText(change({ kind: "removed", value: "1990-04-12" })),
    ).toBe("Geburtstag entfernt, vorher „12.04.1990“");
  });
});
