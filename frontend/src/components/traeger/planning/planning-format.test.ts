import { describe, expect, it } from "vitest";

import type {
  TraegerPlanningPerson,
  TraegerPlanningShift,
} from "~/lib/traeger-planning-api";

import { suggestionSentence, weekSuggestions } from "./planning-format";

const MON = "2026-09-07";
const TUE = "2026-09-08";
const WED = "2026-09-09";
const THU = "2026-09-10";
const FRI = "2026-09-11";

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
    { schoolId: "1", date: THU, minutes: 300 },
    { schoolId: "2", date: THU, minutes: 240 },
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
    date: THU,
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

const nordOnThursday = (minutes: number) => ({
  sollDays: [{ schoolId: "1", date: THU, minutes }],
});

const on = (person: TraegerPlanningPerson, date: string, today = WED) =>
  weekSuggestions(person, today).get(date) ?? [];

describe("weekSuggestions", () => {
  it("never lets two suggestions of a day overlap", () => {
    expect(on(PERSON, THU)).toMatchObject([
      { schoolId: "1", startTime: "08:00", endTime: "13:00", breakMinutes: 0 },
      { schoolId: "2", startTime: "13:30", endTime: "17:30", breakMinutes: 0 },
    ]);
  });

  it("keeps 30 minutes to a planned shift at another school, before or after", () => {
    // 08:00–12:00 would end where Süd begins; the earlier slot keeps the gap.
    const before = {
      ...PERSON,
      ...nordOnThursday(240),
      shifts: [shift({ startTime: "12:00", endTime: "16:00" })],
    };
    expect(on(before, THU)).toMatchObject([
      { startTime: "07:30", endTime: "11:30", breakMinutes: 0 },
    ]);
    // A 20-minute gap would count as break only until a break shortens it.
    const tight = {
      ...PERSON,
      ...nordOnThursday(240),
      shifts: [shift({ startTime: "12:20", endTime: "16:00" })],
    };
    expect(on(tight, THU)).toMatchObject([
      { startTime: "07:50", endTime: "11:50", breakMinutes: 0 },
    ]);
  });

  it("adds the break the whole day needs over all schools", () => {
    // 6 h at Süd until 14:00 plus 4 h at Nord: 10 h need 45 minutes; the
    // 30-minute gap counts, the suggestion carries the other 15. No start
    // before 06:00.
    const person = {
      ...PERSON,
      ...nordOnThursday(240),
      shifts: [shift({ startTime: "08:00", endTime: "14:00" })],
    };
    expect(on(person, THU)).toMatchObject([
      { startTime: "14:30", endTime: "18:45", breakMinutes: 15 },
    ]);
  });

  it("does not take the break from the gap to the next shift", () => {
    // 5 h at Süd from 13:40 plus 5 h at Nord need 45 minutes. Lengthening
    // Nord to the back would shrink the counted gap; it starts earlier.
    const person = {
      ...PERSON,
      ...nordOnThursday(300),
      shifts: [shift({ startTime: "13:40", endTime: "18:40" })],
    };
    const [nord] = on(person, THU);
    expect(nord).toMatchObject({
      startTime: "07:55",
      endTime: "13:00",
      breakMinutes: 5,
    });
  });

  it("gives a long day its statutory break", () => {
    expect(on({ ...PERSON, ...nordOnThursday(420) }, THU)).toMatchObject([
      { startTime: "08:00", endTime: "15:30", breakMinutes: 30 },
    ]);
  });

  it("takes the usual start at the school, unless the day runs past midnight", () => {
    const usual = {
      ...PERSON,
      ...nordOnThursday(240),
      shifts: [
        shift({
          id: "1",
          schoolId: "1",
          date: MON,
          startTime: "18:00",
          endTime: "20:30",
        }),
        shift({
          id: "2",
          schoolId: "1",
          date: TUE,
          startTime: "09:00",
          endTime: "13:00",
        }),
        shift({
          id: "3",
          schoolId: "1",
          date: WED,
          startTime: "09:00",
          endTime: "13:00",
        }),
      ],
    };
    expect(on(usual, THU)).toMatchObject([
      { startTime: "09:00", endTime: "13:00" },
    ]);
    const late = {
      ...PERSON,
      ...nordOnThursday(480),
      shifts: [
        shift({
          schoolId: "1",
          date: WED,
          startTime: "16:00",
          endTime: "18:00",
        }),
      ],
    };
    expect(on(late, THU)).toMatchObject([
      { startTime: "08:00", endTime: "16:30", breakMinutes: 30 },
    ]);
  });

  it("never leads above the Soll of the week, over all days together", () => {
    const person: TraegerPlanningPerson = {
      ...PERSON,
      sollMinutes: 1200,
      plannedMinutes: 720,
      sollDays: [MON, TUE, WED, THU, FRI].map((date) => ({
        schoolId: "1",
        date,
        minutes: 240,
      })),
      shifts: [
        shift({
          id: "1",
          schoolId: "1",
          date: MON,
          startTime: "08:00",
          endTime: "14:00",
        }),
        shift({
          id: "2",
          schoolId: "1",
          date: TUE,
          startTime: "08:00",
          endTime: "14:00",
        }),
      ],
    };
    const week = weekSuggestions(person, MON);
    expect([...week.keys()]).toEqual([WED, THU]);
    // A rest under 30 minutes gets no suggestion of its own.
    expect(weekSuggestions({ ...person, plannedMinutes: 1180 }, MON).size).toBe(
      0,
    );
  });

  it("never leads above the daily maximum over all schools", () => {
    // 7 h at Süd and a 10-hour day: Nord gets the 3 h that are left.
    const person = {
      ...PERSON,
      ...nordOnThursday(300),
      shifts: [
        shift({ startTime: "07:00", endTime: "14:30", breakMinutes: 30 }),
      ],
    };
    const suggestions = weekSuggestions(person, WED, 600).get(THU) ?? [];
    expect(suggestions).toMatchObject([
      {
        contractMinutes: 300,
        minutes: 180,
        startTime: "15:00",
        endTime: "18:00",
      },
    ]);
    expect(suggestionSentence(suggestions[0]!)).toBe(
      "Laut Arbeitsvertrag 5 h an OGS Nord. moto schlägt 3 h vor, mehr ginge über das Soll der Woche oder die Höchstzeit am Tag. Prüfe Beginn und Ende.",
    );
  });

  it("suggests nothing on a full absence day at that school", () => {
    const person = { ...PERSON, absentDays: [{ schoolId: "2", date: THU }] };
    expect(on(person, THU).map((s) => s.schoolId)).toEqual(["1"]);
  });

  it("skips past days and any day a school already has a shift, cancelled too", () => {
    expect(on(PERSON, THU, FRI)).toEqual([]);
    const planned = shift({});
    expect(
      on({ ...PERSON, shifts: [planned] }, THU).map((s) => s.schoolId),
    ).toEqual(["1"]);
    expect(
      on({ ...PERSON, shifts: [{ ...planned, cancelled: true }] }, THU).map(
        (s) => s.schoolId,
      ),
    ).toEqual(["1"]);
  });
});
