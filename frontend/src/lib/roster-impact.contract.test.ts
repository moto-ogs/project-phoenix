import { describe, expect, it } from "vitest";
import { mapRosterImpact } from "./roster-impact";

// Go writes empty lists and days as null (#2353): an override without its
// first day names no day to show.
describe("roster impact as the contract decodes it", () => {
  it("reads null lists and leaves an override without a day out", () => {
    const impact = mapRosterImpact({
      effective_from: "2026-12-01",
      adjusted: null,
      not_adjusted: null,
      pickup_overrides: [
        {
          weekday: 1,
          date: null,
          stored_time: "15:00",
          booked_time: "16:00",
          reset_now: false,
        },
      ],
    });
    expect(impact).toEqual({
      effectiveFrom: "2026-12-01",
      adjusted: [],
      notAdjusted: [],
      pickupOverrides: [],
    });
  });
});
