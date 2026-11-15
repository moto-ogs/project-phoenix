import { describe, expect, it } from "vitest";
import {
  absentBreakdown,
  absentTotal,
  dayLabel,
  decimalLabel,
  durationLabel,
  isEmptyDay,
  isWeekend,
  limitPeriod,
} from "./daily-attendance-model";
import type { DailyAttendanceFigures } from "~/lib/traeger-daily-attendance-api";

const figures = (
  overrides: Partial<DailyAttendanceFigures> = {},
): DailyAttendanceFigures => ({
  present: 0,
  sick: 0,
  excused: 0,
  classTrip: 0,
  withoutPickup: 0,
  firstArrival: null,
  lastPickup: null,
  averageMinutes: null,
  longestMinutes: null,
  ...overrides,
});

describe("daily attendance model", () => {
  it("labels a day with its short weekday", () => {
    expect(dayLabel("2026-11-09")).toBe("Mo, 09.11.");
    expect(dayLabel("2026-11-15")).toBe("So, 15.11.");
    expect(isWeekend("2026-11-14")).toBe(true);
    expect(isWeekend("2026-11-13")).toBe(false);
  });

  it("writes a length of stay in hours and minutes", () => {
    expect(durationLabel(null)).toBe("–");
    expect(durationLabel(45)).toBe("45 Min.");
    expect(durationLabel(360)).toBe("6 Std.");
    expect(durationLabel(452)).toBe("7 Std. 32 Min.");
  });

  it("adds up and names the reported absences", () => {
    const day = figures({ present: 4, sick: 2, classTrip: 1 });
    expect(absentTotal(day)).toBe(3);
    expect(absentBreakdown(day)).toBe("2 krank · 1 Klassenfahrt");
    expect(isEmptyDay(day)).toBe(false);
    expect(isEmptyDay(figures())).toBe(true);
    expect(isEmptyDay(figures({ excused: 1 }))).toBe(false);
  });

  it("writes a German decimal only where needed", () => {
    expect(decimalLabel(12)).toBe("12");
    expect(decimalLabel(12.5)).toBe("12,5");
  });

  it("keeps a period at 31 days and keeps its end", () => {
    expect(limitPeriod({ from: "2026-10-01", to: "2026-10-31" })).toEqual({
      period: { from: "2026-10-01", to: "2026-10-31" },
      clamped: false,
    });
    expect(limitPeriod({ from: "2026-09-01", to: "2026-10-31" })).toEqual({
      period: { from: "2026-10-01", to: "2026-10-31" },
      clamped: true,
    });
  });
});
