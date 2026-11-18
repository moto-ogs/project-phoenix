import { describe, expect, it } from "vitest";

import { ApiError } from "./api-error";
import {
  describeWorkingTimeWarning,
  formatWorkingHours,
  workingTimeBody,
  workingTimeRefusalOf,
} from "./working-time";

describe("working-time", () => {
  it("reads the hints of a refused shift and ignores other errors", () => {
    const refusal = workingTimeRefusalOf(
      new ApiError("refused", 409, {
        code: "workforce.shift_working_time_warning",
        details: {
          warnings: [
            {
              kind: "rest_shortened",
              date: "2026-09-08",
              minutes: 600,
              limit: 660,
              needs_reason: false,
            },
            { kind: "unknown", date: "2026-09-08" },
          ],
        },
      }),
    );
    expect(refusal).toEqual({
      reasonRequired: false,
      warnings: [
        {
          kind: "rest_shortened",
          date: "2026-09-08",
          minutes: 600,
          limit: 660,
          needsReason: false,
        },
      ],
    });
    expect(
      workingTimeRefusalOf(
        new ApiError("overlap", 409, {
          code: "workforce.shift_overlaps_other_site",
        }),
      ),
    ).toBeNull();
    expect(workingTimeRefusalOf(new Error("x"))).toBeNull();
  });

  it("names every kind in one plain sentence", () => {
    const at = (
      kind: Parameters<typeof describeWorkingTimeWarning>[0]["kind"],
      minutes: number,
      limit: number,
    ) =>
      describeWorkingTimeWarning({
        kind,
        date: "2026-09-08",
        minutes,
        limit,
        needsReason: true,
      });
    expect(at("daily_maximum", 630, 600)).toBe(
      "Di., 08.09.: 10,5 Stunden Arbeit geplant. Erlaubt sind 10 Stunden am Tag.",
    );
    expect(at("break_too_short", 15, 30)).toBe(
      "Di., 08.09.: 15 Minuten Pause geplant. Nötig sind 30 Minuten.",
    );
    expect(at("rest_period", 570, 660)).toBe(
      "Vor Di., 08.09.: nur 9,5 Stunden Ruhezeit. Nötig sind 11 Stunden.",
    );
    expect(at("rest_shortened", 600, 660)).toBe(
      "Vor Di., 08.09.: 10 Stunden Ruhezeit statt 11 Stunden. Plane dafür einen Ausgleich ein.",
    );
    expect(at("above_soll", 1500, 1200)).toBe(
      "Woche ab Di., 08.09.: 25 Stunden geplant. Das Soll ist 20 Stunden.",
    );
    expect(formatWorkingHours(60)).toBe("1 Stunde");
    expect(formatWorkingHours(1)).toBe("1 Minute");
  });

  it("sends the answer only once the planner confirmed", () => {
    expect(workingTimeBody()).toEqual({});
    expect(workingTimeBody({ confirmed: false, reason: "x" })).toEqual({});
    expect(
      workingTimeBody({ confirmed: true, reason: "  Elternabend " }),
    ).toEqual({
      working_time_confirmed: true,
      working_time_reason: "Elternabend",
    });
  });
});
