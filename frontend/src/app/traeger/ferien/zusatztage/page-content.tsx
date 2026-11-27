"use client";

// Zusatztage des Trägers (#4817): einzelne Betreuungstage außerhalb der
// Ferien, etwa Brückentage und bewegliche Ferientage. Von hier aus anlegen
// und öffnen; die Zahl der Kinder steht je Tag in der Liste.

import { CalendarPlus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  extraDayCareTime,
  extraDayDate,
  extraDayFee,
  extraDayPlaced,
  extraDaySchoolCount,
  extraDaysOf,
} from "~/components/traeger/extra-day-model";
import {
  formatDay,
  holidayStatusLabel,
} from "~/components/traeger/holiday-period-format";
import { holidayOverviewTabs } from "~/components/traeger/holiday-period-head";
import {
  traegerExportScope,
  useTraegerListExportItems,
} from "~/components/traeger/traeger-list-export-menu";
import { useTraegerHolidayPeriods } from "~/components/traeger/use-traeger-resources";
import { ButtonLink } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { bffFile } from "~/lib/bff-fetch";
import type { HolidayPeriod } from "~/lib/traeger-api";
import {
  downloadTraegerList,
  listExportQuery,
} from "~/lib/traeger-list-export";
import { traegerPath } from "~/lib/traeger-url";

const COLUMNS: DataTableColumn<HolidayPeriod>[] = [
  {
    key: "name",
    header: "Zusatztag",
    render: (day) => (
      <span className="font-medium text-gray-900">{day.name}</span>
    ),
    sortValue: (day) => day.name,
    stacked: "title",
  },
  {
    // On a phone the line under the name: the day, its care time and the
    // schools; the deadline and the fee stay on the day's own page.
    key: "day",
    header: "Tag",
    render: (day) => <span className="tabular-nums">{extraDayDate(day)}</span>,
    stackedRender: (day) =>
      `${extraDayDate(day)} · ${extraDayCareTime(day)} · ${extraDaySchoolCount(day)}`,
    stackedLabel: false,
    sortValue: (day) => day.weeks[0]?.startsOn ?? null,
  },
  {
    key: "schools",
    header: "Schulen",
    render: (day) => extraDaySchoolCount(day),
    sortValue: (day) => day.weeks.length,
    stacked: "hidden",
  },
  {
    key: "closes",
    header: "Anmeldung bis",
    render: (day) => (
      <span className="tabular-nums">
        {formatDay(day.registrationClosesOn)}
      </span>
    ),
    sortValue: (day) => day.registrationClosesOn,
    stacked: "hidden",
  },
  {
    key: "fee",
    header: "Beitrag",
    render: (day) => extraDayFee(day),
    sortValue: (day) => extraDayFee(day),
    stacked: "hidden",
  },
  {
    key: "placed",
    header: "Kinder",
    align: "right",
    render: (day) => (
      <span className="tabular-nums">{extraDayPlaced(day)}</span>
    ),
    stackedRender: (day) => {
      const placed = extraDayPlaced(day);
      return placed === 1 ? "1 Kind" : `${placed} Kinder`;
    },
    stackedLabel: false,
    sortValue: (day) => extraDayPlaced(day),
  },
  {
    key: "status",
    header: "Status",
    render: (day) => (
      <StatusBadge
        label={holidayStatusLabel(day)}
        tone={day.status === "published" ? "green" : "gray"}
      />
    ),
    sortValue: (day) => day.status ?? "",
    stacked: "meta",
  },
];

export default function TraegerExtraDaysPage() {
  const router = useRouter();
  const { data, isLoading: loading, loadError } = useTraegerHolidayPeriods();
  const days = useMemo(() => extraDaysOf(data ?? []), [data]);

  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerList(
        bffFile("org", "GET /traeger/holiday-periods/export", {
          query: listExportQuery(format, { kind: "extra_day" }),
        }),
      ),
    scope: traegerExportScope(),
    fallbackName: "zusatztage",
    errorObject: "die Zusatztage",
    unavailable: days.length === 0,
  });

  const published = days.filter((day) => day.status === "published").length;
  const children = days.reduce((sum, day) => sum + extraDayPlaced(day), 0);

  return (
    <TenantPage
      title="Ferienbetreuung"
      info="Ein Zusatztag ist ein einzelner Betreuungstag außerhalb der Ferien, zum Beispiel ein Brückentag oder ein beweglicher Ferientag. Du legst ihn für eine oder mehrere Schulen an. Eltern melden ihr Kind erst an, wenn du ihn veröffentlicht hast."
      stats={
        days.length > 0 ? (
          <TenantPageStats
            items={[
              {
                value: days.length,
                label: days.length === 1 ? "Zusatztag" : "Zusatztage",
              },
              { value: published, label: "veröffentlicht" },
              {
                value: children,
                label: children === 1 ? "Kind mit Platz" : "Kinder mit Platz",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      error={loadError}
      tabs={holidayOverviewTabs("zusatztage")}
      overflowMenu={exportItems}
      actions={
        <ButtonLink
          href={traegerPath("/traeger/ferien/zusatztage/neu")}
          variant="primary"
          size="md"
          tooltip="Öffnet einen neuen Zusatztag als Entwurf, Eltern sehen ihn noch nicht."
          className="gap-2"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Zusatztag anlegen
        </ButtonLink>
      }
    >
      <DataTable
        columns={COLUMNS}
        rows={days}
        getRowKey={(day) => day.id}
        isLoading={loading}
        loadingRowCount={3}
        stackedLayout="row"
        stackedDetailKey="day"
        onRowClick={(day) =>
          router.push(traegerPath(`/traeger/ferien/${day.id}`))
        }
        emptyState={
          <EmptyState
            icon={<CalendarPlus className="h-12 w-12" aria-hidden="true" />}
            title="Noch kein Zusatztag."
            description="Lege oben einen Zusatztag an, zum Beispiel für einen Brückentag. Danach wählst du die Schulen und den Beitrag."
          />
        }
      />
    </TenantPage>
  );
}
