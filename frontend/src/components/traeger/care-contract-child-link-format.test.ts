import { describe, expect, it } from "vitest";
import type {
  ChildLinkProblemCode,
  ChildLinkRow,
} from "~/lib/traeger-contract-child-links-api";
import {
  childLinkDifference,
  childLinkRowTexts,
  childLinkSingleBlock,
  defaultChildLinkFilter,
  matchesChildLinkFilter,
  openChildLinkRowsCsv,
} from "./care-contract-child-link-format";

function row(overrides: Partial<ChildLinkRow> = {}): ChildLinkRow {
  return {
    line: 2,
    status: "ready",
    contractId: "75",
    studentId: "12",
    schoolName: "OGS Sonnenhof",
    contract: {
      firstName: "Mia",
      lastName: "Beispiel",
      birthDate: "2018-05-03",
    },
    student: {
      firstName: "Mia",
      lastName: "Beispiel",
      birthDate: "2018-05-03",
    },
    problems: [],
    repeatsLine: null,
    otherContractId: null,
    fingerprint: "",
    ...overrides,
  };
}

const COUNTS = { ready: 0, linked: 0, stored: 0, conflict: 0, invalid: 0 };

describe("Texte der Verknüpfung mit der Kinderakte", () => {
  it.each<[ChildLinkProblemCode, "contract" | "child", string]>([
    [
      "missing",
      "contract",
      "In der Zeile fehlt die Vertragsnummer. Trage sie in der Datei nach.",
    ],
    [
      "missing",
      "child",
      "In der Zeile fehlt die Nummer der Kinderakte. Trage sie in der Datei nach.",
    ],
    [
      "invalid",
      "contract",
      "Die Vertragsnummer ist keine ganze Zahl. Prüfe die Zeile in der Datei.",
    ],
    [
      "invalid",
      "child",
      "Die Nummer der Kinderakte ist keine ganze Zahl. Prüfe die Zeile in der Datei.",
    ],
    [
      "unknown",
      "contract",
      "Einen Vertrag mit dieser Nummer gibt es bei deinem Träger nicht. Prüfe die Nummer.",
    ],
    [
      "unknown",
      "child",
      "Die Schule des Vertrags hat keine Kinderakte mit dieser Nummer. Prüfe die Nummer.",
    ],
    [
      "not_imported",
      "contract",
      "Das ist kein importierter Vertrag. Ein Vertrag aus einer Anmeldung gehört schon zu seinem Kind.",
    ],
    [
      "repeated",
      "contract",
      "Dieser Vertrag steht auch in Zeile 2. Behalte nur die Zeile, die stimmt.",
    ],
    [
      "repeated",
      "child",
      "Diese Kinderakte steht auch in Zeile 2, für einen Vertrag derselben Zeit. Behalte nur die Zeile, die stimmt.",
    ],
    [
      "linked_other",
      "contract",
      "Der Vertrag ist schon mit einer anderen Kinderakte verknüpft. Prüfe das auf der Seite des Vertrags.",
    ],
    [
      "has_contract",
      "child",
      "Das Kind hat in dieser Zeit schon einen anderen laufenden Vertrag an der Schule (Nr. 9). Prüfe beide Verträge.",
    ],
  ])("names %s of the %s with what to do", (code, field, text) => {
    expect(
      childLinkRowTexts(
        row({
          status: "conflict",
          problems: [{ field, code }],
          repeatsLine: 2,
          otherContractId: "9",
        }),
      ),
    ).toEqual([text]);
  });

  it("names exactly what differs", () => {
    const born = row({
      status: "conflict",
      problems: [{ field: "child", code: "differs" }],
      student: {
        firstName: "mia",
        lastName: "Beispiel ",
        birthDate: "2018-05-30",
      },
    });
    // Case and blanks do not count, as in the backend.
    expect(childLinkDifference(born.contract, born.student)).toEqual({
      name: false,
      birthDate: true,
    });
    expect(childLinkRowTexts(born)[0]).toBe(
      "Das Geburtsdatum in der Kinderakte ist anders als im Vertrag. Ist es dasselbe Kind, verknüpfe den Vertrag einzeln auf seiner Seite.",
    );
    // A missing date of birth contradicts nothing.
    expect(
      childLinkDifference(born.contract, { ...born.contract, birthDate: null }),
    ).toEqual({ name: false, birthDate: false });
  });

  it("says what a row without a problem does", () => {
    expect(childLinkRowTexts(row())).toEqual([
      "Passt. moto verknüpft den Vertrag mit dieser Kinderakte.",
    ]);
    expect(childLinkRowTexts(row({ status: "linked" }))).toEqual([
      "Der Vertrag ist schon mit dieser Kinderakte verknüpft.",
    ]);
    expect(childLinkRowTexts(row({ status: "stored" }))).toEqual([
      "Jetzt mit dieser Kinderakte verknüpft.",
    ]);
  });

  it("filters and opens on the rows that need work", () => {
    const stored = row({ status: "stored" });
    expect(matchesChildLinkFilter(stored, "ready")).toBe(true);
    expect(
      matchesChildLinkFilter(row({ status: "conflict" }), "conflict"),
    ).toBe(true);
    expect(matchesChildLinkFilter(row({ status: "invalid" }), "conflict")).toBe(
      false,
    );
    expect(
      defaultChildLinkFilter({ ...COUNTS, ready: 3, conflict: 1, invalid: 1 }),
    ).toBe("conflict");
    expect(defaultChildLinkFilter({ ...COUNTS, ready: 3, invalid: 2 })).toBe(
      "invalid",
    );
    expect(defaultChildLinkFilter({ ...COUNTS, linked: 4 })).toBe("all");
  });

  it("lets the office confirm only a difference in a single link", () => {
    expect(
      childLinkSingleBlock(
        row({
          status: "conflict",
          problems: [{ field: "child", code: "differs" }],
        }),
      ),
    ).toBeNull();
    expect(
      childLinkSingleBlock(
        row({
          status: "conflict",
          otherContractId: "9",
          problems: [{ field: "child", code: "has_contract" }],
        }),
      ),
    ).toBe(
      "Das Kind hat in dieser Zeit schon einen anderen laufenden Vertrag an der Schule (Nr. 9). Prüfe zuerst beide Verträge.",
    );
  });

  it("writes the open rows as a work list a spreadsheet cannot run", () => {
    const csv = openChildLinkRowsCsv([
      row({
        status: "invalid",
        contract: { firstName: "=HYPERLINK(1)", lastName: "", birthDate: null },
        student: null,
        problems: [{ field: "child", code: "unknown" }],
      }),
    ]);
    const [header, line] = csv.split("\r\n");
    expect(header).toBe(
      "Zeile;Vertragsnummer;Nummer der Kinderakte;Kind im Vertrag;Kind in der Kinderakte;Schule;Was zu tun ist",
    );
    expect(line).toContain("'=HYPERLINK(1) (ohne Geburtsdatum)");
    expect(line).toContain("Die Schule des Vertrags hat keine Kinderakte");
  });
});
