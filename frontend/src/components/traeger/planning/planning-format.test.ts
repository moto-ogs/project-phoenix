import { describe, expect, it } from "vitest";

import type {
  TraegerPlanningPerson,
  TraegerPlanningShift,
} from "~/lib/traeger-planning-api";

import { contractSuggestions } from "./planning-format";

const TODAY = "2026-09-09";
const DAY = "2026-09-10";

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
    { schoolId: "1", date: DAY, minutes: 300 },
    { schoolId: "2", date: DAY, minutes: 240 },
  ],
  absentDays: [],
  warnings: [],
};

function shift(patch: Partial<TraegerPlanningShift>): TraegerPlanningShift {
  return {
    id: "9",
    schoolId: "2",
    schoolName: "OGS Süd",
    staffId: "201",
    date: DAY,
    startTime: "12:00",
    endTime: "16:00",
    breakMinutes: 0,
    notes: "",
    cancelled: false,
    shiftTypeName: null,
    shiftTypeColor: null,
    plannedByTraeger: false,
    fromSeries: false,
    ...patch,
  };
}

describe("contractSuggestions", () => {
  it("never lets two suggestions of a day overlap", () => {
    // Both schools would start at 08:00; Süd moves behind Nord with a gap.
    expect(contractSuggestions(PERSON, DAY, TODAY)).toMatchObject([
      { schoolId: "1", startTime: "08:00", endTime: "13:00", breakMinutes: 0 },
      { schoolId: "2", startTime: "13:30", endTime: "17:30", breakMinutes: 0 },
    ]);
  });

  it("moves behind a planned shift at another school", () => {
    const person = {
      ...PERSON,
      sollDays: [{ schoolId: "2", date: DAY, minutes: 240 }],
      shifts: [
        shift({
          schoolId: "1",
          schoolName: "OGS Nord",
          startTime: "07:30",
          endTime: "12:00",
        }),
      ],
    };
    expect(contractSuggestions(person, DAY, TODAY)).toMatchObject([
      { schoolId: "2", startTime: "12:30", endTime: "16:30" },
    ]);
  });

  it("takes the usual start at the school, not a single evening", () => {
    const person = {
      ...PERSON,
      sollDays: [{ schoolId: "2", date: DAY, minutes: 240 }],
      shifts: [
        shift({
          id: "1",
          date: "2026-09-07",
          startTime: "18:00",
          endTime: "20:30",
        }),
        shift({
          id: "2",
          date: "2026-09-08",
          startTime: "09:00",
          endTime: "13:00",
        }),
        shift({
          id: "3",
          date: "2026-09-11",
          startTime: "09:00",
          endTime: "13:00",
        }),
      ],
    };
    expect(contractSuggestions(person, DAY, TODAY)).toMatchObject([
      { schoolId: "2", startTime: "09:00", endTime: "13:00" },
    ]);
  });

  it("adds the break the whole day needs over all schools", () => {
    // 6 h at Nord until 14:00 plus 4 h at Süd: 10 h need 45 minutes; the
    // 30-minute gap counts, the suggestion carries the other 15.
    const person = {
      ...PERSON,
      sollDays: [{ schoolId: "2", date: DAY, minutes: 240 }],
      shifts: [
        shift({
          schoolId: "1",
          schoolName: "OGS Nord",
          startTime: "08:00",
          endTime: "14:00",
        }),
      ],
    };
    expect(contractSuggestions(person, DAY, TODAY)).toMatchObject([
      { schoolId: "2", startTime: "14:30", endTime: "18:45", breakMinutes: 15 },
    ]);
  });

  it("gives a long day its statutory break", () => {
    const person = {
      ...PERSON,
      sollDays: [{ schoolId: "1", date: DAY, minutes: 420 }],
    };
    expect(contractSuggestions(person, DAY, TODAY)).toMatchObject([
      { startTime: "08:00", endTime: "15:30", breakMinutes: 30 },
    ]);
  });

  it("never leads above the Soll of the week", () => {
    expect(
      contractSuggestions({ ...PERSON, plannedMinutes: 1500 }, DAY, TODAY),
    ).toEqual([]);
    expect(
      contractSuggestions({ ...PERSON, plannedMinutes: 1320 }, DAY, TODAY),
    ).toMatchObject([{ schoolId: "1", minutes: 180, endTime: "11:00" }]);
  });

  it("suggests nothing on a full absence day at that school", () => {
    expect(
      contractSuggestions(
        { ...PERSON, absentDays: [{ schoolId: "2", date: DAY }] },
        DAY,
        TODAY,
      ).map((suggestion) => suggestion.schoolId),
    ).toEqual(["1"]);
  });

  it("skips past days and schools already planned; cancelled shifts count as open", () => {
    expect(contractSuggestions(PERSON, DAY, "2026-09-11")).toEqual([]);
    const planned = shift({});
    expect(
      contractSuggestions({ ...PERSON, shifts: [planned] }, DAY, TODAY).map(
        (suggestion) => suggestion.schoolId,
      ),
    ).toEqual(["1"]);
    expect(
      contractSuggestions(
        { ...PERSON, shifts: [{ ...planned, cancelled: true }] },
        DAY,
        TODAY,
      ).map((suggestion) => suggestion.schoolId),
    ).toEqual(["1", "2"]);
  });
});
