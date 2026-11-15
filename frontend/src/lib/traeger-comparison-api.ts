/**
 * Client of the Träger's school comparison (#4715, ADR 0245): for a window
 * and a choice of schools, eight key figures per school, their average over
 * the chosen schools and their figure together. Counts only, so nothing is
 * written to the access log. Backend int64 IDs leave as strings; a figure a
 * school does not have is missing from its values, never 0.
 */

import { apiErrorFromBody, transportFetch } from "./api-error";
import { filenameFromDisposition } from "./file-download";
import type { TraegerSchool } from "./traeger-api";
import { traegerRequest } from "./traeger-api";
import type { UtilizationWindow } from "./traeger-utilization-api";

const COMPARISON_PATH = "/api/traeger/schools/comparison";

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
  /** The key date of `active_students`, `YYYY-MM-DD`; `null` without one. */
  readonly keyDate: string | null;
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

interface BackendComparison {
  from: string;
  to: string;
  days: number;
  as_of: string;
  attendance_from: string | null;
  schools?:
    | {
        id: number;
        name: string;
        slug: string;
        subdomain: string;
        city?: string;
        values?: Record<string, number> | null;
        key_date: string | null;
      }[]
    | null;
  average?: Record<string, number> | null;
  together?: Record<string, number> | null;
}

export interface ComparisonQuery extends UtilizationWindow {
  /** The chosen schools; empty compares every school of the Träger. */
  readonly schoolIds: readonly string[];
}

/** Keeps only the known keys, so an added backend figure cannot break a page. */
function knownValues(
  values: Record<string, number> | null | undefined,
): ComparisonValues {
  const result: Partial<Record<ComparisonMetric, number>> = {};
  for (const metric of COMPARISON_METRICS) {
    const value = values?.[metric];
    if (typeof value === "number") result[metric] = value;
  }
  return result;
}

function comparisonQuery(
  query: ComparisonQuery,
  metrics?: readonly ComparisonMetric[],
): string {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.schoolIds.length > 0) {
    params.set("schools", query.schoolIds.join(","));
  }
  if (metrics && metrics.length > 0) params.set("metrics", metrics.join(","));
  return params.toString();
}

function comparisonFromBackend(body: BackendComparison): TraegerComparison {
  return {
    from: body.from,
    to: body.to,
    days: body.days,
    asOf: body.as_of,
    attendanceFrom: body.attendance_from ?? null,
    schools: (body.schools ?? []).map((school) => ({
      id: String(school.id),
      name: school.name,
      slug: school.slug,
      subdomain: school.subdomain,
      city: school.city ?? "",
      values: knownValues(school.values),
      keyDate: school.key_date ?? null,
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
    await traegerRequest<BackendComparison>(
      `${COMPARISON_PATH}?${comparisonQuery(query)}`,
    ),
  );
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

/** The CSV export of the chosen schools and figures. */
export async function downloadTraegerComparison(
  query: ComparisonQuery,
  metrics: readonly ComparisonMetric[],
): Promise<{ readonly blob: Blob; readonly filename: string | null }> {
  const response = await transportFetch(
    `${COMPARISON_PATH}/export?${comparisonQuery(query, metrics)}`,
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
