"use client";

// Spalten der vier Abschnitte eines Berichts zum Stichtag (#4716). Jede
// Tabelle zeigt eine Zeile je Schule oder Sozialraum und unten „Gesamt“.
// Ohne Platzgrenze gibt es keinen Anteil, sondern „–“.

import type { ReactNode } from "react";
import type {
  DataTableColumn,
  DataTableExtraRow,
} from "~/components/ui/data-table";
import { ProgressBar } from "~/components/ui/progress-bar";
import { StatusBadge } from "~/components/ui/status-badge";
import {
  demandGap,
  formatCount,
  formatPercent,
  formatRatio,
  placeShare,
  type ReportRow,
} from "./key-date-report-model";

function Figure({
  children,
  muted = false,
}: Readonly<{ children: ReactNode; muted?: boolean }>) {
  return (
    <span
      className={`text-sm whitespace-nowrap tabular-nums ${
        muted ? "text-gray-500" : "font-semibold text-gray-900"
      }`}
    >
      {children}
    </span>
  );
}

function NoFigure({ reason }: Readonly<{ reason: string }>) {
  return (
    <span className="text-sm text-gray-500">
      –<span className="sr-only">, {reason}</span>
    </span>
  );
}

const isTotal = (row: ReportRow) => row.key === "total";

/** Die erste Spalte jeder Tabelle: Schule mit Ort oder Sozialraum mit Zahl der Schulen. */
function nameColumn(header: string): DataTableColumn<ReportRow> {
  return {
    key: "name",
    header,
    stacked: "title",
    render: (row) => (
      <div className="min-w-0">
        <span
          className={`flex flex-wrap items-center gap-2 ${
            isTotal(row)
              ? "font-semibold text-gray-900"
              : "font-medium text-gray-900"
          }`}
        >
          {row.name}
          {row.district ? (
            <StatusBadge tone="gray" size="xs" label={row.district} />
          ) : null}
        </span>
        {row.detail ? (
          <span className="block text-xs text-gray-500">{row.detail}</span>
        ) : null}
      </div>
    ),
  };
}

function countColumn(
  key: string,
  header: string,
  value: (row: ReportRow) => number,
  headerTitle?: string,
): DataTableColumn<ReportRow> {
  return {
    key,
    header,
    headerTitle,
    align: "right",
    render: (row) => <Figure>{formatCount(value(row))}</Figure>,
  };
}

/** Kinder je Standort und Betreuungsform. Eine Zeile klappt die Betreuungsformen auf. */
export function childrenColumns(header: string): DataTableColumn<ReportRow>[] {
  return [
    nameColumn(header),
    countColumn("children", "Kinder", (row) => row.figures.children),
    countColumn(
      "booked",
      "Mit Betreuungsform",
      (row) => row.figures.children - row.figures.withoutCareForm,
      "Kinder mit einer gebuchten Betreuungsform am Stichtag",
    ),
    {
      key: "without",
      header: "Ohne Betreuungsform",
      headerTitle: "Kinder ohne gebuchte Betreuungsform am Stichtag",
      align: "right",
      render: (row) => (
        <Figure muted={row.figures.withoutCareForm === 0}>
          {formatCount(row.figures.withoutCareForm)}
        </Figure>
      ),
    },
    {
      key: "forms",
      header: "Betreuungsformen",
      align: "right",
      stacked: "hidden",
      render: (row) => (
        <Figure muted>{formatCount(row.careForms.length)}</Figure>
      ),
    },
  ];
}

/** Die Betreuungsformen einer Zeile, unter ihr aufgeklappt. */
export function careFormSubRows(row: ReportRow): DataTableExtraRow[] {
  if (row.careForms.length === 0) {
    return [
      {
        key: `${row.key}:none`,
        content: "Keine Betreuungsform am Stichtag.",
      },
    ];
  }
  return row.careForms.map((form) => ({
    key: `${row.key}:${form.name}`,
    cells: [
      {
        columnKey: "name",
        content: (
          <span className="flex flex-wrap items-center gap-2 pl-6">
            {form.name}
            {form.active ? null : (
              <StatusBadge tone="gray" size="xs" label="Nicht mehr angeboten" />
            )}
          </span>
        ),
      },
      {
        columnKey: "children",
        content: (
          <span className="block text-right tabular-nums">
            {formatCount(form.children)}
          </span>
        ),
      },
      {
        columnKey: "booked",
        colSpan: 3,
        content: (
          <span className="block text-right tabular-nums">
            {form.capacity === null
              ? "ohne Platzgrenze"
              : `${formatCount(form.capacity)} Plätze`}
          </span>
        ),
      },
    ],
  }));
}

/** Personal am Stichtag. */
export function staffColumns(header: string): DataTableColumn<ReportRow>[] {
  return [
    nameColumn(header),
    countColumn("staff", "Personal", (row) => row.figures.staff),
    countColumn("children", "Kinder", (row) => row.figures.children),
    {
      key: "ratio",
      header: "Kinder pro Person",
      headerTitle: "Kinder geteilt durch Personal am Stichtag",
      align: "right",
      render: (row) =>
        row.figures.childrenPerStaff === null ? (
          <NoFigure reason="kein Personal" />
        ) : (
          <Figure>{formatRatio(row.figures.childrenPerStaff)}</Figure>
        ),
    },
  ];
}

/** Fehlzeiten im Zeitraum vor dem Stichtag. */
export function absenceColumns(header: string): DataTableColumn<ReportRow>[] {
  return [
    nameColumn(header),
    countColumn(
      "present",
      "Anwesend",
      (row) => row.figures.presentDays,
      "Tage mit Check-in, für alle Kinder zusammen",
    ),
    countColumn(
      "sick",
      "Krank",
      (row) => row.figures.sickDays,
      "Tage mit Krankmeldung, für alle Kinder zusammen",
    ),
    countColumn(
      "excused",
      "Entschuldigt",
      (row) => row.figures.excusedDays,
      "Tage mit Entschuldigung, für alle Kinder zusammen",
    ),
    {
      key: "rate",
      header: "Fehlquote",
      headerTitle:
        "Kranke und entschuldigte Tage im Verhältnis zu allen gezählten Tagen",
      align: "right",
      render: (row) =>
        row.figures.absenceRate === null ? (
          <NoFigure reason="keine Tage im Zeitraum" />
        ) : (
          <Figure>{formatPercent(row.figures.absenceRate)}</Figure>
        ),
    },
  ];
}

function PlacesCell({ row }: Readonly<{ row: ReportRow }>) {
  const share = placeShare(row.figures);
  if (share === null) return <NoFigure reason="keine Platzgrenze" />;
  return (
    <div className="ml-auto w-44 max-md:w-full">
      <span className="flex justify-end gap-1 text-sm whitespace-nowrap tabular-nums">
        <span className="font-semibold text-gray-900">
          {formatCount(row.figures.bookedPlaces)}
        </span>
        <span className="text-gray-500">
          von {formatCount(row.figures.places)}
        </span>
        <span className="ml-1 text-gray-500">
          {formatPercent(share * 100).replace(",0 %", " %")}
        </span>
      </span>
      <ProgressBar
        value={row.figures.bookedPlaces}
        max={Math.max(row.figures.places, 1)}
        label={`${formatCount(row.figures.bookedPlaces)} von ${formatCount(row.figures.places)} Plätzen belegt`}
        tone={share >= 1 ? "orange" : "green"}
        size="sm"
        className="mt-1.5"
      />
    </div>
  );
}

function GapCell({ row }: Readonly<{ row: ReportRow }>) {
  const gap = demandGap(row.figures);
  if (gap === null) return <NoFigure reason="keine Platzgrenze" />;
  if (gap > 0) {
    return (
      <StatusBadge
        tone="orange"
        size="xs"
        label={`${formatCount(gap)} fehlen`}
        accessibleLabel={`Es fehlen ${formatCount(gap)} Plätze für die Nachfrage`}
      />
    );
  }
  return (
    <StatusBadge
      tone="green"
      size="xs"
      label={gap === 0 ? "passt genau" : `${formatCount(-gap)} frei`}
      accessibleLabel={
        gap === 0
          ? "Plätze und Nachfrage sind gleich"
          : `${formatCount(-gap)} Plätze bleiben trotz Nachfrage frei`
      }
    />
  );
}

/** Belegung und Nachfrage am Stichtag; offen und Warteliste sind Stand heute. */
export function demandColumns(header: string): DataTableColumn<ReportRow>[] {
  return [
    nameColumn(header),
    {
      key: "places",
      header: "Plätze belegt",
      headerTitle:
        "Gebuchte Kinder der Betreuungsformen mit Platzgrenze, von allen Plätzen",
      align: "right",
      render: (row) => <PlacesCell row={row} />,
    },
    countColumn(
      "open",
      "Offen",
      (row) => row.figures.open,
      "Anmeldungen, über die noch niemand entschieden hat (Stand heute)",
    ),
    countColumn(
      "waitlisted",
      "Warteliste",
      (row) => row.figures.waitlisted,
      "Kinder auf der Warteliste (Stand heute)",
    ),
    countColumn(
      "demand",
      "Nachfrage",
      (row) => row.figures.demand,
      "Gebuchte Kinder, offene Anmeldungen und Warteliste zusammen",
    ),
    {
      key: "gap",
      header: "Nachfrage zu Plätzen",
      headerTitle:
        "Wie viele Plätze für die Nachfrage fehlen oder frei bleiben",
      align: "right",
      render: (row) => <GapCell row={row} />,
    },
  ];
}
