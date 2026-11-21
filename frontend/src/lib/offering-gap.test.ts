import { describe, expect, it } from "vitest";

import { offeringGapsResponseSchema } from "./contract/timetable.generated";
import { mapOfferingGaps } from "./offering-gap";

describe("mapOfferingGaps", () => {
  it("carries the Klassenfilter and the creation guard (#5343)", () => {
    const [gap] = mapOfferingGaps({
      gaps: [
        {
          offering: { id: "7", name: "Randstunde" },
          student_count: 3,
          school_classes: ["1a"],
          weekdays: [2],
          acknowledged: false,
          acknowledged_classes: [],
          new_series_classes: ["1a"],
          new_series_plans_covered: false,
        },
      ],
    });

    expect(gap?.offering).toEqual({ id: "7", name: "Randstunde" });
    expect(gap?.newSeriesClasses).toEqual(["1a"]);
    expect(gap?.newSeriesPlansCovered).toBe(false);
  });

  // The creation guard is a required field (#2353): an answer that says
  // nothing about it never reaches the hint, so no creation is offered.
  it("refuses an answer that says nothing about the creation guard", () => {
    const parsed = offeringGapsResponseSchema.safeParse({
      gaps: [
        {
          offering: { id: "7", name: "Randstunde" },
          student_count: 3,
          school_classes: null,
          weekdays: null,
          acknowledged: false,
          acknowledged_classes: null,
          new_series_classes: null,
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });
});
