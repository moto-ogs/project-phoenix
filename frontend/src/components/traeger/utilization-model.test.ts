import { describe, expect, it } from "vitest";
import type {
  SchoolUtilization,
  TraegerUtilization,
} from "~/lib/traeger-utilization-api";
import {
  defaultGranularity,
  offeringRows,
  roomRows,
  schoolRows,
  utilizationBuckets,
  utilizationFigures,
  utilizationPresets,
  utilizationSeries,
} from "./utilization-model";

// Mon 2026-09-07 to Wed 2026-09-16: eight weekdays over two calendar weeks.
const DAYS = [
  "2026-09-07",
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
  "2026-09-11",
  "2026-09-14",
  "2026-09-15",
  "2026-09-16",
];

function school(overrides: Partial<SchoolUtilization>): SchoolUtilization {
  return {
    id: "1",
    name: "OGS Am Bach",
    slug: "bach",
    subdomain: "bach",
    city: "Lindenstadt",
    places: 20,
    booked: DAYS.map(() => 18),
    bookedPlaces: DAYS.map(() => 16),
    present: DAYS.map(() => 12),
    attendanceFrom: "2026-01-01",
    roomDataFrom: "2026-09-01",
    offerings: [],
    rooms: [],
    ...overrides,
  };
}

const BACH = school({
  bookedPlaces: [10, 12, 14, 16, 18, 20, 20, 10],
  present: [8, null, 12, 12, 12, 14, 16, null],
  offerings: [
    {
      id: "11",
      name: "OGS bis 16 Uhr",
      capacity: 20,
      active: true,
      booked: [10, 12, 14, 16, 18, 20, 20, 10],
    },
    {
      id: "12",
      name: "Hausaufgaben",
      capacity: null,
      active: true,
      booked: DAYS.map(() => 4),
    },
  ],
  rooms: [
    {
      id: "21",
      name: "Turnhalle",
      capacity: 30,
      children: [null, null, 20, 10, 0, 30, 30, null],
      peak: [null, null, 15, 6, 0, 30, 24, null],
    },
  ],
});

const LINDEN = school({
  id: "2",
  name: "OGS Lindenweg",
  places: 10,
  bookedPlaces: DAYS.map(() => 5),
  present: DAYS.map(() => null),
  offerings: [
    {
      id: "31",
      name: "OGS",
      capacity: 10,
      active: true,
      booked: DAYS.map(() => 5),
    },
  ],
});

const UTILIZATION: TraegerUtilization = {
  from: "2026-09-07",
  to: "2026-09-16",
  days: DAYS,
  asOf: "2026-09-16T10:00:00Z",
  schools: [BACH, LINDEN],
};

describe("utilization presets", () => {
  it("ends every window today and starts the school year on 1 August", () => {
    const presets = utilizationPresets("2026-11-15");
    expect(presets.map((preset) => preset.label)).toEqual([
      "Letzte 4 Wochen",
      "Letzte 3 Monate",
      "Dieses Schuljahr",
      "Letzte 12 Monate",
    ]);
    expect(presets.map((preset) => preset.window)).toEqual([
      { from: "2026-10-19", to: "2026-11-15" },
      { from: "2026-08-16", to: "2026-11-15" },
      { from: "2026-08-01", to: "2026-11-15" },
      { from: "2025-11-16", to: "2026-11-15" },
    ]);
    // Before August the school year began the year before.
    expect(utilizationPresets("2026-03-02")[2]?.window.from).toBe("2025-08-01");
  });

  it("keeps a month window whole when the earlier month is shorter", () => {
    // 31.12. minus drei Monate gibt es nicht als 31.09.: Das Fenster beginnt
    // am Tag nach dem 30.09., nicht einen Tag später.
    const yearEnd = utilizationPresets("2026-12-31");
    expect(yearEnd[1]?.window).toEqual({
      from: "2026-10-01",
      to: "2026-12-31",
    });
    expect(yearEnd[3]?.window).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    // 31.05. minus drei Monate: der Februar endet am 28.
    expect(utilizationPresets("2026-05-31")[1]?.window.from).toBe("2026-03-01");
    // Vom Schalttag zwölf Monate zurück: der 28.02. des Vorjahres.
    expect(utilizationPresets("2028-02-29")[3]?.window.from).toBe("2027-03-01");
  });

  it("picks days for a month, weeks for a season and months beyond", () => {
    expect(defaultGranularity(23)).toBe("day");
    expect(defaultGranularity(66)).toBe("week");
    expect(defaultGranularity(200)).toBe("month");
  });
});

describe("utilizationBuckets", () => {
  it("groups the days into calendar weeks and months", () => {
    expect(utilizationBuckets(DAYS, "day")).toHaveLength(8);
    const weeks = utilizationBuckets(DAYS, "week");
    expect(weeks.map((week) => week.label)).toEqual(["KW 37", "KW 38"]);
    expect(weeks[0]?.indices).toEqual([0, 1, 2, 3, 4]);
    expect(weeks[1]?.fullLabel).toBe("KW 38 · 14.09. bis 16.09.2026");
    const months = utilizationBuckets(["2026-08-31", ...DAYS], "month");
    expect(months.map((month) => month.fullLabel)).toEqual([
      "August 2026",
      "September 2026",
    ]);
  });

  it("keeps a week across New Year in one bucket", () => {
    // Mon 2025-12-29 to Fri 2026-01-02 is ISO week 1 of 2026.
    const days = [
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-05",
    ];
    const weeks = utilizationBuckets(days, "week");
    expect(weeks.map((week) => week.label)).toEqual(["KW 1", "KW 2"]);
    expect(weeks[0]?.indices).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("utilizationFigures", () => {
  it("averages the places of every school and finds the fullest day", () => {
    const figures = utilizationFigures(UTILIZATION.schools, DAYS);
    expect(figures.places).toBe(30);
    // Ø belegt: Bach 15, Linden 5 → 20 of 30.
    expect(figures.averageBookedPlaces).toBe(20);
    expect(figures.utilization).toBeCloseTo(20 / 30);
    expect(figures.peak).toEqual({ day: "2026-09-14", share: 25 / 30 });
    // Anwesend only where a school has data: Bach on six days.
    expect(figures.averagePresent).toBeCloseTo(74 / 6);
    expect(figures.fullOfferings).toBe(1);
    expect(figures.limitedOfferings).toBe(2);
  });

  it("has no share without places and no attendance without data", () => {
    const figures = utilizationFigures([LINDEN], DAYS);
    expect(figures.averagePresent).toBeNull();
    const none = utilizationFigures([], DAYS);
    expect(none.utilization).toBeNull();
    expect(none.peak).toBeNull();
  });
});

describe("rows", () => {
  it("lists each school with its average and peak", () => {
    const [bach, linden] = schoolRows(UTILIZATION.schools, DAYS);
    expect(bach?.averageBookedPlaces).toBe(15);
    expect(bach?.utilization).toBeCloseTo(0.75);
    expect(bach?.peakUtilization).toBe(1);
    expect(bach?.averagePresent).toBeCloseTo(74 / 6);
    expect(linden?.averagePresent).toBeNull();
  });

  it("lists each offering, unlimited ones without a share", () => {
    const rows = offeringRows(UTILIZATION.schools);
    expect(rows.map((row) => row.name)).toEqual([
      "OGS bis 16 Uhr",
      "Hausaufgaben",
      "OGS",
    ]);
    expect(rows[0]?.fullDays).toBe(2);
    expect(rows[0]?.maxBooked).toBe(20);
    expect(rows[1]?.utilization).toBeNull();
    expect(rows[2]?.utilization).toBe(0.5);
  });

  it("averages rooms over the days with data only", () => {
    const [gym] = roomRows(UTILIZATION.schools);
    expect(gym?.dataDays).toBe(5);
    expect(gym?.averagePeak).toBe(15);
    expect(gym?.maxPeak).toBe(30);
    expect(gym?.utilization).toBe(0.5);
  });
});

describe("utilizationSeries", () => {
  it("sums the schools per week, attendance only where there is data", () => {
    const weeks = utilizationBuckets(DAYS, "week");
    const series = utilizationSeries.schools(UTILIZATION.schools, weeks);
    expect(series[0]).toMatchObject({
      label: "KW 37",
      places: 30,
      belegt: 19,
      anwesend: 11,
    });
    expect(series[1]?.belegt).toBeCloseTo(50 / 3 + 5);
  });

  it("shows one room with its peak and children", () => {
    const series = utilizationSeries.room(
      BACH.rooms[0]!,
      utilizationBuckets(DAYS, "day"),
    );
    expect(series[0]).toMatchObject({ places: 30, belegt: null, kinder: null });
    expect(series[2]).toMatchObject({ belegt: 15, kinder: 20 });
  });
});
