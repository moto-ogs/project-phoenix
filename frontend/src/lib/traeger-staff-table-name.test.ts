import { describe, expect, it } from "vitest";

import { staffName, staffTableName } from "~/lib/traeger-staff-api";

// TENANT-PAGE-SPEC Regel 11 (#7405): tables read „Nachname, Vorname“, tiles
// and sentences keep „Vorname Nachname“.
describe("staffTableName", () => {
  it("puts the last name first", () => {
    const person = { firstName: "Mira", lastName: "Sommer" };
    expect(staffTableName(person)).toBe("Sommer, Mira");
    expect(staffName(person)).toBe("Mira Sommer");
  });

  it("leaves no dangling comma when a part is missing", () => {
    expect(staffTableName({ firstName: "", lastName: "Sommer" })).toBe(
      "Sommer",
    );
    expect(staffTableName({ firstName: "Mira", lastName: " " })).toBe("Mira");
  });
});
