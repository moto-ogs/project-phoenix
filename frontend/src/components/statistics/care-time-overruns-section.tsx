"use client";

// Soll und Ist (#4774): every child with overruns in the Statistik window,
// most overruns first, with its own PDF and Excel export. Read-only; a name
// opens the child, whose Betreuungszeiten tab shows the days.

import { Download, FileSpreadsheet } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import Link from "~/components/ui/navigation-link";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import type { OverflowMenuEntry } from "~/components/ui/page-header/types";
import { SectionCard } from "~/components/ui/section-card";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import {
  fetchCareTimeOverruns,
  fetchCareTimeOverrunsExport,
  type CareTimeExportFormat,
} from "~/lib/care-times";
import type * as statisticsContract from "~/lib/contract/statistics.generated";
import { formatDate } from "~/lib/date-helpers";
import { downloadBlob, filenameFromDisposition } from "~/lib/file-download";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useSWRAuth } from "~/lib/swr";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import { useTenantAwarePath } from "~/lib/tenant-path";

const logger = createLogger({ component: "CareTimeOverrunsSection" });

const EXPORT_FORMATS: readonly {
  format: CareTimeExportFormat;
  label: string;
  Icon: typeof Download;
}[] = [
  { format: "pdf", label: "PDF", Icon: Download },
  { format: "xlsx", label: "Excel", Icon: FileSpreadsheet },
];

export function CareTimeOverrunsSection({
  fromISO,
  toISO,
  groupIds,
  schoolClasses,
}: Readonly<{
  fromISO: string;
  toISO: string;
  groupIds: readonly string[];
  schoolClasses: readonly string[];
}>) {
  const tenantPath = useTenantAwarePath();
  const [exporting, setExporting] = useState<CareTimeExportFormat | null>(null);
  const { show: showExportError } = useApiErrorDisplay();
  const retryExportRef = useRef<() => void>(() => undefined);
  // Klassennamen dürfen Kommas enthalten; der Schlüssel bleibt deshalb JSON.
  const filterKey = JSON.stringify([groupIds, schoolClasses]);
  const {
    data,
    error: loadFailure,
    mutate,
  } = useSWRAuth(
    tenantDailyKeys.careTimeOverruns(fromISO, toISO, groupIds, schoolClasses),
    () =>
      fetchCareTimeOverruns(fromISO, toISO, {
        groupIds: [...groupIds],
        schoolClasses: [...schoolClasses],
      }),
    { keepPreviousData: false },
  );
  const loading = data === undefined && !loadFailure;
  const load = useSwrResourceLoadError(
    [{ data, error: loadFailure }],
    "die Liste Soll und Ist",
    () => mutate(),
  );

  const downloadExport = useCallback(
    async (format: CareTimeExportFormat) => {
      setExporting(format);
      try {
        const res = await fetchCareTimeOverrunsExport(fromISO, toISO, format, {
          groupIds,
          schoolClasses,
        });
        downloadBlob(
          await res.blob(),
          filenameFromDisposition(res) ??
            `soll-und-ist-${fromISO}-${toISO}.${format}`,
        );
      } catch (error) {
        logger.error("care_time_overruns_export_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        retryExportRef.current = () => void downloadExport(format);
        void showExportError(error, {
          object: "die Exportdatei",
          retry: () => retryExportRef.current(),
        });
      } finally {
        setExporting(null);
      }
    },
    [fromISO, toISO, groupIds, schoolClasses, showExportError],
  );

  const exportMenu: OverflowMenuEntry[] = [
    { kind: "header", label: "Exportieren" },
    ...EXPORT_FORMATS.map(({ format, label, Icon }) => ({
      label: exporting === format ? "Wird exportiert…" : label,
      description:
        "Lädt die Liste für den gewählten Zeitraum und Filter herunter",
      icon: <Icon className="h-4 w-4" aria-hidden />,
      onClick: () => void downloadExport(format),
      disabled: !data || exporting !== null,
    })),
  ];

  const columns: DataTableColumn<statisticsContract.careTimeOverrunRowResponse>[] =
    [
      {
        key: "name",
        header: "Kind",
        render: (row) => (
          <Link
            href={tenantPath(
              `/students/${row.student_id}?tab=betreuungszeiten`,
            )}
            className="font-medium text-gray-900 hover:underline"
          >
            {row.last_name}, {row.first_name}
          </Link>
        ),
        sortValue: (row) => `${row.last_name} ${row.first_name}`,
        stacked: "title",
      },
      {
        key: "class",
        header: "Klasse",
        render: (row) => row.school_class || "–",
        sortValue: (row) => row.school_class,
      },
      {
        key: "group",
        header: "Gruppe",
        render: (row) => row.group_name || "–",
        sortValue: (row) => row.group_name,
      },
      {
        key: "overruns",
        header: "Überschreitungen",
        align: "right",
        render: (row) => (
          <span className="tabular-nums">{row.summary.overrun_count}</span>
        ),
        sortValue: (row) => row.summary.overrun_count,
      },
      {
        key: "unbooked",
        header: "Davon ohne Buchung",
        align: "right",
        render: (row) => (
          <span className="tabular-nums">{row.summary.unbooked_days}</span>
        ),
        sortValue: (row) => row.summary.unbooked_days,
      },
      {
        key: "extra",
        header: "Minuten über Buchung",
        align: "right",
        render: (row) => (
          <span className="tabular-nums">{row.summary.extra_minutes}</span>
        ),
        sortValue: (row) => row.summary.extra_minutes,
      },
    ];

  const tolerance = data?.tolerance_minutes ?? 15;

  return (
    <SectionCard
      title="Soll und Ist"
      description={`Kinder, die länger oder an anderen Tagen da waren als gebucht. Überschreitung: mehr als ${tolerance} Minuten früher oder später als gebucht, oder da ohne Buchung. Krank, entschuldigt und geschlossen zählt nicht.`}
      actions={
        <OverflowMenu items={exportMenu} ariaLabel="Liste exportieren" />
      }
    >
      <div className="space-y-3">
        <LoadErrorAlert error={load.error} />
        {data && data.data_from > fromISO ? (
          <Alert
            type="info"
            message={`Anwesenheiten werden nicht unbegrenzt aufbewahrt. Verglichen wird ab ${formatDate(data.data_from)}.`}
          />
        ) : null}
        <DataTable
          columns={columns}
          rows={data?.students ?? []}
          getRowKey={(row) => row.student_id}
          defaultSortKey="overruns"
          defaultSortDirection="desc"
          isLoading={loading}
          pageSize={25}
          paginationResetKey={`${fromISO}-${toISO}-${filterKey}`}
          stackedOnMobile
          emptyState={
            <EmptyState
              title="Keine Überschreitungen"
              description="Im gewählten Zeitraum waren alle Kinder nur zu ihren gebuchten Zeiten da."
            />
          }
        />
      </div>
    </SectionCard>
  );
}
