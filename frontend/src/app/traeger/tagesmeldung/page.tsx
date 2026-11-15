"use client";

// Tagesmeldung (#4717): wer an den Schulen des Trägers in
// Mecklenburg-Vorpommern an jedem Tag da war und wer gefehlt hat, mit der
// Verweildauer und der Datei für das Land (§ 32 Absatz 1a KiföG M-V). Zahlen
// ohne Kinder; die Datei nennt ebenfalls kein Kind. Dafür reicht das Recht
// „Berichte lesen“.

import { useMemo, useState } from "react";
import { CalendarOff, School } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Alert } from "~/components/ui/alert";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { DateRangePicker } from "~/components/ui/date-range-picker";
import { EmptyState } from "~/components/ui/empty-state";
import {
  ExportMenu,
  type ExportMenuOption,
  exportFormatOptions,
} from "~/components/ui/export-menu";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import type {
  ActiveFilter,
  FilterConfig,
} from "~/components/ui/page-header/types";
import { SectionCard } from "~/components/ui/section-card";
import { StatCard } from "~/components/ui/stat-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import {
  absentBreakdown,
  absentTotal,
  dayLabel,
  decimalLabel,
  durationLabel,
  isEmptyDay,
  isWeekend,
  limitPeriod,
} from "~/components/traeger/daily-attendance-model";
import { useTraegerDailyAttendance } from "~/components/traeger/use-traeger-daily-attendance";
import { useApiErrorDisplay } from "~/contexts/ToastContext";
import { childrenConcept } from "~/lib/concepts/children";
import { pickupConcept } from "~/lib/concepts/pickup";
import { presentConcept } from "~/lib/concepts/present";
import { sickConcept } from "~/lib/concepts/sick";
import { formatDate, formatTime, toISODate } from "~/lib/date-helpers";
import { downloadBlob } from "~/lib/file-download";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { createLogger } from "~/lib/logger";
import { parseISODate } from "~/lib/date-helpers";
import {
  DAILY_ATTENDANCE_MAX_DAYS,
  type DailyAttendanceDay,
  type DailyAttendancePeriod,
  type DailyAttendanceSummary,
  type TraegerSchoolDailyAttendance,
  downloadTraegerDailyAttendance,
} from "~/lib/traeger-daily-attendance-api";

const logger = createLogger({ component: "TraegerDailyAttendancePage" });

const EXPORT_FORMATS: readonly ExportMenuOption[] = exportFormatOptions([
  "csv",
]);

/** So weit reicht die Auswahl zurück: ein Jahr; ein Zeitraum hat 31 Tage. */
const PICKER_DAYS = 366;

function daysBefore(day: Date, days: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - days);
}

/** Die letzte Woche bis gestern: heute ist noch nicht vorbei. */
function defaultRange(yesterday: Date): DateRange {
  return { from: daysBefore(yesterday, 6), to: yesterday };
}

function rangePresets(yesterday: Date) {
  const back = (days: number) => () => ({
    from: daysBefore(yesterday, days - 1),
    to: yesterday,
  });
  return [
    { label: "Gestern", range: back(1) },
    { label: "Letzte 7 Tage", range: back(7) },
    { label: "Letzte 14 Tage", range: back(14) },
    { label: "Letzte 31 Tage", range: back(DAILY_ATTENDANCE_MAX_DAYS) },
  ];
}

function clock(instant: string | null): string {
  return instant ? formatTime(instant) : "–";
}

function Count({ value }: Readonly<{ value: number }>) {
  return (
    <span
      className={`text-sm tabular-nums ${value > 0 ? "text-gray-900" : "text-gray-500"}`}
    >
      {value}
    </span>
  );
}

function Figures({
  summary,
  loading,
}: Readonly<{ summary: DailyAttendanceSummary | null; loading: boolean }>) {
  const absent = summary ? absentTotal(summary) : 0;
  return (
    <div className="grid gap-4 max-sm:gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Kinder am Tag"
        value={
          loading || !summary
            ? 0
            : summary.daysWithChildren === 0
              ? "–"
              : decimalLabel(summary.presentPerDay)
        }
        hint={
          loading || !summary
            ? undefined
            : summary.daysWithChildren === 0
              ? "Im Zeitraum war kein Kind eingecheckt."
              : `Im Schnitt an ${summary.daysWithChildren} ${summary.daysWithChildren === 1 ? "Tag" : "Tagen"} mit Kindern.`
        }
        icon={<MotoConceptIcon concept={childrenConcept} />}
        loading={loading}
        tone="neutral"
      />
      <StatCard
        label="Verweildauer"
        value={loading || !summary ? 0 : durationLabel(summary.averageMinutes)}
        hint={
          loading
            ? undefined
            : "Im Schnitt vom ersten Einchecken bis zum letzten Auschecken."
        }
        icon={<MotoConceptIcon concept={presentConcept} />}
        loading={loading}
        tone="neutral"
      />
      <StatCard
        label="Längster Tag"
        value={loading || !summary ? 0 : durationLabel(summary.longestMinutes)}
        hint={
          loading
            ? undefined
            : "Die längste Zeit, die ein Kind an einem Tag da war."
        }
        icon={<MotoConceptIcon concept={pickupConcept} />}
        loading={loading}
        tone="neutral"
      />
      <StatCard
        label="Abwesend gemeldet"
        value={loading || !summary ? 0 : absent}
        hint={
          loading || !summary
            ? undefined
            : absent === 0
              ? "Kein Kind war krank, entschuldigt oder auf Klassenfahrt."
              : absentBreakdown(summary)
        }
        icon={<MotoConceptIcon concept={sickConcept} />}
        loading={loading}
        tone="neutral"
      />
    </div>
  );
}

const DAY_COLUMNS: DataTableColumn<DailyAttendanceDay>[] = [
  {
    key: "date",
    header: "Tag",
    render: (day) => (
      <span className="font-medium whitespace-nowrap text-gray-900 tabular-nums">
        {dayLabel(day.date)}
      </span>
    ),
    sortValue: (day) => day.date,
    stacked: "title",
  },
  {
    key: "present",
    header: "Anwesend",
    align: "right",
    render: (day) => (
      <span className="text-sm font-semibold text-gray-900 tabular-nums">
        {day.present}
      </span>
    ),
    sortValue: (day) => day.present,
    stackedTone: "figure",
  },
  {
    key: "sick",
    header: "Krank",
    align: "right",
    render: (day) => <Count value={day.sick} />,
    sortValue: (day) => day.sick,
  },
  {
    key: "excused",
    header: "Entschuldigt",
    align: "right",
    render: (day) => <Count value={day.excused} />,
    sortValue: (day) => day.excused,
  },
  {
    key: "classTrip",
    header: "Klassenfahrt",
    align: "right",
    render: (day) => <Count value={day.classTrip} />,
    sortValue: (day) => day.classTrip,
  },
  {
    key: "firstArrival",
    header: "Erste Ankunft",
    align: "right",
    render: (day) => (
      <span className="text-sm text-gray-700 tabular-nums">
        {clock(day.firstArrival)}
      </span>
    ),
    sortValue: (day) => day.firstArrival,
  },
  {
    key: "lastPickup",
    header: "Letzte Abholung",
    align: "right",
    render: (day) => (
      <span className="text-sm text-gray-700 tabular-nums">
        {clock(day.lastPickup)}
      </span>
    ),
    sortValue: (day) => day.lastPickup,
  },
  {
    key: "average",
    header: "Verweildauer",
    align: "right",
    render: (day) => (
      <span className="text-sm whitespace-nowrap text-gray-900 tabular-nums">
        {durationLabel(day.averageMinutes)}
      </span>
    ),
    sortValue: (day) => day.averageMinutes,
  },
  {
    key: "withoutPickup",
    header: "Ohne Abholung",
    align: "right",
    render: (day) =>
      day.withoutPickup > 0 ? (
        <StatusBadge
          tone="warning"
          label={String(day.withoutPickup)}
          accessibleLabel={`${day.withoutPickup} ${day.withoutPickup === 1 ? "Kind" : "Kinder"} nicht ausgecheckt`}
          compact
        />
      ) : (
        <Count value={0} />
      ),
    sortValue: (day) => day.withoutPickup,
  },
];

const SCHOOL_COLUMNS: DataTableColumn<TraegerSchoolDailyAttendance>[] = [
  {
    key: "name",
    header: "Schule",
    render: (school) => (
      <div className="min-w-0">
        <span className="font-medium text-gray-900">{school.name}</span>
        {school.city ? (
          <span className="block text-xs text-gray-500 max-md:hidden">
            {school.city}
          </span>
        ) : null}
      </div>
    ),
    sortValue: (school) => school.name,
    stacked: "title",
  },
  {
    key: "days",
    header: "Tage mit Kindern",
    align: "right",
    render: (school) => <Count value={school.summary.daysWithChildren} />,
    sortValue: (school) => school.summary.daysWithChildren,
  },
  {
    key: "perDay",
    header: "Kinder am Tag",
    align: "right",
    render: (school) => (
      <span className="text-sm font-semibold text-gray-900 tabular-nums">
        {school.summary.daysWithChildren === 0
          ? "–"
          : decimalLabel(school.summary.presentPerDay)}
      </span>
    ),
    sortValue: (school) => school.summary.presentPerDay,
    stackedTone: "figure",
  },
  {
    key: "average",
    header: "Verweildauer",
    align: "right",
    render: (school) => (
      <span className="text-sm whitespace-nowrap text-gray-900 tabular-nums">
        {durationLabel(school.summary.averageMinutes)}
      </span>
    ),
    sortValue: (school) => school.summary.averageMinutes,
  },
  {
    key: "absent",
    header: "Abwesend gemeldet",
    align: "right",
    render: (school) => <Count value={absentTotal(school.summary)} />,
    sortValue: (school) => absentTotal(school.summary),
  },
];

export default function TraegerDailyAttendancePage() {
  const today = useBerlinToday();
  const yesterday = useMemo(() => daysBefore(parseISODate(today), 1), [today]);
  const [range, setRange] = useState<DateRange | undefined>(() =>
    defaultRange(yesterday),
  );
  const [period, setPeriod] = useState<DailyAttendancePeriod>(() => {
    const initial = defaultRange(yesterday);
    return { from: toISODate(initial.from!), to: toISODate(initial.to!) };
  });
  const [clamped, setClamped] = useState(false);
  const [schoolId, setSchoolId] = useState("");
  const [exporting, setExporting] = useState(false);
  const { report, error, reportError, loading } =
    useTraegerDailyAttendance(period);
  const { show: showActionError } = useApiErrorDisplay();

  const schools = report?.schools ?? [];
  const selected = schools.find((school) => school.id === schoolId) ?? null;
  const days = selected?.days ?? report?.days ?? [];
  const summary = selected?.summary ?? report?.summary ?? null;
  const hasChildren = days.some((day) => !isEmptyDay(day));

  function changeRange(next: DateRange | undefined) {
    setRange(next);
    if (next?.from && next.to) {
      const limited = limitPeriod({
        from: toISODate(next.from),
        to: toISODate(next.to),
      });
      setClamped(limited.clamped);
      setPeriod(limited.period);
      if (limited.clamped) {
        setRange({ from: parseISODate(limited.period.from), to: next.to });
      }
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const file = await downloadTraegerDailyAttendance(period);
      downloadBlob(
        file.blob,
        file.filename ?? `tagesmeldung-mv-${period.from}-bis-${period.to}.csv`,
      );
    } catch (err) {
      reportError(err);
      logger.error("traeger_daily_attendance_export_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await showActionError(err, { object: "die Datei der Tagesmeldung" });
    } finally {
      setExporting(false);
    }
  }

  const filters: FilterConfig[] =
    schools.length > 1
      ? [
          {
            id: "school",
            label: "Schule",
            type: "dropdown",
            value: schoolId,
            onChange: (value) => setSchoolId(value as string),
            options: [
              { value: "", label: "Alle Schulen" },
              ...schools.map((school) => ({
                value: school.id,
                label: school.name,
              })),
            ],
          },
        ]
      : [];
  const activeFilters: ActiveFilter[] = selected
    ? [
        {
          id: "school",
          label: selected.name,
          onRemove: () => setSchoolId(""),
        },
      ]
    : [];

  const statItems = report
    ? [
        {
          value: `${formatDate(report.from)} bis ${formatDate(report.to)}`,
          label: "",
        },
        {
          value: schools.length,
          label: schools.length === 1 ? "Schule in M-V" : "Schulen in M-V",
        },
        ...(report.otherSchools > 0
          ? [
              {
                value: report.otherSchools,
                label:
                  report.otherSchools === 1
                    ? "Schule in einem anderen Land, nicht enthalten"
                    : "Schulen in anderen Ländern, nicht enthalten",
              },
            ]
          : []),
      ]
    : [];

  return (
    <TenantPage
      title="Tagesmeldung"
      info={
        <>
          Träger in Mecklenburg-Vorpommern melden dem Land ab 2027 die tägliche
          An- und Abwesenheit der Kinder (§ 32 Absatz 1a KiföG M-V). Hier sehen
          Sie je Tag, wer da war und wer gefehlt hat. Die Datei enthält eine
          Zeile je Kind und Tag, ohne Namen. Heute zählt erst morgen mit.
        </>
      }
      actions={
        <>
          <DateRangePicker
            value={range}
            onChange={changeRange}
            presets={rangePresets(yesterday)}
            toMax={yesterday}
            fromMin={daysBefore(yesterday, PICKER_DAYS - 1)}
            className="w-full sm:w-auto"
            triggerClassName="w-full sm:w-auto"
          />
          <ExportMenu
            ariaLabel="Tagesmeldung herunterladen"
            tooltip="Lädt die Datei für das Land herunter. Sie enthält keine Namen."
            options={EXPORT_FORMATS}
            busyKey={exporting ? "csv" : null}
            unavailable={!report || schools.length === 0}
            onSelect={() => void exportCsv()}
          />
        </>
      }
      stats={report ? <TenantPageStats items={statItems} /> : null}
      statsLoading={loading}
      error={error}
      empty={
        report && schools.length === 0
          ? {
              title: "Keine Schule in Mecklenburg-Vorpommern",
              description:
                "Die Tagesmeldung gibt es nur für Schulen in Mecklenburg-Vorpommern. Das Bundesland einer Schule stellt das moto-Team ein.",
              icon: <School className="h-12 w-12" aria-hidden="true" />,
            }
          : null
      }
      filters={filters.length > 0 ? filters : undefined}
      activeFilters={activeFilters}
      onClearAllFilters={() => setSchoolId("")}
    >
      <Alert
        type="info"
        title="Das Land legt das Format noch fest"
        message="Bis dahin enthält die Datei je Kind und Tag: Einrichtung, Datum, Status, Ankunft, Abholung und Minuten. Sie enthält keine Namen."
      />
      {clamped ? (
        <Alert
          type="warning"
          message={`Ein Zeitraum hat höchstens ${DAILY_ATTENDANCE_MAX_DAYS} Tage. moto zeigt die ${DAILY_ATTENDANCE_MAX_DAYS} Tage bis zum gewählten Ende.`}
          onDismiss={() => setClamped(false)}
          dismissLabel="Hinweis schließen"
        />
      ) : null}
      <Figures summary={summary} loading={loading} />
      {report && hasChildren ? (
        <DataTable
          heading={{
            title: selected ? `Je Tag: ${selected.name}` : "Je Tag",
            count: days.length,
            level: 2,
          }}
          columns={DAY_COLUMNS}
          rows={[...days]}
          getRowKey={(day) => day.date}
          defaultSortKey="date"
          rowTone={(day) =>
            isEmptyDay(day) || isWeekend(day.date) ? "muted" : null
          }
          stackedOnMobile
        />
      ) : report ? (
        <SectionCard>
          <EmptyState
            icon={<CalendarOff className="h-12 w-12" aria-hidden="true" />}
            title={
              selected
                ? "An dieser Schule war im Zeitraum kein Kind da."
                : "Im Zeitraum war an keiner Schule ein Kind da."
            }
            description={
              selected
                ? "Wählen Sie einen anderen Zeitraum oder alle Schulen."
                : "Wählen Sie einen anderen Zeitraum, zum Beispiel ohne Ferien."
            }
          />
        </SectionCard>
      ) : (
        <SectionCard loading title="Je Tag" />
      )}
      {schools.length > 1 && !selected ? (
        <DataTable
          heading={{ title: "Je Schule", count: schools.length, level: 2 }}
          columns={SCHOOL_COLUMNS}
          rows={[...schools]}
          getRowKey={(school) => school.id}
          defaultSortKey="name"
          onRowClick={(school) => setSchoolId(school.id)}
          stackedOnMobile
        />
      ) : null}
    </TenantPage>
  );
}
