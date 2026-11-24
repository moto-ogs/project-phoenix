"use client";

// Auslastung des Träger-Portals (#4713, ADR 0241): wie voll die Plätze der
// Schulen, ihrer Betreuungsformen und ihrer Räume über einen gewählten
// Zeitraum waren. Oben vier Kennzahlen, darunter der Verlauf als Diagramm
// und je Reiter eine Tabelle; ein Klick auf eine Zeile zeigt ihren Verlauf.
// Nur Zahlen; die Kinder einer Schule mit Namen stehen darunter, nur mit
// „Verträge verwalten“ und erst auf Anforderung. Der Export enthält dieselben
// Zahlen je Tag als CSV.

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import type { DateRange } from "react-day-picker";
import { School } from "lucide-react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { CustomSelect } from "~/components/ui/custom-select";
import { DataTable } from "~/components/ui/data-table";
import { DateRangePicker } from "~/components/ui/date-range-picker";
import { EmptyState } from "~/components/ui/empty-state";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { PlanLegend } from "~/components/ui/planning/plan-legend";
import { PlanningContextBar } from "~/components/ui/planning/planning-context-bar";
import { SectionCard } from "~/components/ui/section-card";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Skeleton } from "~/components/ui/skeleton";
import { StatCard } from "~/components/ui/stat-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { UTILIZATION_CHART_COLORS } from "~/components/traeger/utilization-chart";
import { UtilizationChildrenSection } from "~/components/traeger/utilization-children";
import { FreshPerTraeger } from "~/components/traeger/fresh-per-traeger";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import {
  defaultGranularity,
  offeringRows,
  roomRows,
  schoolRows,
  shiftDays,
  shiftWindow,
  utilizationBuckets,
  utilizationFigures,
  utilizationPresets,
  utilizationSeries,
  windowLength,
  type UtilizationGranularity,
  type UtilizationOfferingRow,
  type UtilizationPoint,
  type UtilizationRoomRow,
} from "~/components/traeger/utilization-model";
import {
  formatAverage,
  formatUtilization,
  OFFERING_COLUMNS,
  ROOM_COLUMNS,
  schoolColumns,
} from "~/components/traeger/utilization-tables";
import {
  traegerExportScope,
  useTraegerListExportItems,
} from "~/components/traeger/traeger-list-export-menu";
import { hasPermission } from "~/lib/auth-utils";
import { calendarConcept } from "~/lib/concepts/calendar";
import { carePlanConcept } from "~/lib/concepts/carePlan";
import { childrenConcept } from "~/lib/concepts/children";
import { roomsConcept } from "~/lib/concepts/rooms";
import { utilizationConcept } from "~/lib/concepts/utilization";
import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { traegerReportKeys } from "~/lib/swr/traeger-report-keys";
import {
  downloadTraegerUtilization,
  fetchTraegerUtilization,
  type SchoolUtilization,
  UTILIZATION_NAMES_RIGHT,
  type UtilizationWindow,
} from "~/lib/traeger-utilization-api";

const UtilizationChart = dynamic(
  () =>
    import("~/components/traeger/utilization-chart").then(
      (module) => module.UtilizationChart,
    ),
  {
    ssr: false,
    loading: () => <Skeleton shape="inner" className="h-72" aria-hidden />,
  },
);

const ALL_SCHOOLS = "all";
/** Ein Fenster ist höchstens 366 Tage lang, wie die Statistik. */
const MAX_WINDOW_DAYS = 366;
/** Der Startzustand: die letzten drei Monate. */
const DEFAULT_PRESET = 1;

type View = "schulen" | "betreuungsformen" | "raeume";

const VIEWS: readonly { value: View; label: string }[] = [
  { value: "schulen", label: "Schulen" },
  { value: "betreuungsformen", label: "Betreuungsformen" },
  { value: "raeume", label: "Räume" },
];

const GRANULARITIES: readonly {
  value: UtilizationGranularity;
  label: string;
}[] = [
  { value: "day", label: "Tage" },
  { value: "week", label: "Wochen" },
  { value: "month", label: "Monate" },
];

const VIEW_CHART: Record<
  View,
  { readonly belegt: string; readonly second?: string }
> = {
  schulen: { belegt: "Belegte Plätze", second: "Kinder anwesend" },
  betreuungsformen: { belegt: "Gebuchte Kinder" },
  raeume: { belegt: "Gleichzeitig im Raum", second: "Kinder am Tag" },
};

/** Die Kennzahlen über dem Diagramm. */
function Figures({
  schools,
  days,
  loading,
}: Readonly<{
  schools: readonly SchoolUtilization[];
  days: readonly string[];
  loading: boolean;
}>) {
  const figures = useMemo(
    () => utilizationFigures(schools, days),
    [schools, days],
  );
  const full = figures.utilization !== null && figures.utilization >= 1;
  return (
    <div className="grid gap-4 max-sm:gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Plätze belegt"
        value={formatUtilization(figures.utilization)}
        hint={
          figures.places > 0
            ? `Ø ${formatAverage(figures.averageBookedPlaces)} von ${figures.places} Plätzen`
            : "Keine Betreuungsform mit Platzgrenze"
        }
        progressPct={
          figures.utilization === null
            ? undefined
            : Math.min(figures.utilization, 1) * 100
        }
        tone={full ? "orange" : "green"}
        icon={<MotoConceptIcon concept={utilizationConcept} />}
        loading={loading}
      />
      <StatCard
        label="Vollster Tag"
        value={formatUtilization(figures.peak?.share ?? null)}
        hint={
          figures.peak
            ? `am ${formatDate(figures.peak.day, true)}`
            : "Kein Tag mit Platzgrenze"
        }
        tone={figures.peak && figures.peak.share >= 1 ? "orange" : "neutral"}
        icon={<MotoConceptIcon concept={calendarConcept} />}
        loading={loading}
      />
      <StatCard
        label="Kinder anwesend"
        value={
          figures.averagePresent === null
            ? "–"
            : `Ø ${formatAverage(figures.averagePresent)}`
        }
        hint={
          figures.averagePresent === null
            ? "Keine Check-ins im Zeitraum"
            : "mit Check-in, je Tag"
        }
        tone="blue"
        icon={<MotoConceptIcon concept={childrenConcept} />}
        loading={loading}
      />
      <StatCard
        label="Ganz belegt"
        value={
          figures.limitedOfferings === 0
            ? "–"
            : `${figures.fullOfferings} von ${figures.limitedOfferings}`
        }
        hint="Betreuungsformen mit mindestens einem vollen Tag"
        tone={figures.fullOfferings > 0 ? "orange" : "neutral"}
        icon={<MotoConceptIcon concept={carePlanConcept} />}
        loading={loading}
      />
    </div>
  );
}

/** Der Hinweis, ab wann eine Schule Zahlen hat, einmal über der Tabelle. */
function DataFromNotice({
  view,
  schools,
  from,
}: Readonly<{
  view: View;
  schools: readonly SchoolUtilization[];
  from: string;
}>) {
  if (view === "betreuungsformen") return null;
  const firstDays = schools
    .map((school) =>
      view === "raeume" ? school.roomDataFrom : school.attendanceFrom,
    )
    .filter((day): day is string => day !== null && day > from)
    .sort();
  const first = firstDays[0];
  if (first === undefined) return null;
  const several = firstDays.length > 1;
  const rooms = view === "raeume";
  let message: string;
  if (several) {
    message = rooms
      ? "Bei einigen Schulen beginnen die Raumbesuche erst im Zeitraum. Die Schulen bewahren sie nur wenige Wochen auf."
      : "Bei einigen Schulen beginnen die Check-ins erst im Zeitraum. Ab wann, steht in der Tabelle unter „Anwesend“.";
  } else {
    message = rooms
      ? `Raumbesuche gibt es erst ab ${formatDate(first)}. Die Schulen bewahren sie nur wenige Wochen auf.`
      : `Check-ins gibt es erst ab ${formatDate(first)}. Für die Tage davor zeigt moto keine Anwesenheit.`;
  }
  return <Alert type="info" message={message} />;
}

interface Selection {
  readonly title: string;
  readonly points: UtilizationPoint[];
}

export default function TraegerUtilizationPage() {
  return (
    <FreshPerTraeger>
      <TraegerUtilizationContent />
    </FreshPerTraeger>
  );
}

function TraegerUtilizationContent() {
  const { data: session } = useSession();
  const canSeeNames = hasPermission(session ?? null, UTILIZATION_NAMES_RIGHT);
  const today = useBerlinToday();
  const presets = useMemo(() => utilizationPresets(today), [today]);
  const defaultWindow = presets[DEFAULT_PRESET]?.window ?? {
    from: today,
    to: today,
  };
  const [period, setPeriod] = useState<UtilizationWindow>(defaultWindow);
  const [granularity, setGranularity] = useState<UtilizationGranularity>(() =>
    defaultGranularity(windowLength(defaultWindow)),
  );
  const [view, setView] = useState<View>("schulen");
  const [schoolId, setSchoolId] = useState(ALL_SCHOOLS);
  const [selectedOffering, setSelectedOffering] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

  const changeWindow = useCallback((next: UtilizationWindow) => {
    let { from } = next;
    if (windowLength({ from, to: next.to }) > MAX_WINDOW_DAYS) {
      from = shiftDays(next.to, -(MAX_WINDOW_DAYS - 1));
    }
    setPeriod({ from, to: next.to });
    setGranularity(defaultGranularity(windowLength({ from, to: next.to })));
  }, []);

  const {
    data: utilization,
    loading,
    error: loadError,
  } = useTraegerResource(
    traegerReportKeys.utilization(period.from, period.to),
    () => fetchTraegerUtilization(period),
    "die Auslastung",
  );

  const allSchools = useMemo(() => utilization?.schools ?? [], [utilization]);
  const schools = useMemo(
    () =>
      schoolId === ALL_SCHOOLS
        ? allSchools
        : allSchools.filter((school) => school.id === schoolId),
    [allSchools, schoolId],
  );
  const days = useMemo(() => utilization?.days ?? [], [utilization]);
  const buckets = useMemo(
    () => utilizationBuckets(days, granularity),
    [days, granularity],
  );
  const schoolTable = useMemo(() => schoolRows(schools, days), [schools, days]);
  const offeringTable = useMemo(() => offeringRows(schools), [schools]);
  const roomTable = useMemo(() => roomRows(schools), [schools]);
  const columns = useMemo(() => schoolColumns(period.from), [period.from]);
  const selectedSchool =
    schoolId === ALL_SCHOOLS
      ? null
      : (allSchools.find((school) => school.id === schoolId) ?? null);

  // The room with the highest average use stands first: a sum over rooms
  // means nothing, so the chart always shows one room.
  const shownRoom: UtilizationRoomRow | undefined = useMemo(() => {
    const chosen = roomTable.find((row) => row.key === selectedRoom);
    if (chosen) return chosen;
    return [...roomTable].sort(
      (a, b) =>
        (b.utilization ?? b.averagePeak ?? -1) -
        (a.utilization ?? a.averagePeak ?? -1),
    )[0];
  }, [roomTable, selectedRoom]);
  const shownOffering: UtilizationOfferingRow | undefined = offeringTable.find(
    (row) => row.key === selectedOffering,
  );

  const selection: Selection | null = useMemo(() => {
    if (view === "raeume") {
      return shownRoom
        ? {
            title: `${shownRoom.name} · ${shownRoom.school.name}`,
            points: utilizationSeries.room(shownRoom.room, buckets),
          }
        : null;
    }
    if (view === "betreuungsformen") {
      return shownOffering
        ? {
            title: `${shownOffering.name} · ${shownOffering.school.name}`,
            points: utilizationSeries.offerings(
              [shownOffering.offering],
              buckets,
            ),
          }
        : {
            title:
              selectedSchool === null
                ? "Alle Betreuungsformen"
                : `Alle Betreuungsformen · ${selectedSchool.name}`,
            points: utilizationSeries.offerings(
              schools.flatMap((school) => school.offerings),
              buckets,
            ),
          };
    }
    return {
      title: selectedSchool === null ? "Alle Schulen" : selectedSchool.name,
      points: utilizationSeries.schools(schools, buckets),
    };
  }, [view, shownRoom, shownOffering, selectedSchool, schools, buckets]);

  const range: DateRange = {
    from: parseISODate(period.from),
    to: parseISODate(period.to),
  };
  const previousWindow = shiftWindow(period, -1, { max: today });
  const nextWindow = shiftWindow(period, 1, { max: today });
  const onDefault =
    period.from === defaultWindow.from && period.to === defaultWindow.to;
  const chart = VIEW_CHART[view];
  const legend = [
    {
      key: "belegt",
      label: chart.belegt,
      color: UTILIZATION_CHART_COLORS.belegt,
      variant: "dot" as const,
    },
    ...(chart.second
      ? [
          {
            key: "second",
            label: chart.second,
            color: UTILIZATION_CHART_COLORS.second,
            variant: "dot" as const,
          },
        ]
      : []),
    {
      key: "places",
      label: "Plätze",
      color: UTILIZATION_CHART_COLORS.places,
      variant: "dot" as const,
    },
  ];
  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerUtilization(
        period,
        schoolId === ALL_SCHOOLS ? undefined : schoolId,
        format,
      ),
    scope: traegerExportScope(selectedSchool?.name),
    fallbackName: `auslastung-${period.from}-bis-${period.to}`,
    errorObject: "die Auslastung",
    unavailable: !utilization,
  });
  const chartEmpty =
    selection === null ||
    selection.points.every(
      (point) => point.belegt === null && point.places === null,
    );

  return (
    <TenantPage
      title="Auslastung"
      info={
        <>
          Hier siehst du, wie voll die Plätze deiner Schulen über die Zeit
          waren. moto zählt die Wochentage im gewählten Zeitraum und zeigt den
          Durchschnitt je Tag, Woche oder Monat. „Belegt“ sind die gebuchten
          Kinder der Betreuungsformen mit Platzgrenze. „Anwesend“ sind die
          Kinder mit Check-in. Ein Tag ohne Check-in, etwa in den Ferien, hat
          keine Zahl. Heute zählt erst, wenn der Tag vorbei ist. Die Kinder von
          heute stehen unter „Belegung“. Im Drei-Punkte-Menü unter
          „Herunterladen“ bekommst du alle Zahlen je Tag als PDF, Excel oder
          CSV.
        </>
      }
      overflowMenu={exportItems}
      stats={
        utilization ? (
          <TenantPageStats
            items={[
              {
                value: `${formatDate(utilization.from)} bis ${formatDate(utilization.to)}`,
                label: "",
              },
              { value: days.length, label: "Wochentage" },
              {
                value: schools.length,
                label: schools.length === 1 ? "Schule" : "Schulen",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      error={loadError}
      empty={
        utilization && allSchools.length === 0
          ? {
              title: "Noch keine Schulen",
              description:
                "Sobald das moto-Team deinem Träger Schulen zuordnet, steht hier ihre Auslastung.",
              icon: <School className="h-12 w-12" aria-hidden="true" />,
            }
          : null
      }
      searchSlot={
        <PlanningContextBar
          withoutContextRow
          navigationInGroup
          navigationSlot={
            <DateRangePicker
              value={range}
              onChange={(next) => {
                if (next?.from && next?.to) {
                  changeWindow({
                    from: toISODate(next.from),
                    to: toISODate(next.to),
                  });
                }
              }}
              presets={presets.map((preset) => ({
                label: preset.label,
                range: () => ({
                  from: parseISODate(preset.window.from),
                  to: parseISODate(preset.window.to),
                }),
              }))}
              toMax={parseISODate(today)}
              className="min-w-0"
              embedded
            />
          }
          onPrevious={
            previousWindow ? () => changeWindow(previousWindow) : undefined
          }
          onNext={nextWindow ? () => changeWindow(nextWindow) : undefined}
          previousLabel="Zeitraum davor"
          nextLabel="Zeitraum danach"
          onToday={onDefault ? undefined : () => changeWindow(defaultWindow)}
          todayLabel="Letzte 3 Monate"
          actions={
            allSchools.length > 1 ? (
              <CustomSelect
                ariaLabel="Schule"
                value={schoolId}
                onChange={(next) => {
                  setSchoolId(next);
                  setSelectedOffering(null);
                  setSelectedRoom(null);
                }}
                options={[
                  { value: ALL_SCHOOLS, label: "Alle Schulen" },
                  ...allSchools.map((school) => ({
                    value: school.id,
                    label: school.name,
                  })),
                ]}
                className="min-w-0 md:w-64"
              />
            ) : undefined
          }
        />
      }
      tabs={{
        value: view,
        onChange: (next) => setView(next as View),
        items: VIEWS,
        label: "Ansicht der Auslastung",
      }}
    >
      <Figures schools={schools} days={days} loading={loading} />
      <SectionCard
        title={selection ? `Verlauf · ${selection.title}` : "Verlauf"}
        concept={view === "raeume" ? roomsConcept : utilizationConcept}
        description={
          view === "schulen"
            ? "Wähle eine Zeile, um den Verlauf einer Schule zu sehen."
            : view === "betreuungsformen"
              ? "Wähle eine Zeile, um den Verlauf einer Betreuungsform zu sehen."
              : "Wähle eine Zeile, um den Verlauf eines Raums zu sehen."
        }
        action={
          <SegmentedControl
            ariaLabel="Auflösung des Verlaufs"
            items={GRANULARITIES}
            value={granularity}
            onChange={setGranularity}
          />
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PlanLegend
              entries={legend}
              size="md"
              aria-label="Legende des Verlaufs"
            />
            {view === "betreuungsformen" && shownOffering ? (
              <Button
                type="button"
                variant="ghost"
                size="compact"
                onClick={() => setSelectedOffering(null)}
                tooltip="Zeigt wieder alle Betreuungsformen zusammen."
              >
                Alle zusammen zeigen
              </Button>
            ) : null}
            {view === "schulen" && selectedSchool ? (
              <Button
                type="button"
                variant="ghost"
                size="compact"
                onClick={() => setSchoolId(ALL_SCHOOLS)}
                tooltip="Zeigt wieder alle Schulen zusammen."
              >
                Alle Schulen zeigen
              </Button>
            ) : null}
          </div>
        }
      >
        {loading ? (
          <Skeleton shape="inner" className="h-72" aria-hidden />
        ) : chartEmpty ? (
          <EmptyState
            variant="compact"
            title={
              view === "raeume"
                ? "Keine Raumbesuche im Zeitraum"
                : "Keine Buchungen im Zeitraum"
            }
            description={
              view === "raeume"
                ? "moto zählt Besuche von Kindern, deren Eltern dem Speichern zugestimmt haben."
                : "Wähle einen anderen Zeitraum oder eine andere Schule."
            }
          />
        ) : (
          <UtilizationChart data={selection?.points ?? []} labels={chart} />
        )}
      </SectionCard>
      {utilization ? (
        <DataFromNotice view={view} schools={schools} from={period.from} />
      ) : null}
      {view === "schulen" ? (
        <>
          <DataTable
            heading={{
              title: "Je Schule",
              count: schoolTable.length,
              level: 2,
            }}
            columns={columns}
            rows={schoolTable}
            getRowKey={(row) => row.school.id}
            onRowClick={(row) => setSchoolId(row.school.id)}
            activeRowKey={selectedSchool?.id ?? null}
            defaultSortKey="name"
            isLoading={loading}
            loadingRowCount={3}
          />
          <UtilizationChildrenSection
            canSeeNames={canSeeNames}
            school={selectedSchool}
            period={period}
          />
        </>
      ) : null}
      {view === "betreuungsformen" ? (
        <DataTable
          heading={{
            title: "Je Betreuungsform",
            count: offeringTable.length,
            level: 2,
          }}
          columns={OFFERING_COLUMNS}
          rows={offeringTable}
          getRowKey={(row) => row.key}
          onRowClick={(row) => setSelectedOffering(row.key)}
          activeRowKey={shownOffering?.key ?? null}
          defaultSortKey="belegt"
          defaultSortDirection="desc"
          isLoading={loading}
          loadingRowCount={3}
          emptyState={
            <EmptyState
              title="Keine Betreuungsform im Zeitraum"
              description="Hier steht jede Betreuungsform, die als Betreuung zählt und im Zeitraum gebucht war."
            />
          }
        />
      ) : null}
      {view === "raeume" ? (
        <DataTable
          heading={{ title: "Je Raum", count: roomTable.length, level: 2 }}
          columns={ROOM_COLUMNS}
          rows={roomTable}
          getRowKey={(row) => row.key}
          onRowClick={(row) => setSelectedRoom(row.key)}
          activeRowKey={shownRoom?.key ?? null}
          defaultSortKey="peak"
          defaultSortDirection="desc"
          isLoading={loading}
          loadingRowCount={3}
          emptyState={
            <EmptyState
              title="Keine Raumbesuche im Zeitraum"
              description="Hier steht jeder Raum mit einem Besuch. Ist das Anwesenheitsprotokoll einer Schule aus, fehlen ihre Räume."
            />
          }
        />
      ) : null}
    </TenantPage>
  );
}
