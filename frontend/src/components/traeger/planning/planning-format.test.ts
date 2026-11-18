import { describe, expect, it } from "vitest";

import type { TraegerPlanningPerson } from "~/lib/traeger-planning-api";

import { contractSuggestions } from "./planning-format";

const PERSON: TraegerPlanningPerson = {
  recordId: "1",
  firstName: "Mira",
  lastName: "Sommer",
  sites: [
    { schoolId: "1", schoolName: "OGS Nord", staffId: "101" },
    { schoolId: "2", schoolName: "OGS Süd", staffId: "201" },
  ],
  shifts: [],
  plannedMinutes: 0,
  sollMinutes: 1500,
  sollDays: [
    { schoolId: "1", date: "2026-09-10", minutes: 300 },
    { schoolId: "2", date: "2026-09-10", minutes: 600 },
  ],
  warnings: [],
};

describe("contractSuggestions", () => {
  it("proposes each school's Soll from 08:00 with the statutory break", () => {
    expect(
      contractSuggestions(PERSON, "2026-09-10", "2026-09-09"),
    ).toMatchObject([
      { schoolId: "1", startTime: "08:00", endTime: "13:00", breakMinutes: 0 },
      { schoolId: "2", startTime: "08:00", endTime: "18:45", breakMinutes: 45 },
    ]);
  });

  it("skips past days, planned schools and cancelled shifts only count as open", () => {
    const shift = {
      id: "9",
      schoolId: "2",
      schoolName: "OGS Süd",
      staffId: "201",
      date: "2026-09-10",
      startTime: "12:00",
      endTime: "16:00",
      breakMinutes: 0,
      notes: "",
      cancelled: false,
      shiftTypeName: null,
      shiftTypeColor: null,
      plannedByTraeger: false,
      fromSeries: false,
    };
    expect(contractSuggestions(PERSON, "2026-09-10", "2026-09-11")).toEqual([]);
    expect(
      contractSuggestions(
        { ...PERSON, shifts: [shift] },
        "2026-09-10",
        "2026-09-09",
      ).map((suggestion) => suggestion.schoolId),
    ).toEqual(["1"]);
    expect(
      contractSuggestions(
        { ...PERSON, shifts: [{ ...shift, cancelled: true }] },
        "2026-09-10",
        "2026-09-09",
      ).map((suggestion) => suggestion.schoolId),
    ).toEqual(["1", "2"]);
  });
});
