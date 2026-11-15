import { describe, expect, it } from "vitest";
import type { ArrivalPickupHeatmap } from "~/lib/traeger-arrival-pickup-api";
import {
  childrenLabel,
  childrenPerDay,
  clockLabel,
  formatAverage,
  hasData,
  hourTick,
  peakLabel,
  peakOf,
} from "./arrival-pickup-model";

const heatmap: ArrivalPickupHeatmap = {
  weekdays: [
    {
      weekday: 1,
      days: 4,
      slots: [
        { startMinute: 450, arrivals: 12, pickups: 0 },
        { startMinute: 690, arrivals: 20, pickups: 2 },
        { startMinute: 900, arrivals: 0, pickups: 18 },
      ],
    },
    {
      weekday: 2,
      days: 4,
      slots: [
        { startMinute: 450, arrivals: 10, pickups: 0 },
        { startMinute: 690, arrivals: 20, pickups: 0 },
        { startMinute: 900, arrivals: 0, pickups: 25.5 },
      ],
    },
    {
      weekday: 3,
      days: 0,
      slots: [
        { startMinute: 450, arrivals: 0, pickups: 0 },
        { startMinute: 690, arrivals: 0, pickups: 0 },
        { startMinute: 900, arrivals: 0, pickups: 0 },
      ],
    },
  ],
};

describe("arrival and pickup model", () => {
  it("finds the busiest half hour, the earlier one on a tie", () => {
    expect(peakOf(heatmap, "arrivals")).toEqual({
      weekday: 1,
      startMinute: 690,
      value: 20,
    });
    expect(peakOf(heatmap, "pickups")).toEqual({
      weekday: 2,
      startMinute: 900,
      value: 25.5,
    });
    expect(peakLabel({ weekday: 2, startMinute: 900, value: 1 })).toBe(
      "Di 15:00",
    );
  });

  it("has no peak and no day without a child", () => {
    const empty: ArrivalPickupHeatmap = { weekdays: [heatmap.weekdays[2]!] };
    expect(peakOf(empty, "arrivals")).toBeNull();
    expect(childrenPerDay(empty)).toBeNull();
    expect(hasData(empty)).toBe(false);
    expect(hasData(heatmap)).toBe(true);
  });

  it("averages the children of a day over the weekdays with data", () => {
    // Monday 32, Tuesday 30; Wednesday has no data and does not count.
    expect(childrenPerDay(heatmap)).toBe(31);
  });

  it("writes German clock times and averages", () => {
    expect(clockLabel(450)).toBe("07:30");
    expect(hourTick(420)).toBe("7:00");
    expect(hourTick(450)).toBe("");
    expect(formatAverage(23.4)).toBe("23,4");
    expect(formatAverage(0.4)).toBe("0,4");
    expect(childrenLabel(1)).toBe("1 Kind");
    expect(childrenLabel(2.5)).toBe("2,5 Kinder");
  });
});
