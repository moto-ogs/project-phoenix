"use client";

// Ankunft und Abholung (#4714): wann Kinder an den Schulen des Trägers
// ankommen und gehen, je Wochentag und halbe Stunde, damit das Träger-Büro
// Personal für die vollen Zeiten plant. Zwei Heatmaps über alle Schulen oder
// eine Schule, dazu die Hauptzeiten und eine Zeile je Schule. Nur
// Durchschnitte, keine Kinder; dafür reicht das Recht „Berichte lesen“.

import { useMemo, useState } from "react";
import { CalendarOff, School } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { CustomSelect } from "~/components/ui/custom-select";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { DateRangePicker } from "~/components/ui/date-range-picker";
import { EmptyState } from "~/components/ui/empty-state";
import {
  Heatmap,
  type HeatmapCell,
  type HeatmapRow,
  type HeatmapTone,
} from "~/components/ui/heatmap";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { PlanningContextBar } from "~/components/ui/planning/planning-context-bar";
import { SectionCard } from "~/components/ui/section-card";
import { StatCard } from "~/components/ui/stat-card";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import {
  type ArrivalPickupKind,
  type ArrivalPickupPeak,
  childrenLabel,
  childrenPerDay,
  clockLabel,
  dayTotal,
  formatAverage,
  hasData,
  hourTick,
  peakLabel,
  peakOf,
  weekdayName,
  weekdayShort,
} from "~/components/traeger/arrival-pickup-model";
import { useTraegerArrivalPickupTimes } from "~/components/traeger/use-traeger-arrival-pickup-times";
import {
  traegerExportScope,
  useTraegerListExportItems,
} from "~/components/traeger/traeger-list-export-menu";
import { shiftWindow } from "~/components/traeger/utilization-model";
import type { MotoConcept } from "~/lib/moto-concepts";
import { childrenConcept } from "~/lib/concepts/children";
import { pickupConcept } from "~/lib/concepts/pickup";
import { presentConcept } from "~/lib/concepts/present";
import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import type {
  ArrivalPickupHeatmap,
  ArrivalPickupPeriod,
  TraegerArrivalPickupTimes,
  TraegerSchoolArrivalPickup,
} from "~/lib/traeger-arrival-pickup-api";
import { downloadTraegerArrivalPickupTimes } from "~/lib/traeger-arrival-pickup-api";

/** So weit reicht ein Zeitraum zurück: ein Jahr, wie im Backend. */
const MAX_DAYS = 366;

function daysBefore(day: Date, days: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - days);
}

/** Die letzten vier Wochen bis gestern: heute ist noch nicht vorbei. */
function defaultRange(yesterday: Date): DateRange {
  return { from: daysBefore(yesterday, 27), to: yesterday };
}

function rangePresets(yesterday: Date) {
  const back = (days: number) => () => ({
    from: daysBefore(yesterday, days - 1),
    to: yesterday,
  });
  return [
    { label: "Letzte 4 Wochen", range: back(28) },
    { label: "Letzte 8 Wochen", range: back(56) },
    { label: "Letzte 3 Monate", range: back(91) },
    { label: "Letzte 12 Monate", range: back(365) },
  ];
}

const KIND_WORDS: Record<
  ArrivalPickupKind,
  { one: string; many: string; title: string; tone: HeatmapTone }
> = {
  arrivals: {
    one: "kommt an",
    many: "kommen an",
    title: "Ankunft",
    tone: "green",
  },
  pickups: { one: "geht", many: "gehen", title: "Abholung", tone: "blue" },
};

/** „Montag, 11:30 bis 12:00 Uhr: im Schnitt 20 Kinder kommen an.“ */
function cellSentence(
  weekday: string,
  startMinute: number,
  slotMinutes: number,
  value: number,
  kind: ArrivalPickupKind,
): string {
  const words = KIND_WORDS[kind];
  const span = `${clockLabel(startMinute)} bis ${clockLabel(startMinute + slotMinutes)} Uhr`;
  if (value <= 0) return `${weekday}, ${span}: kein Kind ${words.one}.`;
  return `${weekday}, ${span}: im Schnitt ${childrenLabel(value)} ${value === 1 ? words.one : words.many}.`;
}

function peakSentence(
  peak: ArrivalPickupPeak | null,
  slotMinutes: number,
  kind: ArrivalPickupKind,
): string {
  if (!peak) return "";
  return `Am meisten: ${cellSentence(weekdayName(peak.weekday), peak.startMinute, slotMinutes, peak.value, kind)}`;
}

/** „aus 4 Tagen“ unter dem Wochentag; ohne Tag „keine Daten“. */
function daysMeta(days: number): string {
  if (days === 0) return "keine Daten";
  return days === 1 ? "aus 1 Tag" : `aus ${days} Tagen`;
}

function heatmapRows(
  heatmap: ArrivalPickupHeatmap,
  kind: ArrivalPickupKind,
  withDays: boolean,
): HeatmapRow[] {
  return heatmap.weekdays.map((row) => ({
    key: String(row.weekday),
    label: weekdayName(row.weekday),
    shortLabel: weekdayShort(row.weekday),
    meta: withDays
      ? daysMeta(row.days)
      : row.days === 0
        ? "keine Daten"
        : `${childrenLabel(Math.round(dayTotal(row, kind)))} am Tag`,
    values: row.slots.map((slot) => slot[kind]),
  }));
}

function peakCell(
  heatmap: ArrivalPickupHeatmap,
  peak: ArrivalPickupPeak | null,
): HeatmapCell | null {
  if (!peak) return null;
  const row = heatmap.weekdays.findIndex((r) => r.weekday === peak.weekday);
  const column =
    heatmap.weekdays[row]?.slots.findIndex(
      (slot) => slot.startMinute === peak.startMinute,
    ) ?? -1;
  return row < 0 || column < 0 ? null : { row, column };
}

function KindCard({
  kind,
  heatmap,
  times,
  withDays,
}: Readonly<{
  kind: ArrivalPickupKind;
  heatmap: ArrivalPickupHeatmap;
  times: TraegerArrivalPickupTimes;
  withDays: boolean;
}>) {
  const words = KIND_WORDS[kind];
  const peak = useMemo(() => peakOf(heatmap, kind), [heatmap, kind]);
  const rows = useMemo(
    () => heatmapRows(heatmap, kind, withDays),
    [heatmap, kind, withDays],
  );
  const columns = useMemo(
    () =>
      (heatmap.weekdays[0]?.slots ?? []).map((slot) => ({
        key: String(slot.startMinute),
        label: `${clockLabel(slot.startMinute)} bis ${clockLabel(slot.startMinute + times.slotMinutes)} Uhr`,
        tick: hourTick(slot.startMinute),
      })),
    [heatmap, times.slotMinutes],
  );
  return (
    <SectionCard
      concept={kind === "arrivals" ? presentConcept : pickupConcept}
      title={words.title}
      description={
        kind === "arrivals"
          ? "So viele Kinder kommen an einem normalen Tag in jeder halben Stunde an. Es zählt das erste Einchecken am Tag."
          : "So viele Kinder gehen an einem normalen Tag in jeder halben Stunde. Es zählt das letzte Auschecken am Tag."
      }
    >
      <Heatmap
        caption={`${words.title} je Wochentag und halbe Stunde`}
        columns={columns}
        rows={rows}
        tone={words.tone}
        formatValue={(value) => (value >= 1 ? String(Math.round(value)) : "")}
        describeCell={(row, column, value) =>
          cellSentence(
            row.label,
            Number(column.key),
            times.slotMinutes,
            value,
            kind,
          )
        }
        summary={peakSentence(peak, times.slotMinutes, kind)}
        highlight={peakCell(heatmap, peak)}
        legend={{
          low: "0",
          high: peak ? childrenLabel(peak.value) : "0",
        }}
      />
    </SectionCard>
  );
}

function PeakFigure({
  label,
  peak,
  slotMinutes,
  tone,
  concept,
  loading,
}: Readonly<{
  label: string;
  peak: ArrivalPickupPeak | null;
  slotMinutes: number;
  tone: "green" | "blue";
  concept: MotoConcept;
  loading: boolean;
}>) {
  return (
    <StatCard
      label={label}
      value={loading ? 0 : peak ? peakLabel(peak) : "–"}
      hint={
        loading
          ? undefined
          : peak
            ? `Im Schnitt ${childrenLabel(peak.value)} von ${clockLabel(peak.startMinute)} bis ${clockLabel(peak.startMinute + slotMinutes)} Uhr.`
            : "Im Zeitraum hat moto keine Zeiten gezählt."
      }
      icon={<MotoConceptIcon concept={concept} />}
      loading={loading}
      tone={peak ? tone : "neutral"}
    />
  );
}

function Figures({
  heatmap,
  slotMinutes,
  loading,
}: Readonly<{
  heatmap: ArrivalPickupHeatmap | null;
  slotMinutes: number;
  loading: boolean;
}>) {
  const arrivals = heatmap ? peakOf(heatmap, "arrivals") : null;
  const pickups = heatmap ? peakOf(heatmap, "pickups") : null;
  const perDay = heatmap ? childrenPerDay(heatmap) : null;
  return (
    <div className="grid gap-4 max-sm:gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <PeakFigure
        label="Meiste Ankünfte"
        peak={arrivals}
        slotMinutes={slotMinutes}
        tone="green"
        concept={presentConcept}
        loading={loading}
      />
      <PeakFigure
        label="Meiste Abholungen"
        peak={pickups}
        slotMinutes={slotMinutes}
        tone="blue"
        concept={pickupConcept}
        loading={loading}
      />
      <StatCard
        label="Kinder am Tag"
        value={loading ? 0 : perDay === null ? "–" : Math.round(perDay)}
        hint={
          loading
            ? undefined
            : perDay === null
              ? "Ohne Check-ins gibt es keine Zahl."
              : "So viele Kinder kommen an einem normalen Tag an."
        }
        icon={<MotoConceptIcon concept={childrenConcept} />}
        loading={loading}
        tone="neutral"
      />
    </div>
  );
}

function PeakCell({ peak }: Readonly<{ peak: ArrivalPickupPeak | null }>) {
  if (!peak) {
    return (
      <span className="text-sm text-gray-500">
        –<span className="sr-only">, keine Zeiten gezählt</span>
      </span>
    );
  }
  return (
    <span className="text-sm whitespace-nowrap tabular-nums">
      <span className="font-semibold text-gray-900">{peakLabel(peak)}</span>
      <span className="text-gray-500"> · {childrenLabel(peak.value)}</span>
    </span>
  );
}

function schoolColumns(
  firstOfAll: string | null,
): DataTableColumn<TraegerSchoolArrivalPickup>[] {
  return [
    {
      key: "name",
      header: "Schule",
      render: (school) => (
        <div className="min-w-0">
          <span className="font-medium text-gray-900">{school.name}</span>
          {school.city ? (
            <span className="block text-sm text-gray-500 max-md:hidden">
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
      header: "Tage",
      align: "right",
      render: (school) => {
        const days = school.weekdays.reduce((sum, row) => sum + row.days, 0);
        return (
          <span className="text-sm text-gray-900 tabular-nums">
            <span className="font-semibold">{days}</span>
            {school.firstDay && firstOfAll && school.firstDay > firstOfAll ? (
              <span className="block text-sm text-gray-500">
                ab {formatDate(school.firstDay)}
              </span>
            ) : null}
          </span>
        );
      },
      sortValue: (school) =>
        school.weekdays.reduce((sum, row) => sum + row.days, 0),
    },
    {
      key: "arrivals",
      header: "Meiste Ankünfte",
      render: (school) => <PeakCell peak={peakOf(school, "arrivals")} />,
      sortValue: (school) => peakOf(school, "arrivals")?.value ?? null,
    },
    {
      key: "pickups",
      header: "Meiste Abholungen",
      render: (school) => <PeakCell peak={peakOf(school, "pickups")} />,
      sortValue: (school) => peakOf(school, "pickups")?.value ?? null,
    },
    {
      key: "perDay",
      header: "Kinder am Tag",
      align: "right",
      render: (school) => {
        const perDay = childrenPerDay(school);
        return (
          <span className="text-sm font-semibold text-gray-900 tabular-nums">
            {perDay === null ? "–" : formatAverage(Math.round(perDay))}
          </span>
        );
      },
      sortValue: (school) => childrenPerDay(school),
    },
  ];
}

export default function TraegerArrivalPickupPage() {
  const today = useBerlinToday();
  const yesterday = useMemo(() => daysBefore(parseISODate(today), 1), [today]);
  const [range, setRange] = useState<DateRange | undefined>(() =>
    defaultRange(yesterday),
  );
  const [period, setPeriod] = useState<ArrivalPickupPeriod>(() => {
    const initial = defaultRange(yesterday);
    return { from: toISODate(initial.from!), to: toISODate(initial.to!) };
  });
  const [schoolId, setSchoolId] = useState("");
  const { times, error, reportError, loading } =
    useTraegerArrivalPickupTimes(period);

  const schools = times?.schools ?? [];
  const selected = schools.find((school) => school.id === schoolId) ?? null;
  const heatmap: ArrivalPickupHeatmap | null = selected ?? times?.all ?? null;
  // „ab …“ steht nur bei einer Schule, deren Daten später beginnen als die
  // der anderen; ein Zeitraum, der am Wochenende beginnt, betrifft alle.
  const firstOfAll = useMemo(
    () =>
      (times?.schools ?? []).reduce<string | null>(
        (first, school) =>
          school.firstDay && (first === null || school.firstDay < first)
            ? school.firstDay
            : first,
        null,
      ),
    [times],
  );
  const columns = useMemo(() => schoolColumns(firstOfAll), [firstOfAll]);

  function changeRange(next: DateRange | undefined) {
    setRange(next);
    if (next?.from && next.to) {
      setPeriod({ from: toISODate(next.from), to: toISODate(next.to) });
    }
  }

  // Die Pfeile schieben den Zeitraum um seine Länge, innerhalb der Auswahl.
  const bounds = {
    min: toISODate(daysBefore(yesterday, MAX_DAYS - 1)),
    max: toISODate(yesterday),
  };
  const previousPeriod = shiftWindow(period, -1, bounds);
  const nextPeriod = shiftWindow(period, 1, bounds);
  const initialRange = defaultRange(yesterday);
  const defaultPeriod = {
    from: toISODate(initialRange.from!),
    to: toISODate(initialRange.to!),
  };
  const onDefault =
    period.from === defaultPeriod.from && period.to === defaultPeriod.to;
  function showPeriod(next: ArrivalPickupPeriod) {
    setPeriod(next);
    setRange({ from: parseISODate(next.from), to: parseISODate(next.to) });
  }

  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerArrivalPickupTimes(
        period,
        format,
        selected?.id ?? undefined,
      ),
    scope: traegerExportScope(selected?.name),
    fallbackName: `ankunft-und-abholung-${period.from}-bis-${period.to}`,
    errorObject: "die Ankunfts- und Abholzeiten",
    unavailable: !times,
    onError: reportError,
  });

  const withData = heatmap !== null && hasData(heatmap);

  return (
    <TenantPage
      title="Ankunft und Abholung"
      info={
        <>
          Hier siehst du, wann Kinder an deinen Schulen ankommen und wann sie
          gehen. So planst du Personal für die vollen Zeiten. Jede Zahl ist der
          Durchschnitt eines Tages, zum Beispiel aller Montage im Zeitraum. Es
          zählen nur Tage, an denen die Schule Kinder eingecheckt hat. Heute
          zählt erst morgen mit. moto zeigt hier keine Namen von Kindern.
        </>
      }
      overflowMenu={exportItems}
      stats={
        times ? (
          <TenantPageStats
            items={[
              {
                value: `${formatDate(times.from)} bis ${formatDate(times.to)}`,
                label: "",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      error={error}
      empty={
        times && schools.length === 0
          ? {
              title: "Noch keine Schulen",
              description:
                "Sobald das moto-Team deinem Träger Schulen zuordnet, stehen hier ihre Zeiten.",
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
              onChange={changeRange}
              presets={rangePresets(yesterday)}
              toMax={yesterday}
              fromMin={daysBefore(yesterday, MAX_DAYS - 1)}
              className="min-w-0"
              embedded
            />
          }
          onPrevious={
            previousPeriod ? () => showPeriod(previousPeriod) : undefined
          }
          onNext={nextPeriod ? () => showPeriod(nextPeriod) : undefined}
          previousLabel="Zeitraum davor"
          nextLabel="Zeitraum danach"
          onToday={onDefault ? undefined : () => showPeriod(defaultPeriod)}
          todayLabel="Letzte 4 Wochen"
          actions={
            schools.length > 1 ? (
              <CustomSelect
                ariaLabel="Schule"
                value={schoolId}
                onChange={setSchoolId}
                options={[
                  { value: "", label: "Alle Schulen" },
                  ...schools.map((school) => ({
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
    >
      <Figures
        heatmap={heatmap}
        slotMinutes={times?.slotMinutes ?? 30}
        loading={loading}
      />
      {times && heatmap && withData ? (
        <>
          <KindCard
            kind="arrivals"
            heatmap={heatmap}
            times={times}
            withDays={selected !== null || schools.length === 1}
          />
          <KindCard
            kind="pickups"
            heatmap={heatmap}
            times={times}
            withDays={selected !== null || schools.length === 1}
          />
        </>
      ) : times ? (
        <SectionCard>
          <EmptyState
            icon={<CalendarOff className="h-12 w-12" aria-hidden="true" />}
            title={
              selected
                ? "Diese Schule hat in diesem Zeitraum keine Kinder eingecheckt."
                : "In diesem Zeitraum hat keine Schule Kinder eingecheckt."
            }
            description={
              selected
                ? "Wähle einen anderen Zeitraum oder alle Schulen."
                : "Wähle einen anderen Zeitraum."
            }
          />
        </SectionCard>
      ) : (
        <SectionCard loading title="Ankunft" />
      )}
      {schools.length > 1 && !selected ? (
        <DataTable
          heading={{ title: "Je Schule", count: schools.length, level: 2 }}
          columns={columns}
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
