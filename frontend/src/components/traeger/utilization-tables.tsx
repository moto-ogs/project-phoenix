"use client";

// Spalten der drei Reiter der Auslastung (#4713). Jede Zahl ist ein
// Mittelwert über die Wochentage des Zeitraums; ein Tag ohne Zahl zählt
// nicht mit. Ohne Platzgrenze gibt es keinen Anteil, sondern „–“.

import type { MouseEvent, ReactNode } from "react";
import type { DataTableColumn } from "~/components/ui/data-table";
import NavigationLink from "~/components/ui/navigation-link";
import { ProgressBar } from "~/components/ui/progress-bar";
import { StatusBadge } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import type { SchoolUtilization } from "~/lib/traeger-utilization-api";
import { traegerPath } from "~/lib/traeger-url";
import type {
  UtilizationOfferingRow,
  UtilizationRoomRow,
  UtilizationSchoolRow,
} from "./utilization-model";

const PERCENT = new Intl.NumberFormat("de-DE", {
  style: "percent",
  maximumFractionDigits: 0,
});
const AVERAGE = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** „84 %“; „–“ ohne Anteil. */
export function formatUtilization(share: number | null): string {
  return share === null ? "–" : PERCENT.format(share);
}

/** „18,5“: ein Mittelwert mit höchstens einer Nachkommastelle. */
export function formatAverage(value: number | null): string {
  return value === null ? "–" : AVERAGE.format(value);
}

function NoFigure({ reason }: Readonly<{ reason: string }>) {
  return (
    <span className="text-sm text-gray-500">
      –<span className="sr-only">, {reason}</span>
    </span>
  );
}

function Figure({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <span className="text-sm font-semibold whitespace-nowrap text-gray-900 tabular-nums">
      {children}
    </span>
  );
}

/** Ab 100 % ist kein Platz mehr frei: der Balken wird orange. */
function ShareCell({
  part,
  whole,
  label,
}: Readonly<{ part: number; whole: number; label: string }>) {
  const share = whole > 0 ? part / whole : null;
  return (
    <div className="w-44 max-md:w-full">
      <span className="text-sm whitespace-nowrap text-gray-900 tabular-nums">
        <span className="font-semibold">Ø {formatAverage(part)}</span>
        <span className="text-gray-500"> von {whole}</span>
        <span className="ml-2 text-gray-500">{formatUtilization(share)}</span>
      </span>
      <ProgressBar
        value={part}
        max={Math.max(whole, 1)}
        label={`Durchschnittlich ${formatAverage(part)} von ${whole} ${label}`}
        tone={share !== null && share >= 1 ? "orange" : "green"}
        className="mt-1.5"
      />
    </div>
  );
}

function SchoolName({
  school,
  sub,
}: Readonly<{ school: SchoolUtilization; sub?: string }>) {
  return (
    <div className="min-w-0">
      <NavigationLink
        href={traegerPath(`/traeger/schulen/${school.id}`)}
        className="font-medium text-gray-900 hover:underline"
        onClick={(event: MouseEvent<HTMLAnchorElement>) =>
          event.stopPropagation()
        }
      >
        {school.name}
      </NavigationLink>
      {sub ? (
        <span className="block text-sm text-gray-500 max-md:hidden">{sub}</span>
      ) : null}
    </div>
  );
}

function NamedCell({
  name,
  school,
  inactive,
}: Readonly<{ name: string; school: SchoolUtilization; inactive?: boolean }>) {
  return (
    <div className="min-w-0">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">{name}</span>
        {inactive ? (
          <StatusBadge
            tone="gray"
            size="xs"
            label="Nicht mehr angeboten"
            title="Die Schule bietet diese Betreuungsform nicht mehr an."
          />
        ) : null}
      </span>
      <span className="block text-sm text-gray-500">{school.name}</span>
    </div>
  );
}

/** Spalten des Reiters „Schulen“. `from` ist der Beginn des Zeitraums. */
export function schoolColumns(
  from: string,
): DataTableColumn<UtilizationSchoolRow>[] {
  return [
    {
      key: "name",
      header: "Schule",
      render: (row) => <SchoolName school={row.school} sub={row.school.city} />,
      sortValue: (row) => row.school.name,
      stacked: "title",
    },
    {
      key: "places",
      header: "Plätze",
      align: "right",
      render: (row) =>
        row.school.places > 0 ? (
          <Figure>{row.school.places}</Figure>
        ) : (
          <NoFigure reason="keine Betreuungsform mit Platzgrenze" />
        ),
      sortValue: (row) => row.school.places,
    },
    {
      key: "belegt",
      header: "Belegt",
      render: (row) =>
        row.school.places > 0 ? (
          <ShareCell
            part={row.averageBookedPlaces}
            whole={row.school.places}
            label="Plätzen belegt"
          />
        ) : (
          <NoFigure reason="keine Platzgrenze" />
        ),
      sortValue: (row) => row.utilization,
    },
    {
      key: "peak",
      header: "Vollster Tag",
      align: "right",
      headerTitle: "Der größte Anteil belegter Plätze an einem Tag",
      render: (row) =>
        row.peakUtilization === null ? (
          <NoFigure reason="keine Platzgrenze" />
        ) : (
          <Figure>{formatUtilization(row.peakUtilization)}</Figure>
        ),
      sortValue: (row) => row.peakUtilization,
    },
    {
      key: "present",
      header: "Anwesend",
      align: "right",
      headerTitle: "Kinder mit Check-in, im Durchschnitt pro Tag",
      render: (row) => {
        if (row.averagePresent === null) {
          return <NoFigure reason="keine Check-ins im Zeitraum" />;
        }
        const later =
          row.school.attendanceFrom !== null && row.school.attendanceFrom > from
            ? row.school.attendanceFrom
            : null;
        return (
          <span className="inline-flex flex-col items-end">
            <Figure>Ø {formatAverage(row.averagePresent)}</Figure>
            {later ? (
              <span className="text-sm text-gray-500">
                ab {formatDate(later)}
              </span>
            ) : null}
          </span>
        );
      },
      sortValue: (row) => row.averagePresent,
    },
  ];
}

export const OFFERING_COLUMNS: DataTableColumn<UtilizationOfferingRow>[] = [
  {
    key: "name",
    header: "Betreuungsform",
    render: (row) => (
      <NamedCell
        name={row.name}
        school={row.school}
        inactive={!row.offering.active}
      />
    ),
    sortValue: (row) => `${row.name} ${row.school.name}`,
    stacked: "title",
  },
  {
    key: "places",
    header: "Plätze",
    align: "right",
    render: (row) =>
      row.offering.capacity === null ? (
        <NoFigure reason="ohne Platzgrenze" />
      ) : (
        <Figure>{row.offering.capacity}</Figure>
      ),
    sortValue: (row) => row.offering.capacity,
  },
  {
    key: "belegt",
    header: "Gebucht",
    render: (row) =>
      row.offering.capacity === null ? (
        <Figure>Ø {formatAverage(row.averageBooked)}</Figure>
      ) : (
        <ShareCell
          part={row.averageBooked}
          whole={row.offering.capacity}
          label="Plätzen gebucht"
        />
      ),
    sortValue: (row) => row.utilization ?? row.averageBooked,
  },
  {
    key: "max",
    header: "Höchstens",
    align: "right",
    headerTitle: "Die meisten gebuchten Kinder an einem Tag",
    render: (row) => <Figure>{row.maxBooked}</Figure>,
    sortValue: (row) => row.maxBooked,
  },
  {
    key: "full",
    header: "Tage voll",
    align: "right",
    headerTitle: "Tage, an denen alle Plätze vergeben waren",
    render: (row) =>
      row.offering.capacity === null ? (
        <NoFigure reason="ohne Platzgrenze" />
      ) : row.fullDays > 0 ? (
        <StatusBadge
          tone="warning"
          size="xs"
          label={row.fullDays === 1 ? "1 Tag" : `${row.fullDays} Tage`}
          title="An diesen Tagen waren alle Plätze vergeben."
        />
      ) : (
        <span className="text-sm text-gray-500 tabular-nums">0</span>
      ),
    sortValue: (row) => row.fullDays,
  },
];

export const ROOM_COLUMNS: DataTableColumn<UtilizationRoomRow>[] = [
  {
    key: "name",
    header: "Raum",
    render: (row) => <NamedCell name={row.name} school={row.school} />,
    sortValue: (row) => `${row.name} ${row.school.name}`,
    stacked: "title",
  },
  {
    key: "places",
    header: "Plätze",
    align: "right",
    render: (row) =>
      row.room.capacity === null ? (
        <NoFigure reason="ohne Platzzahl" />
      ) : (
        <Figure>{row.room.capacity}</Figure>
      ),
    sortValue: (row) => row.room.capacity,
  },
  {
    key: "children",
    header: "Kinder am Tag",
    align: "right",
    headerTitle: "Kinder mit einem Besuch im Raum, im Durchschnitt pro Tag",
    render: (row) => <Figure>Ø {formatAverage(row.averageChildren)}</Figure>,
    sortValue: (row) => row.averageChildren,
  },
  {
    key: "peak",
    header: "Gleichzeitig",
    headerTitle: "Die meisten Kinder zur selben Zeit, im Durchschnitt pro Tag",
    render: (row) =>
      row.room.capacity !== null && row.averagePeak !== null ? (
        <ShareCell
          part={row.averagePeak}
          whole={row.room.capacity}
          label="Plätzen gleichzeitig belegt"
        />
      ) : (
        <Figure>Ø {formatAverage(row.averagePeak)}</Figure>
      ),
    sortValue: (row) => row.utilization ?? row.averagePeak,
  },
  {
    key: "max",
    header: "Höchstens",
    align: "right",
    headerTitle: "Die meisten Kinder zur selben Zeit an einem Tag",
    render: (row) => <Figure>{row.maxPeak ?? "–"}</Figure>,
    sortValue: (row) => row.maxPeak,
  },
  {
    key: "days",
    header: "Tage mit Daten",
    align: "right",
    render: (row) => (
      <span className="text-sm text-gray-700 tabular-nums">{row.dataDays}</span>
    ),
    sortValue: (row) => row.dataDays,
  },
];
