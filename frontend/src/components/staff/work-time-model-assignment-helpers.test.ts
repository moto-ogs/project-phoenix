import { describe, expect, it } from "vitest";

import type { Staff, StaffWorkTimeFact, WorkTimeModel } from "~/lib/staff-api";

import {
  assignmentPeople,
  blockedReason,
  dayBefore,
  startPhrase,
  suggestedEarlierStart,
} from "./work-time-model-assignment-helpers";

function staff(id: string, name: string, extra: Partial<Staff> = {}): Staff {
  const [firstName = "", lastName = ""] = name.split(" ");
  return {
    id,
    name,
    firstName,
    lastName,
    hasRfid: false,
    isTeacher: false,
    isSupervising: false,
    supervisions: [],
    ...extra,
  };
}

function fact(staffId: string, extra: Partial<StaffWorkTimeFact> = {}) {
  return {
    staffId,
    workTimeModelId: null,
    hasSchedule: false,
    sollKeptByTraeger: false,
    closedThrough: null,
    ...extra,
  } satisfies StaffWorkTimeFact;
}

const models = [
  { id: "7", name: "Vollzeit 40 Stunden" },
  { id: "8", name: "Teilzeit A/B-Woche" },
] as WorkTimeModel[];

describe("assignmentPeople", () => {
  it("splits assignees from candidates, sorts by name and leaves out external people", () => {
    const people = assignmentPeople(
      [
        staff("1", "Zoe Weber"),
        staff("2", "Anna Becker", { role: " Erzieherin " }),
        staff("3", "Max Extern", { isExternal: true }),
        staff("4", "Ömer Kaya"),
        staff("5", "Lea Neu"),
      ],
      [
        fact("1", { workTimeModelId: "7", hasSchedule: true }),
        fact("2", { workTimeModelId: "8", hasSchedule: true }),
        fact("4", { hasSchedule: true }),
        fact("3", { workTimeModelId: "7" }),
      ],
      models,
      "7",
    );

    expect(people.assignees.map((person) => person.name)).toEqual([
      "Zoe Weber",
    ]);
    expect(
      people.candidates.map((person) => [person.name, person.current]),
    ).toEqual([
      ["Anna Becker", "Vorlage „Teilzeit A/B-Woche“"],
      ["Lea Neu", "Noch kein Soll"],
      ["Ömer Kaya", "Eigenes Soll"],
    ]);
    expect(people.candidates[0]?.role).toBe("Erzieherin");
  });

  it("shows the position in the form of the person's Stammdaten", () => {
    const people = assignmentPeople(
      [
        staff("1", "Jana Krüger", { role: "Betreuer", roleForm: "feminine" }),
        staff("2", "Mai Pham", { role: "Betreuer" }),
      ],
      [],
      models,
      "7",
    );

    expect(people.candidates.map((person) => person.role)).toEqual([
      "Betreuerin",
      "Betreuer:in",
    ]);
  });

  it("names a Soll the Träger keeps", () => {
    const people = assignmentPeople(
      [staff("1", "Mira Sommer")],
      [fact("1", { sollKeptByTraeger: true, hasSchedule: true })],
      models,
      "7",
    );
    expect(people.candidates[0]?.current).toBe("Soll vom Träger");
  });
});

describe("blockedReason", () => {
  const base = assignmentPeople(
    [staff("1", "Neu Ohne"), staff("2", "Alt Mit"), staff("3", "Zu Spät")],
    [fact("2", { hasSchedule: true }), fact("3", { closedThrough: "2026-08" })],
    models,
    "7",
  ).candidates;
  const byName = (name: string) => base.find((person) => person.name === name)!;

  it("lets everybody start today except a Soll the Träger keeps", () => {
    expect(blockedReason(byName("Alt Mit"), null)).toBeNull();
    expect(blockedReason(byName("Zu Spät"), null)).toBeNull();
    const kept = { ...byName("Neu Ohne"), keptByTraeger: true };
    expect(blockedReason(kept, null)).toContain("Träger");
  });

  it("allows an earlier start only for a first Soll after the closed month", () => {
    expect(blockedReason(byName("Neu Ohne"), "2026-08-15")).toBeNull();
    expect(blockedReason(byName("Alt Mit"), "2026-09-01")).toContain(
      "schon ein Soll",
    );
    expect(blockedReason(byName("Zu Spät"), "2026-08-31")).toBe(
      "Bis August 2026 ist der Monat abgeschlossen.",
    );
    expect(blockedReason(byName("Zu Spät"), "2026-09-01")).toBeNull();
  });
});

describe("start dates", () => {
  it("suggests the first of the month, on the first the month before", () => {
    expect(suggestedEarlierStart("2026-09-09")).toBe("2026-09-01");
    expect(suggestedEarlierStart("2026-09-01")).toBe("2026-08-01");
    expect(suggestedEarlierStart("2026-01-01")).toBe("2025-12-01");
  });

  it("knows the last earlier day and phrases the start", () => {
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(startPhrase(null, "2026-09-09")).toBe("ab heute");
    expect(startPhrase("2026-09-09", "2026-09-09")).toBe("ab heute");
    expect(startPhrase("2026-09-01", "2026-09-09")).toBe("ab dem 01.09.2026");
  });
});
