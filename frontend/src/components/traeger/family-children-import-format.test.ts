import { describe, expect, it } from "vitest";
import type { FamilyImportRow } from "~/lib/traeger-family-children-import-api";
import { familyImportProblemText } from "./family-children-import-format";

const row: FamilyImportRow = {
  line: 2,
  status: "invalid",
  childFirstName: "Mia",
  childLastName: "Beispiel",
  childBirthDate: null,
  schoolName: "Grundschule Nord",
  children: 2,
  contractId: "31",
  validFrom: null,
  laterValidFrom: null,
  confirmedChildren: null,
  problems: [],
  repeatsLine: null,
};

describe("familyImportProblemText", () => {
  // Every field but the number used to read as a wrong birth date (#7765).
  it("names the field whose cell is no valid value", () => {
    expect(
      familyImportProblemText({ field: "valid_from", code: "invalid" }, row),
    ).toBe("„Gültig ab“ ist kein Datum. Beispiel: 01.09.2026.");
    expect(
      familyImportProblemText(
        { field: "child_birth_date", code: "invalid" },
        row,
      ),
    ).toBe("Das Geburtsdatum ist kein Datum. Beispiel: 03.05.2018.");
    expect(
      familyImportProblemText({ field: "children", code: "invalid" }, row),
    ).toBe("Die Kinderzahl ist keine ganze Zahl von 1 bis 20.");
  });
});
