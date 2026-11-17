/**
 * Reine Rechnung der Auslastung über die Zeit (#4713): Zeiträume, Bündelung
 * der Wochentage zu Tagen, Wochen oder Monaten, Zeilen je Reiter und die
 * Kennzahlen über dem Diagramm. Die Definitionen der Zahlen stehen am
 * Backend (`traegerview.Utilization`); hier wird nur gemittelt und
 * zusammengezählt. Ein Tag ohne Zahl (`null`) zählt nie als 0.
 */

import { isoWeekNumber, parseISODate, toISODate } from "~/lib/date-helpers";
import type {
  SchoolUtilization,
  UtilizationOffering,
  UtilizationRoom,
  UtilizationWindow,
} from "~/lib/traeger-utilization-api";

export type UtilizationGranularity = "day" | "week" | "month";

export interface UtilizationPreset {
  readonly label: string;
  readonly window: UtilizationWindow;
}

/** Der Tag `days` Tage nach `iso`, rückwärts mit negativer Zahl. */
export function shiftDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/**
 * Derselbe Tag `months` Monate später oder früher. Fehlt der Tag im
 * Zielmonat (31.09., 30.02.), ist es dessen letzter Tag: `setMonth` allein
 * liefe in den Folgemonat über.
 */
function shiftMonths(iso: string, months: number): string {
  const date = parseISODate(iso);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
  ).getDate();
  date.setDate(Math.min(day, lastDay));
  return toISODate(date);
}

/** Das Schuljahr beginnt am 1. August. */
function schoolYearStart(today: string): string {
  const [year = 0, month = 1] = today.split("-").map(Number);
  return `${month >= 8 ? year : year - 1}-08-01`;
}

/** Die Zeiträume zur Auswahl, jeder endet heute. */
export function utilizationPresets(today: string): UtilizationPreset[] {
  return [
    {
      label: "Letzte 4 Wochen",
      window: { from: shiftDays(today, -27), to: today },
    },
    {
      label: "Letzte 3 Monate",
      window: { from: shiftDays(shiftMonths(today, -3), 1), to: today },
    },
    {
      label: "Dieses Schuljahr",
      window: { from: schoolYearStart(today), to: today },
    },
    {
      label: "Letzte 12 Monate",
      window: { from: shiftDays(shiftMonths(today, -12), 1), to: today },
    },
  ];
}

/** Bis ein Monat Tage, bis vier Monate Wochen, darüber Monate. */
export function defaultGranularity(windowDays: number): UtilizationGranularity {
  if (windowDays <= 31) return "day";
  if (windowDays <= 124) return "week";
  return "month";
}

/** Tage von `from` bis `to`, negativ rückwärts. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000,
  );
}

/** Kalendertage von `from` bis `to`, beide mitgezählt. */
export function windowLength(window: UtilizationWindow): number {
  return daysBetween(window.from, window.to) + 1;
}

export interface UtilizationBucket {
  readonly key: string;
  /** Kurz, für die Achse: „Mo 07.09.“, „KW 37“, „Sep.“ */
  readonly label: string;
  /** Lang, für den Tooltip: „KW 37 · 07.09. bis 11.09.2026“ */
  readonly fullLabel: string;
  /** Die Stellen der Tage in `TraegerUtilization.days`. */
  readonly indices: readonly number[];
}

const WEEKDAY = new Intl.DateTimeFormat("de-DE", { weekday: "short" });
const MONTH_SHORT = new Intl.DateTimeFormat("de-DE", { month: "short" });
const MONTH_LONG = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
});

function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

function bucketKey(day: string, granularity: UtilizationGranularity): string {
  if (granularity === "day") return day;
  if (granularity === "month") return day.slice(0, 7);
  // The Monday of the week: a week across New Year stays one bucket, which
  // a key from the calendar year split in two.
  const date = parseISODate(day);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return toISODate(date);
}

function bucketLabels(
  days: readonly string[],
  granularity: UtilizationGranularity,
): { label: string; fullLabel: string } {
  const first = days[0] ?? "";
  const last = days[days.length - 1] ?? first;
  const date = parseISODate(first);
  if (granularity === "day") {
    const weekday = WEEKDAY.format(date).replace(".", "");
    return {
      label: `${weekday} ${dayMonth(first)}`,
      fullLabel: `${weekday}, ${dayMonth(first)}${first.slice(0, 4)}`,
    };
  }
  if (granularity === "month") {
    return {
      label: MONTH_SHORT.format(date),
      fullLabel: MONTH_LONG.format(date),
    };
  }
  const week = `KW ${isoWeekNumber(first)}`;
  return {
    label: week,
    fullLabel: `${week} · ${dayMonth(first)} bis ${dayMonth(last)}${last.slice(0, 4)}`,
  };
}

/** Bündelt die Wochentage des Fensters zu Tagen, Kalenderwochen oder Monaten. */
export function utilizationBuckets(
  days: readonly string[],
  granularity: UtilizationGranularity,
): UtilizationBucket[] {
  const buckets: { key: string; indices: number[] }[] = [];
  days.forEach((day, index) => {
    const key = bucketKey(day, granularity);
    const last = buckets[buckets.length - 1];
    if (last?.key === key) last.indices.push(index);
    else buckets.push({ key, indices: [index] });
  });
  return buckets.map((bucket) => ({
    key: bucket.key,
    indices: bucket.indices,
    ...bucketLabels(
      bucket.indices.map((index) => days[index] ?? ""),
      granularity,
    ),
  }));
}

/** Der Mittelwert der Tage mit Zahl; `null`, wenn kein Tag eine hat. */
function mean(
  values: readonly (number | null | undefined)[],
  indices?: readonly number[],
): number | null {
  let sum = 0;
  let count = 0;
  for (const index of indices ?? values.keys()) {
    const value = values[index];
    if (value === null || value === undefined) continue;
    sum += value;
    count++;
  }
  return count === 0 ? null : sum / count;
}

function maximum(values: readonly (number | null)[]): number | null {
  let best: number | null = null;
  for (const value of values) {
    if (value !== null && (best === null || value > best)) best = value;
  }
  return best;
}

/** Die Summe der Schulen je Tag; `null`, wo keine Schule eine Zahl hat. */
function sumPerDay(
  series: readonly (readonly (number | null)[])[],
  dayCount: number,
): (number | null)[] {
  return Array.from({ length: dayCount }, (_, index) => {
    let sum: number | null = null;
    for (const values of series) {
      const value = values[index];
      if (value !== null && value !== undefined) sum = (sum ?? 0) + value;
    }
    return sum;
  });
}

function share(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  return part / whole;
}

export interface UtilizationFigures {
  readonly places: number;
  readonly averageBookedPlaces: number | null;
  /** Ø belegte Plätze über die Plätze; `null` ohne Platzgrenze. */
  readonly utilization: number | null;
  /** Der Tag mit dem größten Anteil belegter Plätze. */
  readonly peak: { readonly day: string; readonly share: number } | null;
  /** Kinder mit Check-in, Ø je Tag mit Zahl. */
  readonly averagePresent: number | null;
  /** Angebote mit Grenze, die an mindestens einem Tag voll waren. */
  readonly fullOfferings: number;
  readonly limitedOfferings: number;
}

/** Die Kennzahlen über den Schulen der Auswahl und das ganze Fenster. */
export function utilizationFigures(
  schools: readonly SchoolUtilization[],
  days: readonly string[],
): UtilizationFigures {
  const places = schools.reduce((sum, school) => sum + school.places, 0);
  const bookedPlaces = sumPerDay(
    schools.map((school) => school.bookedPlaces),
    days.length,
  );
  const averageBookedPlaces = schools.length > 0 ? mean(bookedPlaces) : null;
  let peak: UtilizationFigures["peak"] = null;
  if (places > 0) {
    bookedPlaces.forEach((value, index) => {
      const day = days[index];
      if (value === null || day === undefined) return;
      if (peak === null || value / places > peak.share) {
        peak = { day, share: value / places };
      }
    });
  }
  const limited = schools.flatMap((school) =>
    school.offerings.filter((offering) => offering.capacity !== null),
  );
  return {
    places,
    averageBookedPlaces,
    utilization: share(averageBookedPlaces, places),
    peak,
    averagePresent: mean(
      sumPerDay(
        schools.map((school) => school.present),
        days.length,
      ),
    ),
    fullOfferings: limited.filter((offering) =>
      offering.booked.some((booked) => booked >= (offering.capacity ?? 0)),
    ).length,
    limitedOfferings: limited.length,
  };
}

export interface UtilizationSchoolRow {
  readonly school: SchoolUtilization;
  readonly averageBookedPlaces: number;
  readonly utilization: number | null;
  readonly peakUtilization: number | null;
  readonly averageBooked: number;
  readonly averagePresent: number | null;
}

export function schoolRows(
  schools: readonly SchoolUtilization[],
  days: readonly string[],
): UtilizationSchoolRow[] {
  return schools.map((school) => {
    const averageBookedPlaces = mean(school.bookedPlaces) ?? 0;
    return {
      school,
      averageBookedPlaces,
      utilization: share(averageBookedPlaces, school.places),
      peakUtilization: share(maximum(school.bookedPlaces), school.places),
      averageBooked: mean(school.booked) ?? 0,
      averagePresent: days.length > 0 ? mean(school.present) : null,
    };
  });
}

export interface UtilizationOfferingRow {
  readonly key: string;
  readonly school: SchoolUtilization;
  readonly offering: UtilizationOffering;
  readonly name: string;
  readonly averageBooked: number;
  readonly utilization: number | null;
  readonly maxBooked: number;
  /** Tage, an denen alle Plätze vergeben waren. */
  readonly fullDays: number;
}

export function offeringRows(
  schools: readonly SchoolUtilization[],
): UtilizationOfferingRow[] {
  return schools.flatMap((school) =>
    school.offerings.map((offering) => {
      const averageBooked = mean(offering.booked) ?? 0;
      return {
        key: `${school.id}-${offering.id}`,
        school,
        offering,
        name: offering.name,
        averageBooked,
        utilization: share(averageBooked, offering.capacity),
        maxBooked: maximum(offering.booked) ?? 0,
        fullDays:
          offering.capacity === null
            ? 0
            : offering.booked.filter(
                (booked) => booked >= (offering.capacity ?? 0),
              ).length,
      };
    }),
  );
}

export interface UtilizationRoomRow {
  readonly key: string;
  readonly school: SchoolUtilization;
  readonly room: UtilizationRoom;
  readonly name: string;
  /** Tage mit Zahlen; ohne sie sagt der Raum nichts. */
  readonly dataDays: number;
  readonly averageChildren: number | null;
  readonly averagePeak: number | null;
  readonly maxPeak: number | null;
  readonly utilization: number | null;
}

export function roomRows(
  schools: readonly SchoolUtilization[],
): UtilizationRoomRow[] {
  return schools.flatMap((school) =>
    school.rooms.map((room) => {
      const averagePeak = mean(room.peak);
      return {
        key: `${school.id}-${room.id}`,
        school,
        room,
        name: room.name,
        dataDays: room.peak.filter((value) => value !== null).length,
        averageChildren: mean(room.children),
        averagePeak,
        maxPeak: maximum(room.peak),
        utilization: share(averagePeak, room.capacity),
      };
    }),
  );
}

/** Ein Punkt des Diagramms: die Mittelwerte eines Tages, einer Woche, eines Monats. */
export interface UtilizationPoint {
  readonly key: string;
  readonly label: string;
  readonly fullLabel: string;
  /** Die Plätze; `null` ohne Platzgrenze. */
  readonly places: number | null;
  /** Belegte Plätze, gebuchte Kinder oder die Höchstbelegung eines Raums. */
  readonly belegt: number | null;
  /** Kinder mit Check-in (Standorte). */
  readonly anwesend?: number | null;
  /** Kinder mit Besuch im Raum (Räume). */
  readonly kinder?: number | null;
}

function points(
  buckets: readonly UtilizationBucket[],
  places: number | null,
  series: Readonly<
    Record<
      "belegt" | "anwesend" | "kinder",
      readonly (number | null)[] | undefined
    >
  >,
): UtilizationPoint[] {
  return buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    fullLabel: bucket.fullLabel,
    places,
    belegt: series.belegt ? mean(series.belegt, bucket.indices) : null,
    ...(series.anwesend
      ? { anwesend: mean(series.anwesend, bucket.indices) }
      : {}),
    ...(series.kinder ? { kinder: mean(series.kinder, bucket.indices) } : {}),
  }));
}

function dayCount(buckets: readonly UtilizationBucket[]): number {
  return buckets.reduce((count, bucket) => count + bucket.indices.length, 0);
}

export const utilizationSeries = {
  /** Plätze, belegte Plätze und anwesende Kinder der Schulen zusammen. */
  schools(
    schools: readonly SchoolUtilization[],
    buckets: readonly UtilizationBucket[],
  ): UtilizationPoint[] {
    const days = dayCount(buckets);
    const places = schools.reduce((sum, school) => sum + school.places, 0);
    return points(buckets, places > 0 ? places : null, {
      belegt: sumPerDay(
        schools.map((school) => school.bookedPlaces),
        days,
      ),
      anwesend: sumPerDay(
        schools.map((school) => school.present),
        days,
      ),
      kinder: undefined,
    });
  },
  /** Plätze und gebuchte Kinder der Angebote zusammen. */
  offerings(
    offerings: readonly UtilizationOffering[],
    buckets: readonly UtilizationBucket[],
  ): UtilizationPoint[] {
    const days = dayCount(buckets);
    const limited = offerings.filter((offering) => offering.capacity !== null);
    const places = limited.reduce(
      (sum, offering) => sum + (offering.capacity ?? 0),
      0,
    );
    // With a limit somewhere, the chart compares limited places only.
    const counted = limited.length > 0 ? limited : offerings;
    return points(buckets, places > 0 ? places : null, {
      belegt: sumPerDay(
        counted.map((offering) => offering.booked),
        days,
      ),
      anwesend: undefined,
      kinder: undefined,
    });
  },
  /** Plätze, Höchstbelegung und Kinder eines Raums. */
  room(
    room: UtilizationRoom,
    buckets: readonly UtilizationBucket[],
  ): UtilizationPoint[] {
    return points(buckets, room.capacity, {
      belegt: room.peak,
      anwesend: undefined,
      kinder: room.children,
    });
  },
};
