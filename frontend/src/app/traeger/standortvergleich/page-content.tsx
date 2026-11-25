"use client";

// Standortvergleich des Träger-Portals (#4715, ADR 0245): ausgewählte
// Kennzahlen der Schulen über einen gewählten Zeitraum nebeneinander. Oben
// vier Zahlen für alle gewählten Schulen zusammen, darunter die Rangfolge
// einer Kennzahl mit dem Schnitt der Schulen und die Tabelle aller gewählten
// Kennzahlen. Der Export enthält dieselben Schulen und Kennzahlen als PDF,
// Excel oder CSV (#4718).
// Nur Zahlen, keine Kinder.

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { DateRange } from "react-day-picker";
import { School } from "lucide-react";
import { Alert } from "~/components/ui/alert";
import { CustomSelect } from "~/components/ui/custom-select";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { DateRangePicker } from "~/components/ui/date-range-picker";
import { EmptyState } from "~/components/ui/empty-state";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { MultiSelect } from "~/components/ui/multi-select";
import { PlanLegend } from "~/components/ui/planning/plan-legend";
import { PlanningContextBar } from "~/components/ui/planning/planning-context-bar";
import { SectionCard } from "~/components/ui/section-card";
import { Skeleton } from "~/components/ui/skeleton";
import { StatCard } from "~/components/ui/stat-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import NavigationLink from "~/components/ui/navigation-link";
import {
  COMPARISON_CHART_COLORS,
  COMPARISON_METRIC_INFO,
  type ComparisonRow,
  comparisonRows,
  DEFAULT_METRICS,
  DEFAULT_RANKING_METRIC,
  deviationLabel,
  formatMetric,
  metricInfo,
  ranking,
  rowValues,
  spread,
} from "~/components/traeger/comparison-model";
import {
  shiftDays,
  shiftWindow,
  utilizationPresets,
  windowLength,
} from "~/components/traeger/utilization-model";
import { useTraegerListExportItems } from "~/components/traeger/traeger-list-export-menu";
import { FreshPerTraeger } from "~/components/traeger/fresh-per-traeger";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { childrenConcept } from "~/lib/concepts/children";
import { presentConcept } from "~/lib/concepts/present";
import { schoolComparisonConcept } from "~/lib/concepts/schoolComparison";
import { utilizationConcept } from "~/lib/concepts/utilization";
import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { traegerReportKeys } from "~/lib/swr/traeger-report-keys";
import {
  COMPARISON_METRICS,
  type ComparisonMetric,
  downloadTraegerComparison,
  fetchTraegerComparison,
  type TraegerComparison,
} from "~/lib/traeger-comparison-api";
import type { UtilizationWindow } from "~/lib/traeger-utilization-api";
import { traegerPath } from "~/lib/traeger-url";

const ComparisonChart = dynamic(
  () =>
    import("~/components/traeger/comparison-chart").then(
      (module) => module.ComparisonChart,
    ),
  {
    ssr: false,
    loading: () => <Skeleton shape="inner" className="h-56" aria-hidden />,
  },
);

/** Ein Fenster ist höchstens 366 Tage lang, wie die Auslastung. */
const MAX_WINDOW_DAYS = 366;
/** Der Startzustand: die letzten 4 Wochen, damit Check-ins mitzählen. */
const DEFAULT_PRESET = 0;

const METRIC_OPTIONS = COMPARISON_METRIC_INFO.map((info) => ({
  value: info.key,
  label: info.label,
}));

function isMetric(value: string): value is ComparisonMetric {
  return (COMPARISON_METRICS as readonly string[]).includes(value);
}

/** Die Schule mit Link zu ihrer Ansicht, oder der Name einer Summenzeile. */
function RowName({ row }: Readonly<{ row: ComparisonRow }>) {
  if (row.kind !== "school") {
    return <span className="font-semibold text-gray-700">{row.label}</span>;
  }
  return (
    <div className="min-w-0">
      <NavigationLink
        href={traegerPath(`/traeger/schulen/${row.school.id}`)}
        className="font-medium text-gray-900 hover:underline"
      >
        {row.school.name}
      </NavigationLink>
      {row.school.city ? (
        <span className="block text-sm text-gray-500 max-md:hidden">
          {row.school.city}
        </span>
      ) : null}
    </div>
  );
}

/** Die Zahl, darunter der Abstand zum Schnitt. */
function MetricCell({
  metric,
  row,
  comparison,
}: Readonly<{
  metric: ComparisonMetric;
  row: ComparisonRow;
  comparison: TraegerComparison;
}>) {
  const value = rowValues(row)[metric];
  const deviation =
    row.kind === "school"
      ? deviationLabel(
          metric,
          value,
          comparison.average[metric],
          comparison.schools.length,
        )
      : null;
  if (value === undefined) {
    return (
      <span className="text-sm text-gray-500">
        –<span className="sr-only">, keine Zahl im Zeitraum</span>
      </span>
    );
  }
  return (
    <div className="flex flex-col items-end max-md:items-start">
      <span
        className={`text-sm whitespace-nowrap tabular-nums ${row.kind === "school" ? "font-semibold text-gray-900" : "font-medium text-gray-700"}`}
      >
        {formatMetric(metric, value)}
      </span>
      {deviation ? (
        <span className="text-sm whitespace-nowrap text-gray-500">
          {deviation}
        </span>
      ) : null}
    </div>
  );
}

function rowKey(row: ComparisonRow): string {
  return row.kind === "school" ? row.school.id : row.kind;
}

function tableColumns(
  metrics: readonly ComparisonMetric[],
  comparison: TraegerComparison | null,
): DataTableColumn<ComparisonRow>[] {
  return [
    {
      key: "name",
      header: "Schule",
      render: (row) => <RowName row={row} />,
      sortValue: (row) => (row.kind === "school" ? row.school.name : null),
      stacked: "title",
    },
    ...metrics.map((metric): DataTableColumn<ComparisonRow> => ({
      key: metric,
      header: metricInfo(metric).label,
      headerTitle: metricInfo(metric).hint,
      align: "right",
      render: (row) =>
        comparison ? (
          <MetricCell metric={metric} row={row} comparison={comparison} />
        ) : null,
      // The two summary rows stay under the schools in either direction.
      sortValue: (row) =>
        row.kind === "school" ? (row.school.values[metric] ?? null) : null,
      stacked: "field",
    })),
  ];
}

/** Die vier Zahlen über der Rangfolge, für alle gewählten Schulen. */
function Figures({
  comparison,
  loading,
}: Readonly<{ comparison: TraegerComparison | null; loading: boolean }>) {
  const together = comparison?.together ?? {};
  const rate = together.places_rate;
  const range = comparison ? spread(comparison.schools, "places_rate") : null;
  return (
    <div className="grid gap-4 max-sm:gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Plätze belegt"
        value={formatMetric("places_rate", rate)}
        hint={
          together.places === undefined
            ? "Keine Betreuungsform mit Platzgrenze"
            : `alle gewählten Schulen, ${formatMetric("places", together.places)} Plätze`
        }
        progressPct={rate === undefined ? undefined : Math.min(rate, 1) * 100}
        tone={rate !== undefined && rate >= 1 ? "orange" : "green"}
        icon={<MotoConceptIcon concept={utilizationConcept} />}
        loading={loading}
      />
      <StatCard
        label="Unterschied der Belegung"
        value={
          range
            ? `${formatMetric("places_rate", range.lowest.value)} bis ${formatMetric("places_rate", range.highest.value)}`
            : "–"
        }
        hint={
          range
            ? `${range.lowest.school.name} bis ${range.highest.school.name}`
            : "Braucht zwei Schulen mit Platzgrenze"
        }
        tone="neutral"
        icon={<MotoConceptIcon concept={schoolComparisonConcept} />}
        loading={loading}
      />
      <StatCard
        label="Kinder gebucht"
        value={
          together.booked === undefined
            ? "–"
            : `Ø ${formatMetric("booked", together.booked)}`
        }
        hint="alle gewählten Schulen, je Tag"
        tone="blue"
        icon={<MotoConceptIcon concept={childrenConcept} />}
        loading={loading}
      />
      <StatCard
        label="Kinder anwesend"
        value={
          together.present === undefined
            ? "–"
            : `Ø ${formatMetric("present", together.present)}`
        }
        hint={
          together.present === undefined
            ? "Keine Check-ins im Zeitraum"
            : "mit Check-in, je Tag"
        }
        tone="blue"
        icon={<MotoConceptIcon concept={presentConcept} />}
        loading={loading}
      />
    </div>
  );
}

export default function TraegerComparisonPage() {
  return (
    <FreshPerTraeger>
      <TraegerComparisonContent />
    </FreshPerTraeger>
  );
}

function TraegerComparisonContent() {
  const today = useBerlinToday();
  const presets = useMemo(() => utilizationPresets(today), [today]);
  const defaultWindow = presets[DEFAULT_PRESET]?.window ?? {
    from: today,
    to: today,
  };
  const [period, setPeriod] = useState<UtilizationWindow>(defaultWindow);
  const [schoolIds, setSchoolIds] = useState<readonly string[]>([]);
  const [metrics, setMetrics] =
    useState<readonly ComparisonMetric[]>(DEFAULT_METRICS);
  const [rankBy, setRankBy] = useState<ComparisonMetric>(
    DEFAULT_RANKING_METRIC,
  );

  const changeWindow = useCallback((next: UtilizationWindow) => {
    let { from } = next;
    if (windowLength({ from, to: next.to }) > MAX_WINDOW_DAYS) {
      from = shiftDays(next.to, -(MAX_WINDOW_DAYS - 1));
    }
    setPeriod({ from, to: next.to });
  }, []);

  const {
    data: comparison,
    loading,
    error: loadError,
  } = useTraegerResource(
    traegerReportKeys.comparison(period.from, period.to, schoolIds),
    () => fetchTraegerComparison({ ...period, schoolIds }),
    "den Standortvergleich",
  );
  // The school choice offers every school of the Träger, also those not
  // chosen at the moment. Without the list the choice only stays empty; the
  // comparison shows its own error.
  const { schools: traegerSchools } = useTraegerSchools();
  const allSchools = traegerSchools ?? [];

  const schools = useMemo(() => comparison?.schools ?? [], [comparison]);
  const rows = useMemo(
    () =>
      comparison
        ? comparisonRows(schools, comparison.average, comparison.together)
        : [],
    [comparison, schools],
  );
  const columns = useMemo(
    () => tableColumns(metrics, comparison),
    [metrics, comparison],
  );
  const ranked = useMemo(() => ranking(schools, rankBy), [schools, rankBy]);
  const rankInfo = metricInfo(rankBy);
  const averageForRank = comparison?.average[rankBy];
  const missingForRank = schools.length - ranked.length;

  const range: DateRange = {
    from: parseISODate(period.from),
    to: parseISODate(period.to),
  };
  const previousWindow = shiftWindow(period, -1, { max: today });
  const nextWindow = shiftWindow(period, 1, { max: today });
  const onDefault =
    period.from === defaultWindow.from && period.to === defaultWindow.to;
  const schoolCount = allSchools.length || schools.length;
  const noSchools =
    comparison !== null && schoolIds.length === 0 && schools.length === 0;

  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerComparison({ ...period, schoolIds }, metrics, format),
    scope:
      schoolIds.length > 0
        ? schoolIds.length === 1
          ? "Eine gewählte Schule"
          : `${schoolIds.length} gewählte Schulen`
        : "Alle Schulen",
    fallbackName: `standortvergleich-${period.from}-bis-${period.to}`,
    errorObject: "den Standortvergleich",
    unavailable: !comparison || schools.length === 0,
  });

  return (
    <TenantPage
      title="Standortvergleich"
      info={
        <>
          Hier vergleichst du deine Schulen über einen Zeitraum. moto zählt die
          Wochentage im Zeitraum. „Ø“ ist der Durchschnitt je Tag. Unter den
          Schulen stehen der Schnitt der Schulen und alle Schulen zusammen. Eine
          Schule ohne Zahl hat „–“, etwa ohne Platzgrenze oder ohne Check-in. Im
          Drei-Punkte-Menü unter „Herunterladen“ bekommst du die Tabelle mit den
          gewählten Schulen und Kennzahlen als PDF, Excel oder CSV.
        </>
      }
      overflowMenu={exportItems}
      stats={
        comparison ? (
          <TenantPageStats
            items={[
              {
                value: `${formatDate(comparison.from)} bis ${formatDate(comparison.to)}`,
                label: "",
              },
              { value: comparison.days, label: "Wochentage" },
              {
                value:
                  schoolIds.length === 0
                    ? `${schools.length}`
                    : `${schools.length} von ${schoolCount}`,
                label: schoolCount === 1 ? "Schule" : "Schulen",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      error={loadError}
      empty={
        noSchools
          ? {
              title: "Noch keine Schulen",
              description:
                "Sobald das moto-Team deinem Träger Schulen zuordnet, kannst du sie hier vergleichen.",
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
          todayLabel="Letzte 4 Wochen"
          actions={
            allSchools.length > 1 ? (
              <MultiSelect
                ariaLabel="Schulen im Vergleich"
                value={schoolIds}
                onChange={(next) => setSchoolIds(next)}
                options={allSchools.map((school) => ({
                  value: school.id,
                  label: school.name,
                }))}
                placeholder="Alle Schulen"
                summaryLabel={(count) => `${count} Schulen`}
                menuAlign="end"
                className="min-w-0 md:w-64"
              />
            ) : undefined
          }
        />
      }
    >
      <Figures comparison={comparison} loading={loading} />
      {comparison?.attendanceFrom ? (
        <Alert
          type="info"
          message={`Bei einer Schule gibt es Check-ins erst ab ${formatDate(comparison.attendanceFrom)}. „Kinder anwesend“ zählt nur Tage mit Check-ins.`}
        />
      ) : null}
      <SectionCard
        title={`Rangfolge · ${rankInfo.label}`}
        concept={schoolComparisonConcept}
        description={`${rankInfo.hint}. Die größte Zahl steht oben.`}
        action={
          <CustomSelect
            ariaLabel="Kennzahl der Rangfolge"
            value={rankBy}
            onChange={(next) => {
              if (isMetric(next)) setRankBy(next);
            }}
            options={METRIC_OPTIONS}
            className="min-w-0 sm:w-60"
          />
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PlanLegend
              entries={[
                {
                  key: "value",
                  label: rankInfo.label,
                  color: COMPARISON_CHART_COLORS.value,
                  variant: "dot" as const,
                },
                ...(rankBy === "places_rate"
                  ? [
                      {
                        key: "full",
                        label: "Voll oder überbucht",
                        color: COMPARISON_CHART_COLORS.full,
                        variant: "dot" as const,
                      },
                    ]
                  : []),
                ...(averageForRank !== undefined && ranked.length > 1
                  ? [
                      {
                        key: "average",
                        label: `Schnitt ${formatMetric(rankBy, averageForRank)}`,
                        color: COMPARISON_CHART_COLORS.average,
                        variant: "dot" as const,
                      },
                    ]
                  : []),
              ]}
              size="md"
              aria-label="Legende der Rangfolge"
            />
            {missingForRank > 0 ? (
              <span className="text-sm text-gray-500">
                {missingForRank === 1
                  ? "1 Schule ohne Zahl fehlt im Diagramm."
                  : `${missingForRank} Schulen ohne Zahl fehlen im Diagramm.`}
              </span>
            ) : null}
          </div>
        }
      >
        {loading ? (
          <Skeleton shape="inner" className="h-56" aria-hidden />
        ) : ranked.length === 0 ? (
          <EmptyState
            variant="compact"
            title="Keine Zahlen im Zeitraum"
            description="Wähle eine andere Kennzahl, einen anderen Zeitraum oder andere Schulen."
          />
        ) : (
          <ComparisonChart
            entries={ranked}
            metric={rankBy}
            average={averageForRank}
          />
        )}
      </SectionCard>
      <DataTable
        heading={{
          title: "Kennzahlen je Schule",
          level: 2,
          action: (
            <MultiSelect
              ariaLabel="Kennzahlen in der Tabelle"
              value={metrics}
              onChange={(next) => {
                const chosen = COMPARISON_METRICS.filter((metric) =>
                  next.includes(metric),
                );
                setMetrics(chosen.length > 0 ? chosen : DEFAULT_METRICS);
              }}
              options={METRIC_OPTIONS}
              placeholder="Kennzahlen wählen"
              summaryLabel={(count) => `${count} Kennzahlen`}
              menuAlign="end"
              className="min-w-0 sm:w-56"
            />
          ),
        }}
        columns={columns}
        rows={rows}
        getRowKey={rowKey}
        rowTone={(row) => (row.kind === "school" ? null : "muted")}
        defaultSortKey="name"
        isLoading={loading}
        loadingRowCount={3}
        emptyState={
          <EmptyState
            title="Keine Schule im Vergleich"
            description="Sobald deinem Träger Schulen zugeordnet sind, stehen sie hier."
          />
        }
      />
    </TenantPage>
  );
}
