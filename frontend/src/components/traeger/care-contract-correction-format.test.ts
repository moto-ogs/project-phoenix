import { describe, expect, it } from "vitest";
import type { ContractCorrectionRow } from "~/lib/traeger-contract-correction-api";
import {
  contractCorrectionProblemText,
  correctionDateLabel,
  correctionMethodLabel,
  matchesContractCorrectionFilter,
  missingColumnsText,
  partyChanges,
} from "./care-contract-correction-format";

const VALUES = {
  parties: ["Eva Beispiel"],
  method: "papier",
  concludedOn: "2026-03-12",
  dateUnknown: false,
} as const;

const ROW: ContractCorrectionRow = {
  line: 4,
  status: "invalid",
  contractId: "7",
  childName: "Mia Beispiel",
  schoolName: "Grundschule Nord",
  changes: [],
  before: VALUES,
  after: VALUES,
  evidence: "",
  problems: [],
  repeatsLine: null,
};

describe("contractCorrectionProblemText", () => {
  it.each([
    ["contract_id", "unknown", "Diese Vertrag-ID gibt es bei euch nicht."],
    [
      "contract_id",
      "not_imported",
      "Dieser Vertrag kommt nicht aus einem Import. Seine Angaben stammen aus moto.",
    ],
    ["child", "child_differs", "Das Kind passt nicht zur Vertrag-ID."],
    [
      "parties",
      "party_removed",
      "Eine Vertragspartei fehlt. Vorhandene Parteien bleiben im Vertrag.",
    ],
    [
      "concluded_on",
      "after_notice",
      "Das Datum liegt nach der Kündigung oder dem Widerruf.",
    ],
    ["concluded_on", "future", "Das Datum liegt in der Zukunft."],
    ["evidence", "missing", "Der Beleg fehlt."],
    [
      "method",
      "invalid",
      "Die Abschlussart ist nicht lesbar. Erlaubt sind online und papier.",
    ],
  ] as const)("names %s %s as a sentence", (field, code, text) => {
    expect(contractCorrectionProblemText({ field, code }, ROW)).toBe(text);
  });

  it("names the line a repeated contract stands in first", () => {
    const problem = { field: "contract_id", code: "repeated" } as const;
    expect(
      contractCorrectionProblemText(problem, { ...ROW, repeatsLine: 2 }),
    ).toBe("Der Vertrag steht schon in Zeile 2.");
    expect(contractCorrectionProblemText(problem, ROW)).toBe(
      "Der Vertrag steht mehrmals in der Datei.",
    );
  });

  it("falls back to the column for a code this build does not know", () => {
    expect(
      contractCorrectionProblemText({ field: "evidence", code: "new" }, ROW),
    ).toBe("Beleg prüfen.");
    expect(
      contractCorrectionProblemText({ field: undefined, code: "new" }, ROW),
    ).toBe("Diese Zeile prüfen.");
  });
});

describe("values", () => {
  it("never shows an unknown day as a date", () => {
    expect(correctionDateLabel(VALUES)).toBe("12.03.2026");
    expect(
      correctionDateLabel({ ...VALUES, concludedOn: null, dateUnknown: true }),
    ).toBe("Unbekannt");
    expect(correctionDateLabel({ ...VALUES, concludedOn: null })).toBe("–");
  });

  it("names the way of the conclusion", () => {
    expect(correctionMethodLabel("einfach_elektronisch")).toBe("Online");
    expect(correctionMethodLabel("papier")).toBe("Papier");
    expect(correctionMethodLabel(null)).toBe("–");
  });

  it("pairs the parties by their place and adds new ones at the end", () => {
    expect(
      partyChanges(
        ["Eva Beispiel", "Jan Beispel"],
        ["Eva Beispiel", "Jan Beispiel", "Ole Beispiel"],
      ),
    ).toEqual([
      { before: "Eva Beispiel", after: "Eva Beispiel" },
      { before: "Jan Beispel", after: "Jan Beispiel" },
      { before: null, after: "Ole Beispiel" },
    ]);
  });
});

describe("missingColumnsText", () => {
  it("names the missing columns as the list heads them", () => {
    expect(missingColumnsText(["evidence"])).toBe(
      "Es fehlt die Spalte „Beleg“.",
    );
    expect(missingColumnsText(["contract_id", "child", "evidence"])).toBe(
      "Es fehlen die Spalten „Vertrag-ID“, „Kind“ und „Beleg“.",
    );
  });
});

describe("matchesContractCorrectionFilter", () => {
  it("keeps changed rows under the change filter after the change", () => {
    expect(
      matchesContractCorrectionFilter(
        { ...ROW, status: "corrected" },
        "change",
      ),
    ).toBe(true);
    expect(matchesContractCorrectionFilter(ROW, "invalid")).toBe(true);
    expect(matchesContractCorrectionFilter(ROW, "unchanged")).toBe(false);
  });
});
