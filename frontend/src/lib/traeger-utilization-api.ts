import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Client of the Träger's utilization over time (#4713, ADR 0241): for a
 * window, one value per weekday for every school, care offering and room.
 * Counts and the names of offerings and rooms only; the children of one
 * school by name are a separate read behind „Verträge verwalten“, written to
 * the school's access log. Backend int64 IDs leave as strings.
 */

import {
  downloadTraegerList,
  type TraegerListFile,
  type TraegerListFormat,
  listExportQuery,
} from "./traeger-list-export";
import type * as traegerSchoolsContract from "./contract/traeger-schools.generated";
import { requiredDay } from "./contract/required-day";
import type { TraegerSchool } from "./traeger-api";

/** The right that opens the children of a school by name (ADR 0156, 0241). */
export const UTILIZATION_NAMES_RIGHT = "traeger_contracts:manage";

export interface UtilizationOffering {
  readonly id: string;
  readonly name: string;
  /** The places of the offering; `null` without a limit. */
  readonly capacity: number | null;
  readonly active: boolean;
  /** Booked children per day of `TraegerUtilization.days`. */
  readonly booked: readonly number[];
}

export interface UtilizationRoom {
  readonly id: string;
  readonly name: string;
  readonly capacity: number | null;
  /** Children with a visit per day; `null` without data that day. */
  readonly children: readonly (number | null)[];
  /** The most children at the same time per day; `null` without data. */
  readonly peak: readonly (number | null)[];
}

export interface SchoolUtilization extends TraegerSchool {
  /** The sum of the limits of the offerings with a limit. */
  readonly places: number;
  /** Booked children per day, each child once over all offerings. */
  readonly booked: readonly number[];
  /** Booked children of the offerings with a limit, per day. */
  readonly bookedPlaces: readonly number[];
  /** Children with a check-in per day; `null` without data that day. */
  readonly present: readonly (number | null)[];
  /** The first day the school keeps a check-in of, `YYYY-MM-DD`. */
  readonly attendanceFrom: string | null;
  /** The first day with a counted room visit, `YYYY-MM-DD`. */
  readonly roomDataFrom: string | null;
  readonly offerings: readonly UtilizationOffering[];
  readonly rooms: readonly UtilizationRoom[];
}

export interface TraegerUtilization {
  readonly from: string;
  readonly to: string;
  /** The weekdays of the window, `YYYY-MM-DD`; every series follows them. */
  readonly days: readonly string[];
  readonly asOf: string;
  readonly schools: readonly SchoolUtilization[];
}

export interface UtilizationChild {
  readonly studentId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly schoolClass: string;
  readonly groupName: string;
  readonly careDays: number;
  readonly presentDays: number;
  readonly sickDays: number;
  readonly excusedDays: number;
  readonly unexplainedDays: number;
  /** Present days over care days in percent; `null` without a care day. */
  readonly attendanceRate: number | null;
}

export interface UtilizationChildren {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly from: string;
  readonly to: string;
  readonly children: readonly UtilizationChild[];
}

export interface UtilizationWindow {
  readonly from: string;
  readonly to: string;
}

export function windowQuery(window: UtilizationWindow, schoolId?: string) {
  return { from: window.from, to: window.to, school: schoolId || undefined };
}

export function utilizationFromBackend(
  body: traegerSchoolsContract.Utilization,
): TraegerUtilization {
  return {
    from: requiredDay(body.from, "utilization.from"),
    to: requiredDay(body.to, "utilization.to"),
    days: (body.days ?? []).map((day) => requiredDay(day, "utilization.days")),
    asOf: body.as_of,
    schools: (body.schools ?? []).map((school) => ({
      id: school.id,
      name: school.name,
      slug: school.slug,
      subdomain: school.subdomain,
      city: school.city,
      places: school.places,
      booked: school.booked ?? [],
      bookedPlaces: school.booked_places ?? [],
      present: school.present ?? [],
      attendanceFrom: school.attendance_from,
      roomDataFrom: school.room_data_from,
      offerings: (school.offerings ?? []).map((offering) => ({
        id: offering.id,
        name: offering.name,
        capacity: offering.capacity,
        active: offering.active,
        booked: offering.booked ?? [],
      })),
      rooms: (school.rooms ?? []).map((room) => ({
        id: room.id,
        name: room.name,
        capacity: room.capacity,
        children: room.children ?? [],
        peak: room.peak ?? [],
      })),
    })),
  };
}

/** The utilization of every school of the Träger over the window. */
export async function fetchTraegerUtilization(
  window: UtilizationWindow,
): Promise<TraegerUtilization> {
  return utilizationFromBackend(
    await bffJson("org", "GET /traeger/schools/utilization", {
      query: windowQuery(window),
    }),
  );
}

/** The children of one school by name; the read stands in its access log. */
export async function fetchUtilizationChildren(
  schoolId: string,
  window: UtilizationWindow,
): Promise<UtilizationChildren> {
  const body = await bffJson(
    "org",
    "GET /traeger/schools/{id}/utilization/children",
    { params: { id: schoolId }, query: windowQuery(window) },
  );
  return {
    schoolId: body.school.id,
    schoolName: body.school.name,
    from: requiredDay(body.from, "utilization_children.from"),
    to: requiredDay(body.to, "utilization_children.to"),
    children: (body.children ?? []).map((child) => ({
      studentId: child.student_id,
      firstName: child.first_name,
      lastName: child.last_name,
      schoolClass: child.school_class,
      groupName: child.group_name,
      careDays: child.care_days,
      presentDays: child.present_days,
      sickDays: child.sick_days,
      excusedDays: child.excused_days,
      unexplainedDays: child.unexplained_days,
      attendanceRate: child.attendance_rate,
    })),
  };
}

/** The CSV export of the window, of one school or all. */
export function downloadTraegerUtilization(
  window: UtilizationWindow,
  schoolId: string | undefined,
  format: TraegerListFormat,
): Promise<TraegerListFile> {
  return downloadTraegerList(
    bffFile("org", "GET /traeger/schools/utilization/export", {
      query: listExportQuery(format, {
        from: window.from,
        to: window.to,
        school: schoolId,
      }),
    }),
  );
}
