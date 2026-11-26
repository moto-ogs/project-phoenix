import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Client of the Träger's school comparison (#4715, ADR 0245): for a window
 * and a choice of schools, eight key figures per school, their average over
 * the chosen schools and their figure together. Counts only, so nothing is
 * written to the access log. Backend int64 IDs leave as strings; a figure a
 * school does not have is missing from its values, never 0.
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
import type { UtilizationWindow } from "./traeger-utilization-api";

/** The figure keys, in the order the backend defines them. */
export const COMPARISON_METRICS = [
  "places",
  "places_rate",
  "free_places",
  "booked",
  "booked_change",
  "present",
  "present_peak",
  "active_students",
] as const;

export type ComparisonMetric = (typeof COMPARISON_METRICS)[number];

export type ComparisonValues = Readonly<
  Partial<Record<ComparisonMetric, number>>
>;

export interface ComparedSchool extends TraegerSchool {
  readonly values: ComparisonValues;
}

export interface TraegerComparison {
  readonly from: string;
  readonly to: string;
  /** The weekdays of the window. */
  readonly days: number;
  readonly asOf: string;
  /**
   * The latest first day with check-ins after `from` among the chosen
   * schools, `YYYY-MM-DD`; `null` when all have check-ins from the start.
   */
  readonly attendanceFrom: string | null;
  readonly schools: readonly ComparedSchool[];
  readonly average: ComparisonValues;
  readonly together: ComparisonValues;
}

export interface ComparisonQuery extends UtilizationWindow {
  /** The chosen schools; empty compares every school of the Träger. */
  readonly schoolIds: readonly string[];
}

/** Keeps only the known keys, so an added backend figure cannot break a page. */
function knownValues(values: Record<string, number> | null): ComparisonValues {
  const result: Partial<Record<ComparisonMetric, number>> = {};
  for (const metric of COMPARISON_METRICS) {
    const value = values?.[metric];
    if (typeof value === "number") result[metric] = value;
  }
  return result;
}

export function comparisonQuery(query: ComparisonQuery) {
  return {
    from: query.from,
    to: query.to,
    schools: query.schoolIds,
  };
}

export function comparisonFromBackend(
  body: traegerSchoolsContract.SchoolComparison,
): TraegerComparison {
  return {
    from: requiredDay(body.from, "comparison.from"),
    to: requiredDay(body.to, "comparison.to"),
    days: body.days,
    asOf: body.as_of,
    attendanceFrom: body.attendance_from,
    schools: (body.schools ?? []).map((school) => ({
      id: school.id,
      name: school.name,
      slug: school.slug,
      subdomain: school.subdomain,
      city: school.city,
      values: knownValues(school.values),
    })),
    average: knownValues(body.average),
    together: knownValues(body.together),
  };
}

/** The comparison of the chosen schools over the window. */
export async function fetchTraegerComparison(
  query: ComparisonQuery,
): Promise<TraegerComparison> {
  return comparisonFromBackend(
    await bffJson("org", "GET /traeger/schools/comparison", {
      query: comparisonQuery(query),
    }),
  );
}

/** The CSV export of the chosen schools and figures. */
export function downloadTraegerComparison(
  query: ComparisonQuery,
  metrics: readonly ComparisonMetric[],
  format: TraegerListFormat,
): Promise<TraegerListFile> {
  return downloadTraegerList(
    bffFile("org", "GET /traeger/schools/comparison/export", {
      query: {
        ...listExportQuery(format, {
          from: query.from,
          to: query.to,
          metrics: metrics.join(","),
        }),
        schools: query.schoolIds,
      },
    }),
  );
}
