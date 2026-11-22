import { describe, expect, it } from "vitest";
import type { OfferingCorrectionContract } from "~/lib/traeger-offering-correction-api";
import {
  correctionNotes,
  firstOfNextMonth,
  matchesCorrectionFilter,
  missingColumnsText,
} from "./care-contract-offering-correction-format";

function contract(
  overrides: Partial<OfferingCorrectionContract> = {},
): OfferingCorrectionContract {
  return {
    reference: "41",
    line: 2,
    contractId: "41",
    schoolName: "OGS Nord",
    childFirstName: "Mia",
    childLastName: "Beispiel",
    status: "ready",
    effectiveFrom: "2026-10-01",
    versionNumber: 2,
    changes: [],
    problems: [],
    hints: [],
    ...overrides,
  };
}

describe("offering correction texts (#7764)", () => {
  it("proposes the first of the next month, also across the year", () => {
    expect(firstOfNextMonth("2026-09-09")).toBe("2026-10-01");
    expect(firstOfNextMonth("2026-12-31")).toBe("2027-01-01");
  });

  it("names each problem with its line and leaves the moved start to its column", () => {
    expect(
      correctionNotes(
        contract({
          status: "invalid",
          problems: [
            { line: 12, field: "current_offering", code: "not_booked" },
            { line: 13, field: "contract", code: "follows_bookings" },
          ],
          hints: ["start_moved", "end_time_differs"],
        }),
      ),
    ).toEqual([
      "Zeile 12: Der Vertrag bucht das bisherige Modul an diesem Tag nicht.",
      "Zeile 13: Der Vertrag kommt aus einer Anmeldung. Ändere die Buchung bei der Schule.",
      "Das neue Modul endet an einem Tag zu einer anderen Zeit. Der Vertrag behält seine Endzeit. Prüfe, ob das passt.",
    ]);
    expect(correctionNotes(contract({ status: "held" }))).toEqual([
      "Für eine Buchung fehlt noch das neue Modul. moto ändert den Vertrag erst, wenn alle feststehen.",
    ]);
  });

  it("filters corrected contracts with the ready ones", () => {
    expect(
      matchesCorrectionFilter(contract({ status: "corrected" }), "ready"),
    ).toBe(true);
    expect(matchesCorrectionFilter(contract({ status: "held" }), "ready")).toBe(
      false,
    );
    expect(missingColumnsText(["contract", "target_offering"])).toBe(
      "„Vertrag“, „Neues Modul“",
    );
  });
});
