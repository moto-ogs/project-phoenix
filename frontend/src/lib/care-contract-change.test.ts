import { describe, expect, it } from "vitest";
import { careChanges, type CareOfDay } from "./care-contract-change";

const care = (
  weekday: CareOfDay["weekday"],
  moduleName: string,
  endsAt: string,
  lastDay: string | null = null,
): CareOfDay => ({ weekday, moduleName, endsAt, lastDay });

describe("careChanges", () => {
  it("names per weekday what was added, dropped, changed or stays", () => {
    const before = [
      care("mon", "Ganztag", "16:00"),
      care("tue", "Ganztag", "16:00"),
      care("wed", "Kurzbetreuung", "14:00"),
    ];
    const after = [
      care("mon", "Ganztag", "16:00"),
      care("wed", "Ganztag", "16:00"),
      care("thu", "Spätbetreuung", "17:00"),
    ];

    expect(
      careChanges(before, after).map((day) => [day.weekday, day.kind]),
    ).toEqual([
      ["mon", "same"],
      ["tue", "dropped"],
      ["wed", "changed"],
      ["thu", "added"],
      ["fri", "same"],
    ]);
  });

  it("keeps the care of both versions for a changed day", () => {
    const [, , wednesday] = careChanges(
      [care("wed", "Kurzbetreuung", "14:00")],
      [care("wed", "Ganztag", "16:00")],
    );

    expect(wednesday?.before.map((entry) => entry.moduleName)).toEqual([
      "Kurzbetreuung",
    ]);
    expect(wednesday?.after.map((entry) => entry.moduleName)).toEqual([
      "Ganztag",
    ]);
  });

  it("shows a weekend day one of the versions books", () => {
    const days = careChanges([care("sat", "Samstagsbetreuung", "12:00")], []);

    expect(days.map((day) => day.weekday)).toEqual([
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
      "sat",
    ]);
    expect(days.at(-1)?.kind).toBe("dropped");
  });

  it("counts another last day of a module as a change", () => {
    const [monday] = careChanges(
      [care("mon", "Ganztag", "16:00", "2028-01-31")],
      [care("mon", "Ganztag", "16:00")],
    );

    expect(monday?.kind).toBe("changed");
  });
});
