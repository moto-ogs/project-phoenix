import { describe, expect, it } from "vitest";
import { dayExceptionKeepsAway } from "./day-planning-helper";

// Die Kinderkarten lassen die Angebote des Tages weg, wenn eine Ausnahme
// ohne Uhrzeit das Kind fernhält (#6487, #8194). Anwesenheit geht vor.
describe("dayExceptionKeepsAway", () => {
  const home = { current_location: "Zuhause" };
  const none = { arrivalAbsent: false, pickupAbsent: false };

  it("holds for an arrival or a pickup exception without a time", () => {
    expect(dayExceptionKeepsAway(home, none)).toBe(false);
    expect(dayExceptionKeepsAway(home, { ...none, arrivalAbsent: true })).toBe(
      true,
    );
    expect(dayExceptionKeepsAway(home, { ...none, pickupAbsent: true })).toBe(
      true,
    );
  });

  it("lets actual attendance and a return to class win", () => {
    const absent = { arrivalAbsent: true, pickupAbsent: true };
    expect(
      dayExceptionKeepsAway({ current_location: "Anwesend - Aula" }, absent),
    ).toBe(false);
    expect(
      dayExceptionKeepsAway(
        { current_location: "", actual_arrival_time: "11:40" },
        absent,
      ),
    ).toBe(false);
    expect(
      dayExceptionKeepsAway({ current_location: "Im Unterricht" }, absent),
    ).toBe(false);
  });

  it("reads no attendance into another planning day", () => {
    expect(
      dayExceptionKeepsAway(
        { current_location: "Anwesend - Aula" },
        { arrivalAbsent: true, pickupAbsent: false },
        { ignoreCurrentAttendance: true },
      ),
    ).toBe(true);
  });
});
