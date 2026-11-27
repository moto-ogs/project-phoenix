"use client";

// Zusatztage der Schule (#4817, ADR 0329): einzelne Betreuungstage außerhalb
// der Ferien, die die Schule für sich selbst anlegt, etwa ein Brückentag.
// Plätze, Anmeldungen und Abrechnung bleiben beim Träger.

import { CalendarPlus, Plus } from "lucide-react";
import {
  extraDayCareTime,
  extraDayDate,
  extraDayFee,
  extraDayPlaced,
} from "~/components/traeger/extra-day-model";
import {
  formatDay,
  holidayStatusLabel,
} from "~/components/traeger/holiday-period-format";
import { ButtonLink } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useRequirePermission } from "~/lib/hooks/use-require-permission";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { fetchSchoolExtraDays } from "~/lib/school-extra-days-api";
import { useSWRAuth } from "~/lib/swr";
import { holidayKeys } from "~/lib/swr/portal-keys";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { useTenantRouter } from "~/lib/tenant-router";
import type { HolidayPeriod } from "~/lib/traeger-api";

const SCHOOL_EXTRA_DAYS_PATH = "/ferienwochen/zusatztage";

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
    key: "day",
    header: "Tag",
    render: (day) => (
      <span className="tabular-nums">
        {extraDayDate(day)}
        <span className="block text-xs text-gray-600">
          {extraDayCareTime(day)}
        </span>
      </span>
    ),
    stackedRender: (day) => extraDayDate(day),
    stackedLabel: false,
    sortValue: (day) => day.weeks[0]?.startsOn ?? null,
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

export default function SchoolExtraDaysPage() {
  const { isReady } = useRequirePermission("schedules:update");
  const router = useTenantRouter();
  const tenantPath = useTenantAwarePath();
  const read = useSWRAuth(
    isReady ? holidayKeys.extraDays() : null,
    fetchSchoolExtraDays,
  );
  const loadError = useSwrLoadError(read.error, "die Zusatztage", () =>
    read.mutate(),
  );
  const days = read.data ?? [];
  const loading = !read.data && !read.error;
  const published = days.filter((day) => day.status === "published").length;
  const children = days.reduce((sum, day) => sum + extraDayPlaced(day), 0);

  return (
    <TenantPage
      title="Zusatztage"
      info="Ein Zusatztag ist ein einzelner Betreuungstag außerhalb der Ferien, zum Beispiel ein Brückentag oder ein beweglicher Ferientag. Hier legst du ihn für deine OGS an. Eltern melden ihr Kind erst an, wenn du ihn veröffentlicht hast. Die Anmeldungen bestätigt dein Träger. Bestätigte Kinder stehen danach unter „Ferienwochen“. Zusatztage, die dein Träger angelegt hat, stehen nicht in dieser Liste."
      back
      backHref={tenantPath("/ferienwochen")}
      backLabel="Zurück zu den Ferienwochen"
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
      actions={
        <ButtonLink
          href={tenantPath(`${SCHOOL_EXTRA_DAYS_PATH}/neu`)}
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
        onRowClick={(day) => router.push(`${SCHOOL_EXTRA_DAYS_PATH}/${day.id}`)}
        emptyState={
          <EmptyState
            icon={<CalendarPlus className="h-12 w-12" aria-hidden="true" />}
            title="Noch kein Zusatztag."
            description="Lege oben einen Zusatztag an, zum Beispiel für einen Brückentag."
          />
        }
      />
    </TenantPage>
  );
}
