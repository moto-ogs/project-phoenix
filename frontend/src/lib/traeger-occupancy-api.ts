import type * as seedOccupancyContract from "./contract/traeger-schools.generated";
import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Client of the occupancy of the Träger portal (#4676): how many children
 * each school, OGS group and care form holds today. Counts and the names of
 * groups and offers only, never a child. Backend int64 IDs leave as strings.
 */

import {
  downloadTraegerList,
  type TraegerListFile,
  type TraegerListFormat,
  listExportQuery,
} from "./traeger-list-export";
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

/** The occupancy of every school of the Träger, today. */
export async function fetchTraegerOccupancy(): Promise<TraegerOccupancy> {
  return mapTraegerOccupancy(
    await bffJson("org", "GET /traeger/schools/occupancy"),
  );
}

export function mapTraegerOccupancy(
  occupancy: seedOccupancyContract.Occupancy,
): TraegerOccupancy {
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
  return downloadTraegerList(
    bffFile("org", "GET /traeger/schools/occupancy/export", {
      query: listExportQuery(format, {
        school: schoolId,
      }),
    }),
  );
}
