import { createLogger } from "~/lib/logger";
import { requiredEnum } from "~/lib/contract/known-enum";
import { CHILD_STATUSES, type ChildStatus } from "~/lib/enrollment-status";
import { downloadBlob, filenameFromDisposition } from "~/lib/file-download";
import { bffFile, bffJson, type BffQuery } from "~/lib/bff-fetch";
import type * as enrollmentContract from "~/lib/contract/enrollment.generated";
import { logEnrollmentFailure } from "~/lib/enrollment-api-error";

const logger = createLogger({ component: "EnrollmentReportAPI" });

export type EnrollmentReportStatus = ChildStatus | "all";
/** Download formats every enrollment export offers. */
export type EnrollmentExportFormat = "pdf" | "docx" | "xlsx";
/**
 * Export layout for the filtered care-usage report (#2215): "detailed" keeps
 * the one-block-per-child output, "compact" renders the class-roster-style
 * table. Excel is always tabular.
 */
export type EnrollmentReportLayout = "detailed" | "compact";

/**
 * The filters of the care-usage report (#2215), sent as its query and as the
 * `filters` of its export. An empty `care_offering_ids` asks for children
 * without any offering.
 */
export type CareUsageFilters = Omit<
  BffQuery<
    (typeof enrollmentContract.routes)["GET /api/enrollment/admin/reports/care-usage"]
  >,
  "care_offering_id" | "care_offering_ids" | "phase_id" | "status"
> & {
  phase_id: string;
  care_offering_ids?: string[];
  status?: EnrollmentReportStatus;
};

type CareUsageRowOffering = Omit<
  enrollmentContract.careUsageRowOfferingResponse,
  "days"
> & { days: string[] };

/** A child of the report, with the lists Go may write as null read as empty. */
export type CareUsageRow = Omit<
  enrollmentContract.careUsageRowResponse,
  "status" | "offerings" | "effective_days" | "pickup_by_day"
> & {
  status: ChildStatus;
  offerings: CareUsageRowOffering[];
  effective_days: string[];
  pickup_by_day: Record<string, string>;
};

/** The report, with the lists Go may write as null read as empty. */
export type CareUsageReport = Omit<
  enrollmentContract.CareUsageReportResponse,
  "totals" | "by_offering" | "filter_options" | "rows"
> & {
  totals: {
    children: number;
    by_day_count: Record<string, number>;
    by_weekday_pickup_time: Record<string, Record<string, number>>;
  };
  by_offering: (Omit<
    enrollmentContract.careUsageOfferingStatResponse,
    "by_day_count"
  > & { by_day_count: Record<string, number> })[];
  filter_options: {
    offerings: enrollmentContract.careUsageOfferingOptionResponse[];
    grade_levels: number[];
    pickup_times: string[];
  };
  rows: CareUsageRow[];
};

function careUsageReportFromContract(
  report: enrollmentContract.CareUsageReportResponse,
): CareUsageReport {
  return {
    ...report,
    totals: {
      children: report.totals.children,
      by_day_count: report.totals.by_day_count ?? {},
      by_weekday_pickup_time: Object.fromEntries(
        Object.entries(report.totals.by_weekday_pickup_time ?? {}).map(
          ([day, times]) => [day, times ?? {}],
        ),
      ),
    },
    by_offering: (report.by_offering ?? []).map((stat) => ({
      ...stat,
      by_day_count: stat.by_day_count ?? {},
    })),
    filter_options: {
      offerings: report.filter_options.offerings ?? [],
      grade_levels: report.filter_options.grade_levels ?? [],
      pickup_times: report.filter_options.pickup_times ?? [],
    },
    rows: (report.rows ?? []).map((row) => ({
      ...row,
      status: requiredEnum(CHILD_STATUSES, row.status, "CareUsageRow.status"),
      offerings: (row.offerings ?? []).map((offering) => ({
        ...offering,
        days: offering.days ?? [],
      })),
      effective_days: row.effective_days ?? [],
      pickup_by_day: row.pickup_by_day ?? {},
    })),
  };
}

const LOG_EVENT = "enrollment_report_request_failed";

export async function getCareUsageReport(
  filters: CareUsageFilters,
): Promise<CareUsageReport> {
  const ids = filters.care_offering_ids;
  return careUsageReportFromContract(
    await bffJson("tenant", "GET /api/enrollment/admin/reports/care-usage", {
      query: {
        phase_id: filters.phase_id,
        status: filters.status,
        // An empty list travels as one empty value: no offering at all.
        care_offering_ids: ids?.length === 0 ? [""] : ids,
        day_count: filters.day_count,
        grade_level: filters.grade_level || undefined,
        weekday: filters.weekday || undefined,
        pickup_time: filters.pickup_time || undefined,
        search: filters.search?.trim() || undefined,
      },
      errorMessage: "Auswertung konnte nicht geladen werden",
    }),
  );
}

export async function exportCareUsageReport(
  filters: CareUsageFilters,
  format: EnrollmentExportFormat,
  layout: EnrollmentReportLayout = "detailed",
): Promise<void> {
  const response = await bffFile(
    "tenant",
    "POST /api/enrollment/admin/reports/care-usage/export",
    {
      // "detailed" is the backend default; only the compact layout is sent
      // explicitly so the detailed request body stays unchanged.
      body:
        layout === "compact"
          ? { format, layout, filters }
          : { format, filters },
      errorMessage: "Auswertung konnte nicht exportiert werden",
    },
  ).catch((error: unknown) => logEnrollmentFailure(error, logger, LOG_EVENT));
  downloadBlob(
    await response.blob(),
    filenameFromDisposition(response) ?? `anmelde-auswertung.${format}`,
  );
}

export async function exportPhaseClassRoster(
  phaseId: string,
  schoolClass: string | null,
  format: EnrollmentExportFormat,
): Promise<void> {
  const response = await bffFile(
    "tenant",
    "POST /api/enrollment/admin/reports/class-roster/export",
    {
      body: {
        format,
        filters: {
          phase_id: phaseId,
          ...(schoolClass
            ? { school_class: schoolClass }
            : { all_classes: true }),
        },
      },
      errorMessage: "Klassenliste konnte nicht exportiert werden",
    },
  ).catch((error: unknown) => logEnrollmentFailure(error, logger, LOG_EVENT));
  downloadBlob(
    await response.blob(),
    filenameFromDisposition(response) ??
      (schoolClass ? `klassenliste.${format}` : `klassenlisten.${format}`),
  );
}

/**
 * A phase's registrations: PDF = one block per submission, DOCX/XLSX = one
 * row per child. `childStatus` limits the export like the list's status
 * filter; omit it to export all.
 */
export async function exportPhaseRegistrations(
  phaseId: string,
  format: EnrollmentExportFormat,
  childStatus?: string,
): Promise<void> {
  const response = await bffFile(
    "tenant",
    "POST /api/enrollment/phases/{id}/export",
    {
      params: { id: phaseId },
      body: childStatus ? { format, child_status: childStatus } : { format },
      errorMessage: "Export konnte nicht erstellt werden",
    },
  ).catch((error: unknown) => logEnrollmentFailure(error, logger, LOG_EVENT));
  downloadBlob(
    await response.blob(),
    filenameFromDisposition(response) ?? `anmeldungen.${format}`,
  );
}
