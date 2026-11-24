"use client";

import {
  operatorBillingKeys,
  operatorProvisioningKeys,
} from "~/lib/swr/portal-keys";
import { operatorProvisioningService } from "~/lib/operator/provisioning-api";
import { Suspense, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
// eslint-disable-next-line no-restricted-imports -- operator pages are not tenant-scoped
import { useSWRAuth } from "~/lib/swr";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { BillingKeyDays } from "~/components/operator/billing-key-days";
import { CustomSelect } from "~/components/ui/custom-select";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSetBreadcrumb } from "~/lib/breadcrumb-context";
import {
  berlinClockFromISO,
  berlinTodayISO,
  formatBerlinDate,
  formatDate,
  parseISODate,
} from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import {
  billingMonth,
  operatorBillingService,
  type BillingKeyDateCount,
} from "~/lib/operator/billing-api";

const logger = createLogger({ component: "OperatorBillingPage" });

const KEY_DAY_SWR_KEY = operatorBillingKeys.keyDay();
const COUNTS_SWR_KEY = operatorBillingKeys.counts();

/** "September 2026" for a period (YYYY-MM-01). */
function monthLabel(period: string): string {
  return parseISODate(period).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });
}

/** The capture ran after the key date's day (the worker was down). */
function capturedLate(row: BillingKeyDateCount): boolean {
  return berlinTodayISO(new Date(row.recordedAt)) > row.keyDate;
}

function recordedLabel(row: BillingKeyDateCount): string {
  return `${formatBerlinDate(row.recordedAt)}, ${berlinClockFromISO(row.recordedAt)} Uhr`;
}

/**
 * A row of the table: a captured school, or for the running month a school
 * still without figures, with the key date its day gives this month (#7301).
 */
type CountRow =
  | { readonly kind: "captured"; readonly count: BillingKeyDateCount }
  | {
      readonly kind: "pending";
      readonly schoolId: string;
      readonly schoolName: string;
      readonly organizationName: string;
      readonly keyDate: string;
    };

const rowSchool = (row: CountRow) =>
  row.kind === "captured" ? row.count.schoolName : row.schoolName;
const rowOrganization = (row: CountRow) =>
  row.kind === "captured" ? row.count.organizationName : row.organizationName;
const rowKeyDate = (row: CountRow) =>
  row.kind === "captured" ? row.count.keyDate : row.keyDate;

const COLUMNS: DataTableColumn<CountRow>[] = [
  {
    key: "school",
    header: "Schule",
    render: rowSchool,
    sortValue: (row) => rowSchool(row).toLowerCase(),
    stacked: "title",
  },
  {
    key: "organization",
    header: "Träger",
    render: rowOrganization,
    sortValue: (row) => rowOrganization(row).toLowerCase(),
    stacked: "meta",
  },
  {
    key: "keyDate",
    header: "Stichtag",
    render: (row) =>
      rowKeyDate(row) ? formatDate(rowKeyDate(row)) : "unbekannt",
    sortValue: rowKeyDate,
    stacked: "field",
  },
  {
    key: "students",
    header: "Aktive Kinder",
    render: (row) => (row.kind === "captured" ? row.count.activeStudents : "–"),
    sortValue: (row) =>
      row.kind === "captured" ? row.count.activeStudents : -1,
    align: "right",
    stacked: "field",
  },
  {
    key: "terminals",
    header: "Aktive Terminals",
    render: (row) =>
      row.kind === "captured" ? row.count.activeTerminals : "–",
    sortValue: (row) =>
      row.kind === "captured" ? row.count.activeTerminals : -1,
    align: "right",
    stacked: "field",
  },
  {
    key: "recorded",
    header: "Erfasst am",
    render: (row) =>
      row.kind === "pending" ? (
        row.keyDate !== "" && row.keyDate < berlinTodayISO() ? (
          <StatusBadge
            tone="warning"
            label="Zahlen fehlen"
            title="Der Stichtag ist vorbei und moto hat noch keine Zahlen. Lief die Erfassung nicht, holt moto sie in diesem Monat nach."
          />
        ) : (
          <span className="text-gray-500">noch nicht erfasst</span>
        )
      ) : capturedLate(row.count) ? (
        <span title="Die Zahlen wurden nach dem Stichtag erfasst, weil die Erfassung am Stichtag nicht lief.">
          {recordedLabel(row.count)} · nachträglich
        </span>
      ) : (
        recordedLabel(row.count)
      ),
    sortValue: (row) => (row.kind === "captured" ? row.count.recordedAt : ""),
    stacked: "field",
  },
];

/** How moto counts, for the info next to the title: read to learn the page. */
function CountingRules() {
  return (
    <div className="space-y-2">
      <p>
        moto hält am Stichtag ab 6 Uhr fest, wie viele Kinder und Terminals jede
        Schule aktiv hat. Die Zahlen ändern sich danach nicht mehr.
      </p>
      <p>
        <strong>Aktive Kinder:</strong> Status „aktiv“. Ein sofort aktiviertes
        Kind zählt auch vor dem Betreuungsbeginn. Ausstehende, beendete,
        abgegangene und gelöschte Kinder zählen nicht.
      </p>
      <p>
        <strong>Aktive Terminals:</strong> Geräte mit dem Status „aktiv“. Auch
        offline Geräte zählen, Geräte in Wartung und die Erfassung im Browser
        nicht.
      </p>
    </div>
  );
}

function OperatorBillingPageContent() {
  useSetBreadcrumb({ pageTitle: "Stichtagszahlen" });
  const { status } = useSession();
  const { show: showDownloadError } = useApiErrorDisplay();
  const isAuthenticated = status === "authenticated";

  const {
    data: keyDay,
    error: keyDayError,
    isLoading: keyDayLoading,
    mutate: mutateKeyDay,
  } = useSWRAuth(
    isAuthenticated ? KEY_DAY_SWR_KEY : null,
    () => operatorBillingService.getKeyDay(),
    { keepPreviousData: false },
  );
  const keyDayLoadError = useSwrLoadError(
    keyDayError,
    "die Liste der Stichtage",
    () => void mutateKeyDay(),
  );
  const {
    data: counts,
    isLoading: countsLoading,
    error: countsError,
    mutate: mutateCounts,
  } = useSWRAuth(
    isAuthenticated ? COUNTS_SWR_KEY : null,
    () => operatorBillingService.listKeyDateCounts(),
    { keepPreviousData: false },
  );
  const countsLoadError = useSwrLoadError(
    countsError,
    "die Liste der Stichtagszahlen",
    () => void mutateCounts(),
  );

  const periods = useMemo(
    () => [...new Set((counts ?? []).map((row) => row.period))],
    [counts],
  );
  const [chosenPeriod, setChosenPeriod] = useState<string | null>(null);
  const period =
    chosenPeriod && periods.includes(chosenPeriod) ? chosenPeriod : periods[0];

  const rows = useMemo(
    () => (counts ?? []).filter((row) => row.period === period),
    [counts, period],
  );
  const totalStudents = rows.reduce((sum, row) => sum + row.activeStudents, 0);
  const totalTerminals = rows.reduce(
    (sum, row) => sum + row.activeTerminals,
    0,
  );

  const [downloading, setDownloading] = useState<"month" | "all" | null>(null);
  const download = async (scope: "month" | "all") => {
    setDownloading(scope);
    try {
      await operatorBillingService.downloadKeyDateCounts(
        scope === "month" && period ? billingMonth(period) : undefined,
      );
    } catch (downloadError) {
      logger.warn("billing_export_failed", {
        error:
          downloadError instanceof Error ? downloadError.message : "unknown",
      });
      void showDownloadError(downloadError, {
        object: "die Datei mit den Stichtagszahlen",
        retry: () => void download(scope),
      });
    } finally {
      setDownloading(null);
    }
  };

  const hasCounts = periods.length > 0;

  // The schools that already have figures for the running month: a new key
  // day that is already reached this month skips the others (#7301).
  const currentPeriod = `${berlinTodayISO().slice(0, 8)}01`;
  const capturedThisMonth = useMemo(
    () =>
      counts
        ? new Set(
            counts
              .filter((row) => row.period === currentPeriod)
              .map((row) => row.schoolId),
          )
        : undefined,
    [counts, currentPeriod],
  );

  // The running month also lists the schools still without figures, with
  // the key date their own, their Träger's or the standard day gives.
  const showsCurrentMonth = period === currentPeriod;
  const schools = useSWRAuth(
    isAuthenticated && showsCurrentMonth
      ? operatorProvisioningKeys.schools()
      : null,
    () => operatorProvisioningService.listSchools(),
    { revalidateOnFocus: false },
  );
  const organizations = useSWRAuth(
    isAuthenticated && showsCurrentMonth
      ? operatorProvisioningKeys.organizations()
      : null,
    () => operatorProvisioningService.listOrganizations(),
    { revalidateOnFocus: false },
  );
  const pending = useMemo<CountRow[]>(() => {
    if (!showsCurrentMonth || !schools.data || !organizations.data) {
      return [];
    }
    const captured = new Set(rows.map((row) => row.schoolId));
    const names = new Map(organizations.data.map((org) => [org.id, org.name]));
    const own = (scope: string, id: string) =>
      keyDay?.overrides.find(
        (override) => override.scope === scope && override.id === id,
      )?.keyDay;
    return schools.data
      .filter((school) => school.deletedAt == null && !captured.has(school.id))
      .map((school) => {
        // Without the key days (they failed to load) the school stays
        // listed, its key date unknown.
        const day =
          own("school", school.id) ??
          own("organization", school.organizationId) ??
          keyDay?.keyDay;
        return {
          kind: "pending" as const,
          schoolId: school.id,
          schoolName: school.name,
          organizationName: names.get(school.organizationId) ?? "",
          keyDate: day
            ? `${currentPeriod.slice(0, 8)}${String(day).padStart(2, "0")}`
            : "",
        };
      });
  }, [
    showsCurrentMonth,
    keyDay,
    schools.data,
    organizations.data,
    rows,
    currentPeriod,
  ]);
  const tableRows = useMemo<CountRow[]>(
    () => [
      ...rows.map((count) => ({ kind: "captured" as const, count })),
      ...pending,
    ],
    [rows, pending],
  );

  const monthName = period ? monthLabel(period) : "";
  const overflowMenu = hasCounts
    ? [
        { kind: "header" as const, label: "Herunterladen" },
        {
          label: `${monthName} als CSV`,
          description: "Alle Schulen des gewählten Monats.",
          disabled: downloading !== null,
          onClick: () => void download("month"),
        },
        {
          label: "Alle Monate als CSV",
          description: "Jeder erfasste Monat, für die Rechnungsprüfung.",
          disabled: downloading !== null,
          onClick: () => void download("all"),
        },
      ]
    : undefined;

  return (
    <TenantPage
      title="Stichtagszahlen"
      info={<CountingRules />}
      statsLoading={countsLoading}
      stats={
        hasCounts ? (
          <TenantPageStats
            items={[
              pending.length > 0
                ? {
                    value: `${rows.length} von ${tableRows.length}`,
                    label: "Schulen erfasst",
                  }
                : {
                    value: rows.length,
                    label: rows.length === 1 ? "Schule" : "Schulen",
                  },
              { value: totalStudents, label: "aktive Kinder" },
              { value: totalTerminals, label: "aktive Terminals" },
            ]}
          />
        ) : undefined
      }
      overflowMenu={overflowMenu}
    >
      <SectionCard
        title="Erfasste Zahlen"
        description={
          pending.length > 0
            ? "Je Schule, so wie moto sie am Stichtag erfasst hat. Schulen ohne Zahlen stehen mit ihrem Stichtag dabei."
            : "Je Schule, so wie moto sie am Stichtag erfasst hat."
        }
        action={
          hasCounts ? (
            <CustomSelect
              ariaLabel="Monat"
              value={period ?? ""}
              options={periods.map((value) => ({
                value,
                label: monthLabel(value),
              }))}
              onChange={setChosenPeriod}
              className="min-w-44"
            />
          ) : undefined
        }
      >
        {countsError ? (
          <LoadErrorAlert error={countsLoadError} actionLayout="responsive" />
        ) : !countsLoading && !hasCounts ? (
          <EmptyState
            title="Noch keine Stichtagszahlen"
            description="moto erfasst die Zahlen am Stichtag ab 6 Uhr. Fällt die Erfassung am Stichtag aus, holt moto sie im selben Monat nach."
          />
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={tableRows}
            getRowKey={(row) =>
              row.kind === "captured"
                ? `${row.count.period}-${row.count.schoolId}`
                : `pending-${row.schoolId}`
            }
            isLoading={countsLoading}
            defaultSortKey="organization"
          />
        )}
      </SectionCard>

      <BillingKeyDays
        keyDay={keyDay}
        loading={keyDayLoading}
        loadError={keyDayLoadError}
        capturedThisMonth={capturedThisMonth}
        onChanged={(updated) => void mutateKeyDay(updated, false)}
      />
    </TenantPage>
  );
}

export default function OperatorBillingPage() {
  return (
    <Suspense fallback={<TenantPage title="Stichtagszahlen" loading />}>
      <OperatorBillingPageContent />
    </Suspense>
  );
}
