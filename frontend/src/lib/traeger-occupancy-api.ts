/**
 * Client of the occupancy of the Träger portal (#4676): how many children
 * each school, OGS group and care form holds today. Counts and the names of
 * groups and offers only, never a child. Backend int64 IDs leave as strings.
 */

import { apiErrorFromBody, transportFetch } from "./api-error";
import {
  downloadTraegerList,
  type TraegerListFile,
  type TraegerListFormat,
} from "./traeger-list-export";
import type { Occupancy as WireOccupancy } from "./contract/traeger-schools.generated";
import { requiredDay } from "./contract/required-day";
import type { TraegerSchool } from "./traeger-api";

interface TraegerOccupancyGroup {
  readonly id: string;
  readonly name: string;
  readonly children: number;
}

export interface TraegerOccupancyCareForm {
  readonly id: string;
  readonly name: string;
  readonly children: number;
  /** The places of the offer; `null` without a limit. */
  readonly capacity: number | null;
  /** `false` when the school no longer offers it: its places are not free. */
  readonly active: boolean;
}

export interface TraegerSchoolOccupancy extends TraegerSchool {
  /** The children of the Stichtagszahl rule, counted today. */
  readonly children: number;
  readonly withoutGroup: number;
  readonly groups: readonly TraegerOccupancyGroup[];
  readonly withoutCareForm: number;
  readonly careForms: readonly TraegerOccupancyCareForm[];
}

export interface TraegerOccupancy {
  /** The day counted, `YYYY-MM-DD`. */
  readonly day: string;
  readonly asOf: string;
  readonly schools: readonly TraegerSchoolOccupancy[];
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

/** The occupancy of every school of the Träger, today. */
export async function fetchTraegerOccupancy(): Promise<TraegerOccupancy> {
  const response = await transportFetch("/api/traeger/schools/occupancy", {
    credentials: "include",
    cache: "no-store",
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw apiErrorFromBody(
      `Request failed (${response.status})`,
      response.status,
      data,
    );
  }
  const occupancy = (data as { data: WireOccupancy }).data;
  return {
    day: requiredDay(occupancy.day, "occupancy.day"),
    asOf: occupancy.as_of,
    schools: (occupancy.schools ?? []).map((school) => ({
      id: school.id,
      name: school.name,
      slug: school.slug,
      subdomain: school.subdomain,
      city: school.city,
      children: school.children,
      withoutGroup: school.without_group,
      groups: (school.groups ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        children: group.children,
      })),
      withoutCareForm: school.without_care_form,
      careForms: (school.care_forms ?? []).map((form) => ({
        id: form.id,
        name: form.name,
        children: form.children,
        capacity: form.capacity,
        active: form.active,
      })),
    })),
  };
}

/**
 * The export of the occupancy as PDF, Excel or CSV (#4718), for every school
 * or one, with the file name the backend chose.
 */
export function downloadTraegerOccupancy(
  format: TraegerListFormat,
  schoolId?: string,
): Promise<TraegerListFile> {
  return downloadTraegerList("/api/traeger/schools/occupancy/export", format, {
    school: schoolId,
  });
}
