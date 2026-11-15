/**
 * Client of the heatmap of arrival and pickup times of the Träger portal
 * (#4714): when the children of each school arrive and are picked up, per
 * weekday and half hour, as the average of a day. Averages only, never a
 * child. Backend int64 IDs leave as strings.
 */

import { apiErrorFromBody, transportFetch } from "./api-error";
import { filenameFromDisposition } from "./file-download";
import type { TraegerSchool } from "./traeger-api";

export interface ArrivalPickupCell {
  /** Start of the half hour, minutes after midnight (Berlin wall clock). */
  readonly startMinute: number;
  /** Children who arrived in it on an average day. */
  readonly arrivals: number;
  /** Children who were picked up in it on an average day. */
  readonly pickups: number;
}

export interface ArrivalPickupWeekday {
  /** ISO weekday: 1 Monday to 7 Sunday. */
  readonly weekday: number;
  /** Days with an attendance the averages come from; 0 without data. */
  readonly days: number;
  readonly slots: readonly ArrivalPickupCell[];
}

export interface ArrivalPickupHeatmap {
  readonly weekdays: readonly ArrivalPickupWeekday[];
}

export interface TraegerSchoolArrivalPickup
  extends TraegerSchool, ArrivalPickupHeatmap {
  /** First day with an attendance in the period, `null` without any. */
  readonly firstDay: string | null;
}

export interface TraegerArrivalPickupTimes {
  /** The period, `YYYY-MM-DD`; it ends yesterday at the latest. */
  readonly from: string;
  readonly to: string;
  readonly slotMinutes: number;
  readonly firstMinute: number;
  readonly lastMinute: number;
  /** All schools together: the sum of their averages. */
  readonly all: ArrivalPickupHeatmap;
  readonly schools: readonly TraegerSchoolArrivalPickup[];
}

export interface ArrivalPickupPeriod {
  readonly from: string;
  readonly to: string;
}

interface BackendHeatmap {
  weekdays?: {
    weekday: number;
    days: number;
    slots?: { start_minute: number; arrivals: number; pickups: number }[];
  }[];
}

interface BackendTimes {
  from: string;
  to: string;
  slot_minutes: number;
  first_minute: number;
  last_minute: number;
  all: BackendHeatmap;
  schools?: (BackendHeatmap & {
    id: number;
    name: string;
    slug: string;
    subdomain: string;
    city?: string;
    first_day: string | null;
  })[];
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function query(period: ArrivalPickupPeriod): string {
  return new URLSearchParams({ from: period.from, to: period.to }).toString();
}

function heatmapOf(heatmap: BackendHeatmap): ArrivalPickupHeatmap {
  return {
    weekdays: (heatmap.weekdays ?? []).map((row) => ({
      weekday: row.weekday,
      days: row.days,
      slots: (row.slots ?? []).map((slot) => ({
        startMinute: slot.start_minute,
        arrivals: slot.arrivals,
        pickups: slot.pickups,
      })),
    })),
  };
}

/** The heatmap of every school of the Träger for the period. */
export async function fetchTraegerArrivalPickupTimes(
  period: ArrivalPickupPeriod,
): Promise<TraegerArrivalPickupTimes> {
  const response = await transportFetch(
    `/api/traeger/schools/arrival-pickup-times?${query(period)}`,
    { credentials: "include", cache: "no-store" },
  );
  const data = await readJson(response);
  if (!response.ok) {
    throw apiErrorFromBody(
      `Request failed (${response.status})`,
      response.status,
      data,
    );
  }
  const times = (data as { data: BackendTimes }).data;
  return {
    from: times.from,
    to: times.to,
    slotMinutes: times.slot_minutes,
    firstMinute: times.first_minute,
    lastMinute: times.last_minute,
    all: heatmapOf(times.all),
    schools: (times.schools ?? []).map((school) => ({
      id: String(school.id),
      name: school.name,
      slug: school.slug,
      subdomain: school.subdomain,
      city: school.city ?? "",
      firstDay: school.first_day ?? null,
      ...heatmapOf(school),
    })),
  };
}

/** The CSV export of the period, with the file name the backend chose. */
export async function downloadTraegerArrivalPickupTimes(
  period: ArrivalPickupPeriod,
): Promise<{ readonly blob: Blob; readonly filename: string | null }> {
  const response = await transportFetch(
    `/api/traeger/schools/arrival-pickup-times/export?${query(period)}`,
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    throw apiErrorFromBody(
      `Request failed (${response.status})`,
      response.status,
      await readJson(response),
    );
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response),
  };
}
