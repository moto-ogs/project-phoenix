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
} from "./traeger-list-export";
import type { TraegerSchool } from "./traeger-api";
import { traegerRequest } from "./traeger-api";

/** The right that opens the children of a school by name (ADR 0156, 0241). */
export const UTILIZATION_NAMES_RIGHT = "traeger_contracts:manage";

const UTILIZATION_PATH = "/api/traeger/schools/utilization";

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

interface BackendSchool {
  id: number;
  name: string;
  slug: string;
  subdomain: string;
  city?: string;
}

interface BackendUtilization {
  from: string;
  to: string;
  days?: string[] | null;
  as_of: string;
  schools?:
    | (BackendSchool & {
        places: number;
        booked?: number[] | null;
        booked_places?: number[] | null;
        present?: (number | null)[] | null;
        attendance_from: string | null;
        room_data_from: string | null;
        offerings?:
          | {
              id: number;
              name: string;
              capacity: number | null;
              active: boolean;
              booked?: number[] | null;
            }[]
          | null;
        rooms?:
          | {
              id: number;
              name: string;
              capacity: number | null;
              children?: (number | null)[] | null;
              peak?: (number | null)[] | null;
            }[]
          | null;
      })[]
    | null;
}

interface BackendChildren {
  school: BackendSchool;
  from: string;
  to: string;
  children?:
    | {
        student_id: number;
        first_name: string;
        last_name: string;
        school_class: string;
        group_name: string;
        care_days: number;
        present_days: number;
        sick_days: number;
        excused_days: number;
        unexplained_days: number;
        attendance_rate: number | null;
      }[]
    | null;
}

export interface UtilizationWindow {
  readonly from: string;
  readonly to: string;
}

function windowQuery(window: UtilizationWindow, schoolId?: string): string {
  const query = new URLSearchParams({ from: window.from, to: window.to });
  if (schoolId) query.set("school", schoolId);
  return query.toString();
}

function utilizationFromBackend(body: BackendUtilization): TraegerUtilization {
  return {
    from: body.from,
    to: body.to,
    days: body.days ?? [],
    asOf: body.as_of,
    schools: (body.schools ?? []).map((school) => ({
      id: String(school.id),
      name: school.name,
      slug: school.slug,
      subdomain: school.subdomain,
      city: school.city ?? "",
      places: school.places,
      booked: school.booked ?? [],
      bookedPlaces: school.booked_places ?? [],
      present: school.present ?? [],
      attendanceFrom: school.attendance_from ?? null,
      roomDataFrom: school.room_data_from ?? null,
      offerings: (school.offerings ?? []).map((offering) => ({
        id: String(offering.id),
        name: offering.name,
        capacity: offering.capacity ?? null,
        active: offering.active,
        booked: offering.booked ?? [],
      })),
      rooms: (school.rooms ?? []).map((room) => ({
        id: String(room.id),
        name: room.name,
        capacity: room.capacity ?? null,
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
    await traegerRequest<BackendUtilization>(
      `${UTILIZATION_PATH}?${windowQuery(window)}`,
    ),
  );
}

/** The children of one school by name; the read stands in its access log. */
export async function fetchUtilizationChildren(
  schoolId: string,
  window: UtilizationWindow,
): Promise<UtilizationChildren> {
  const body = await traegerRequest<BackendChildren>(
    `/api/traeger/schools/${encodeURIComponent(schoolId)}/utilization/children?${windowQuery(window)}`,
  );
  return {
    schoolId: String(body.school.id),
    schoolName: body.school.name,
    from: body.from,
    to: body.to,
    children: (body.children ?? []).map((child) => ({
      studentId: String(child.student_id),
      firstName: child.first_name,
      lastName: child.last_name,
      schoolClass: child.school_class,
      groupName: child.group_name,
      careDays: child.care_days,
      presentDays: child.present_days,
      sickDays: child.sick_days,
      excusedDays: child.excused_days,
      unexplainedDays: child.unexplained_days,
      attendanceRate: child.attendance_rate ?? null,
    })),
  };
}

/** The CSV export of the window, of one school or all. */
export function downloadTraegerUtilization(
  window: UtilizationWindow,
  schoolId: string | undefined,
  format: TraegerListFormat,
): Promise<TraegerListFile> {
  return downloadTraegerList(`${UTILIZATION_PATH}/export`, format, {
    from: window.from,
    to: window.to,
    school: schoolId,
  });
}
