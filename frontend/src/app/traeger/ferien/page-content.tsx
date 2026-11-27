"use client";

import { bffFile } from "~/lib/bff-fetch";

// Ferienzeiträume des Trägers (#4659): Übersicht aller Zeiträume, von hier
// aus anlegen und öffnen.

import { CalendarDays, ListChecks, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  formatDateRange,
  formatWeeks,
  holidayStatusLabel,
} from "~/components/traeger/holiday-period-format";
import {
  HOLIDAY_CRITERIA_HINT,
  holidayOverviewTabs,
} from "~/components/traeger/holiday-period-head";
import { ButtonLink } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import {
  traegerExportScope,
  useTraegerListExportItems,
} from "~/components/traeger/traeger-list-export-menu";
import type { HolidayPeriod } from "~/lib/traeger-api";
import {
  downloadTraegerList,
  listExportQuery,
} from "~/lib/traeger-list-export";
import { useTraegerHolidayPeriods } from "~/components/traeger/use-traeger-resources";
import { traegerPath } from "~/lib/traeger-url";

const COLUMNS: DataTableColumn<HolidayPeriod>[] = [
  {
    key: "name",
    header: "Ferienzeitraum",
    render: (period) => (
      <span className="font-medium text-gray-900">{period.name}</span>
    ),
    sortValue: (period) => period.name,
    stacked: "title",
  },
  {
    key: "registration",
    header: "Anmeldung",
    render: (period) =>
      formatDateRange(period.registrationOpensOn, period.registrationClosesOn),
    sortValue: (period) => period.registrationOpensOn,
    stacked: "hidden",
  },
  {
    // On a phone the line under the name: the care weeks, then the
    // registration window with its own label (only the status is meta).
    key: "weeks",
    header: "Wochen",
    render: (period) => formatWeeks(period),
    stackedRender: (period) =>
      `${formatWeeks(period)} · Anmeldung ${formatDateRange(period.registrationOpensOn, period.registrationClosesOn)}`,
    // The weeks name themselves; the label would only stand in front.
    stackedLabel: false,
    sortValue: (period) => period.weeks[0]?.startsOn ?? null,
  },
  {
    key: "status",
    header: "Status",
    render: (period) => (
      <StatusBadge
        label={holidayStatusLabel(period)}
        tone={period.status === "published" ? "green" : "gray"}
      />
    ),
    sortValue: (period) => period.status ?? "",
    stacked: "meta",
  },
];

export default function TraegerHolidayPeriodsPage() {
  const router = useRouter();
  const { data, isLoading: loading, loadError } = useTraegerHolidayPeriods();
  // Zusatztage haben ihre eigene Liste (#4817).
  const periods = useMemo(
    () => (data ?? []).filter((period) => period.kind !== "extra_day"),
    [data],
  );

  const newHref = traegerPath("/traeger/ferien/neu");

  // Herunterladen und der Weg zu den Kriterien stehen im Drei-Punkte-Menü;
  // sichtbar bleibt nur „Ferienzeitraum anlegen“ (#7411).
  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerList(
        bffFile("org", "GET /traeger/holiday-periods/export", {
          query: listExportQuery(format, { kind: "holiday" }),
        }),
      ),
    scope: traegerExportScope(),
    fallbackName: "ferienzeitraeume",
    errorObject: "die Ferienzeiträume",
    unavailable: periods.length === 0,
  });

  const published = periods.filter(
    (period) => period.status === "published",
  ).length;

  return (
    <TenantPage
      title="Ferienbetreuung"
      info="Hier planst du die Ferienbetreuung für die Schulen deines Trägers. Ein neuer Ferienzeitraum ist zuerst ein Entwurf. Eltern melden ihre Kinder erst an, wenn du ihn veröffentlicht hast. Einzelne Tage außerhalb der Ferien, zum Beispiel einen Brückentag, planst du unter „Zusatztage“."
      stats={
        periods.length > 0 ? (
          <TenantPageStats
            items={[
              {
                value: periods.length,
                label:
                  periods.length === 1 ? "Ferienzeitraum" : "Ferienzeiträume",
              },
              { value: published, label: "veröffentlicht" },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      error={loadError}
      tabs={holidayOverviewTabs("ferien")}
      overflowMenu={[
        {
          label: "Kriterien der Platzvergabe",
          description: HOLIDAY_CRITERIA_HINT,
          icon: <ListChecks className="h-4 w-4" aria-hidden="true" />,
          href: traegerPath("/traeger/ferien/kriterien"),
          onClick: () => undefined,
        },
        { kind: "separator" },
        ...exportItems,
      ]}
      actions={
        <ButtonLink
          href={newHref}
          variant="primary"
          size="md"
          tooltip="Öffnet einen neuen Ferienzeitraum als Entwurf, Eltern sehen ihn noch nicht."
          className="gap-2"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Ferienzeitraum anlegen
        </ButtonLink>
      }
    >
      <DataTable
        columns={COLUMNS}
        rows={periods}
        getRowKey={(period) => period.id}
        isLoading={loading}
        loadingRowCount={3}
        stackedLayout="row"
        stackedDetailKey="weeks"
        onRowClick={(period) =>
          router.push(traegerPath(`/traeger/ferien/${period.id}`))
        }
        emptyState={
          <EmptyState
            icon={<CalendarDays className="h-12 w-12" aria-hidden="true" />}
            title="Noch kein Ferienzeitraum."
            description="Lege oben einen Ferienzeitraum an. Danach planst du die Wochen."
          />
        }
      />
    </TenantPage>
  );
}
