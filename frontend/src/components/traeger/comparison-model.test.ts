import { describe, expect, it } from "vitest";
import type { ComparedSchool } from "~/lib/traeger-comparison-api";
import {
  comparisonRows,
  deviationLabel,
  formatMetric,
  ranking,
  spread,
} from "./comparison-model";

function school(
  id: string,
  name: string,
  values: ComparedSchool["values"],
): ComparedSchool {
  return { id, name, slug: id, subdomain: id, city: "", values };
}

const bach = school("1", "OGS Am Bach", { places_rate: 0.92, booked: 40 });
const linden = school("2", "OGS Lindenweg", { places_rate: 0.61 });
const berg = school("3", "OGS Bergstraße", { places_rate: 0.92, booked: 12 });

describe("formatMetric", () => {
  it("writes each figure in its own way and a missing one as a dash", () => {
    expect(formatMetric("places_rate", 0.845)).toBe("85 %");
    expect(formatMetric("booked", 18.46)).toBe("18,5");
    expect(formatMetric("booked_change", 3)).toBe("+3");
    expect(formatMetric("booked_change", -2)).toBe("-2");
    expect(formatMetric("booked_change", 0)).toBe("0");
    expect(formatMetric("places", 120)).toBe("120");
    expect(formatMetric("present", undefined)).toBe("–");
  });
});

describe("deviationLabel", () => {
  it("names the distance to the average in plain words", () => {
    expect(deviationLabel("places_rate", 0.92, 0.8, 3)).toBe(
      "12 Punkte über Schnitt",
    );
    expect(deviationLabel("places_rate", 0.79, 0.8, 3)).toBe(
      "1 Punkt unter Schnitt",
    );
    expect(deviationLabel("booked", 15.5, 18, 3)).toBe("2,5 unter Schnitt");
    expect(deviationLabel("booked", 18.02, 18, 3)).toBe("wie Schnitt");
  });

  it("says nothing without both figures or with one school", () => {
    expect(deviationLabel("booked", undefined, 18, 3)).toBeNull();
    expect(deviationLabel("booked", 18, undefined, 3)).toBeNull();
    expect(deviationLabel("booked", 18, 18, 1)).toBeNull();
  });
});

describe("ranking", () => {
  it("orders the schools with a figure, largest first, ties by name", () => {
    expect(
      ranking([bach, linden, berg], "places_rate").map((e) => e.school.name),
    ).toEqual(["OGS Am Bach", "OGS Bergstraße", "OGS Lindenweg"]);
    expect(
      ranking([bach, linden, berg], "booked").map((e) => e.school.id),
    ).toEqual(["1", "3"]);
  });

  it("finds the spread only between two figures", () => {
    const result = spread([bach, linden, berg], "places_rate");
    expect(result?.highest.school.id).toBe("1");
    expect(result?.lowest.school.id).toBe("2");
    expect(spread([bach, linden], "present")).toBeNull();
    expect(spread([bach], "places_rate")).toBeNull();
  });
});

describe("comparisonRows", () => {
  it("adds the average and the sum under two or more schools", () => {
    const rows = comparisonRows([bach, linden], { booked: 20 }, { booked: 40 });
    expect(rows.map((row) => row.kind)).toEqual([
      "school",
      "school",
      "average",
      "together",
    ]);
    expect(comparisonRows([bach], {}, {})).toHaveLength(1);
  });
});
