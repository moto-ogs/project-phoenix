import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path,
}));

import type {
  JournalNumberGap,
  JournalNumberRange,
  JournalRun,
} from "~/lib/traeger-invoice-journal-api";
import {
  journalGapText,
  journalIssuers,
  journalPeriodLabel,
  journalRangeLabel,
  journalRangeOf,
  journalRangeValue,
  journalReferenceWord,
  journalRunHref,
  journalRunLabel,
  journalRunOf,
} from "./invoice-journal-format";

const TRAEGER = { key: "", name: "" };
const STADT = { key: "DE98ZZZ09999999999", name: "Stadt Musterhausen" };

function range(overrides: Partial<JournalNumberRange>): JournalNumberRange {
  return {
    issuer: TRAEGER,
    service: "holiday",
    year: 2026,
    documentCount: 3,
    firstNumber: "FE-2026-0001",
    lastNumber: "FE-2026-0003",
    ...overrides,
  };
}

const GAP: JournalNumberGap = {
  issuer: TRAEGER,
  service: "holiday",
  year: 2026,
  firstMissing: 2,
  missingCount: 2,
  firstMissingNumber: "",
  lastMissingNumber: "",
  afterNumber: "FE-2026-0001",
  beforeNumber: "FE-2026-0004",
};

describe("invoice journal format", () => {
  it("names the missing numbers beside the documents around them", () => {
    expect(
      journalGapText({
        ...GAP,
        firstMissingNumber: "FE-2026-0002",
        lastMissingNumber: "FE-2026-0003",
      }),
    ).toBe(
      "Es fehlen die Nummern FE-2026-0002 und FE-2026-0003 (zwischen FE-2026-0001 und FE-2026-0004).",
    );
    // The counter went on past the last document.
    expect(
      journalGapText({
        ...GAP,
        missingCount: 4,
        beforeNumber: "",
        firstMissingNumber: "FE-2026-0002",
        lastMissingNumber: "FE-2026-0005",
      }),
    ).toBe(
      "Es fehlen die Nummern FE-2026-0002 bis FE-2026-0005 (nach FE-2026-0001).",
    );
    // A range that does not let the numbers be written names the running ones.
    expect(journalGapText({ ...GAP, missingCount: 1, afterNumber: "" })).toBe(
      "Es fehlt die laufende Nummer 2 (vor FE-2026-0004).",
    );
  });

  it("names a number range by service, year and, among several, issuer", () => {
    expect(journalRangeLabel(range({}), false)).toBe("Ferienbetreuung 2026");
    // A pattern without a year counts through the years.
    expect(journalRangeLabel(range({ service: "care", year: 0 }), false)).toBe(
      "Monatsbeiträge",
    );
    expect(journalRangeLabel(range({ issuer: STADT }), true)).toBe(
      "Ferienbetreuung 2026 · Stadt Musterhausen",
    );
    expect(journalRangeLabel(range({}), true)).toBe(
      "Ferienbetreuung 2026 · Träger",
    );
  });

  it("finds the chosen number range and run again among the choices", () => {
    const ranges = [range({}), range({ issuer: STADT })];
    const chosen = journalRangeOf(
      journalRangeValue({
        issuerKey: STADT.key,
        service: "holiday",
        year: 2026,
      }),
      ranges,
    );
    expect(chosen).toEqual({
      issuerKey: STADT.key,
      service: "holiday",
      year: 2026,
    });
    expect(journalRangeOf("", ranges)).toBeNull();

    const runs: JournalRun[] = [
      { kind: "care", id: "4", name: "", month: "2026-09-01", year: 0 },
      { kind: "holiday", id: "4", name: "Herbstferien", month: null, year: 0 },
    ];
    // Runs of different kinds may share an ID.
    expect(journalRunOf("holiday|4", runs)).toEqual({
      kind: "holiday",
      id: "4",
    });
    expect(journalRunOf("care_notice|4", runs)).toBeNull();
  });

  it("names a run like its list and leads to its page", () => {
    const notice: JournalRun = {
      kind: "care_notice",
      id: "7",
      name: "",
      month: null,
      year: 2026,
    };
    expect(journalRunLabel(notice)).toBe("Jahresbescheide 2026");
    expect(journalRunHref(notice)).toBe(
      "/traeger/abrechnung/jahresbescheide/7",
    );
    expect(
      journalRunLabel({
        kind: "care",
        id: "1",
        name: "",
        month: "2026-09-01",
        year: 0,
      }),
    ).toBe("Monatsbeiträge September 2026");
    // A kind of run this build does not know has no page to open.
    expect(journalRunHref({ ...notice, kind: undefined })).toBeNull();
  });

  it("lists the Träger first among the issuers", () => {
    expect(
      journalIssuers([range({ issuer: STADT }), range({}), range({})]),
    ).toEqual([TRAEGER, STADT]);
  });

  it("words the reference and the period", () => {
    expect(journalReferenceWord({ kind: "cancels", number: "X" })).toBe("zu");
    expect(journalReferenceWord({ kind: "replaces", number: "X" })).toBe(
      "ersetzt",
    );
    expect(journalPeriodLabel("2026-01-01", "2026-12-31")).toBe(
      "01.01.2026 bis 31.12.2026",
    );
    expect(journalPeriodLabel("2026-01-01", "2026-01-01")).toBe("01.01.2026");
    expect(journalPeriodLabel("", "")).toBe("");
  });
});
