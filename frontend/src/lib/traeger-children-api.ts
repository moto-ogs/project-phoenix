import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Client of the children of the Träger (#8137, ADR 0327): every child the
 * schools of the Träger count today, by name, with its school, its class and
 * its OGS group, one page of 50 at a time. The names need „Verträge
 * verwalten“, and the backend writes every page and every export to the
 * access log of each school it shows. Backend int64 IDs leave as strings.
 */

import type * as traegerSchoolsContract from "./contract/traeger-schools.generated";
import {
  downloadTraegerList,
  type TraegerListFile,
  type TraegerListFormat,
  listExportQuery,
} from "./traeger-list-export";

export interface TraegerChild {
  readonly studentId: string;
  readonly schoolId: string;
  readonly schoolName: string;
  readonly firstName: string;
  readonly lastName: string;
  /** "" without a class. */
  readonly schoolClass: string;
  /** "" without an OGS group. */
  readonly groupName: string;
}

/** One school of the Träger with the children it counts today. */
export interface TraegerSchoolChildCount {
  readonly id: string;
  readonly name: string;
  readonly children: number;
}

export interface TraegerChildrenPage {
  /** Every school of the Träger by name, whatever the filter. */
  readonly schools: readonly TraegerSchoolChildCount[];
  /** The children of the chosen school, or of all schools. */
  readonly total: number;
  /** Those of them the search matches. */
  readonly matched: number;
  readonly children: readonly TraegerChild[];
  readonly nextCursor: string;
}

/** `schoolId` "" means every school, `search` "" every child. */
export interface TraegerChildrenFilter {
  readonly schoolId: string;
  readonly search: string;
}

function childFromBackend(
  child: traegerSchoolsContract.TraegerChild,
): TraegerChild {
  return {
    studentId: child.student_id,
    schoolId: child.school_id,
    schoolName: child.school_name,
    firstName: child.first_name,
    lastName: child.last_name,
    schoolClass: child.school_class,
    groupName: child.group_name,
  };
}

/** One page of the children, continuing after the previous page’s last child. */
export async function fetchTraegerChildren(
  filter: TraegerChildrenFilter,
  cursor?: string,
): Promise<TraegerChildrenPage> {
  const body = await bffJson("org", "GET /traeger/schools/children", {
    query: {
      school_id: filter.schoolId || undefined,
      search: filter.search || undefined,
      cursor,
    },
  });
  return {
    schools: (body.schools ?? []).map((school) => ({
      id: school.id,
      name: school.name,
      children: school.children,
    })),
    total: body.total,
    matched: body.matched,
    children: (body.children ?? []).map(childFromBackend),
    nextCursor: body.next_cursor,
  };
}

/** Every child of the filter as PDF, Excel or CSV. */
export function downloadTraegerChildren(
  format: TraegerListFormat,
  filter: TraegerChildrenFilter,
): Promise<TraegerListFile> {
  return downloadTraegerList(
    bffFile("org", "GET /traeger/schools/children/export", {
      query: listExportQuery(format, {
        school_id: filter.schoolId,
        search: filter.search,
      }),
    }),
  );
}
