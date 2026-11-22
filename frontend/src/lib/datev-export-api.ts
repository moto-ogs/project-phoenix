// DATEV export preflight (#1417 2b): the report the export dialog shows
// before a DATEV download. Same permission as the export itself
// (time_tracking:manage); the file build and this report share one backend
// code path, so they cannot disagree.

import { bffJson } from "./bff-fetch";
import type * as staffContract from "./contract/staff.generated";

export type DatevFormat = "datev_lodas" | "datev_lug";

interface DatevSkippedStaff {
  lastName: string;
  firstName: string;
  reason: string;
}

export interface DatevExportReport {
  lineCount: number;
  staffExported: number;
  staffSkipped: DatevSkippedStaff[];
  unconfiguredCategories: string[];
  openMonth: boolean;
}

function mapDatevExportReport(
  data: staffContract.DatevExportReport,
): DatevExportReport {
  return {
    lineCount: data.line_count,
    staffExported: data.staff_exported,
    staffSkipped: (data.staff_skipped ?? []).map((entry) => ({
      lastName: entry.last_name,
      firstName: entry.first_name,
      reason: entry.reason,
    })),
    unconfiguredCategories: data.unconfigured_categories ?? [],
    openMonth: data.open_month,
  };
}

export async function fetchDatevExportReport(
  year: number,
  month: number,
  format: DatevFormat,
): Promise<DatevExportReport> {
  return mapDatevExportReport(
    await bffJson(
      "tenant",
      "GET /api/staff/time-tracking/export/datev-report",
      {
        query: { year, month, format },
      },
    ),
  );
}
