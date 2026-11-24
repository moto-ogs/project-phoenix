"use client";
import { LOCATION_COLORS } from "~/lib/location-helper";
import { StatusColorBadge } from "~/components/ui/status-color-badge";
import { StatusBadge } from "~/components/ui/status-badge";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";

import React, { Suspense, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Download } from "lucide-react";
import { Skeleton } from "~/components/ui/skeleton";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import {
  DataTable,
  type DataTableColumn,
  type DataTableExtraRow,
} from "~/components/ui/data-table";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { SectionCard } from "~/components/ui/section-card";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import {
  resolveStudentReferrer,
  studentHistoryBack,
} from "../student-referrer";
import { ApiError } from "~/lib/api-error";
import { fetchStudentAttendanceHistory } from "~/lib/student-api";
import { useSWRAuth } from "~/lib/swr";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";
import { useStudentData } from "~/lib/hooks/use-student-data";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useStudentHistoryBreadcrumb } from "~/lib/breadcrumb-context";
import { useScrollToTop } from "~/lib/hooks/use-scroll-to-top";

import {
  type AttendanceHistoryDay,
  formatDate,
  formatAttendanceSlotStatus,
  formatDuration,
  formatTime,
} from "~/lib/attendance-history-helpers";
import { attendanceActorLabel } from "~/lib/attendance-actor";
import {
  AttendanceCorrectionModal,
  type CorrectableSlot,
} from "~/components/students/attendance-correction-modal";
import { hasPermission } from "~/lib/auth-utils";
import { usePresenceMode } from "~/lib/tenant-context";
import { RoomHistorySkeleton } from "./page-skeleton";
import type { HistoryChartPoint } from "./history-charts";
import { Button } from "~/components/ui/button";
import { AttendanceExportDialog } from "~/components/students/attendance-export-dialog";
import { changeHistoryConcept } from "~/lib/concepts/changeHistory";

const ROOM_HISTORY_INFO =
  "Hier siehst du, wann dieses Kind kam und ging. Du siehst auch, in welchen Räumen es war. Bei jedem Tag steht, wer es an- und abgemeldet hat.";
// Bei einfacher Anwesenheit führt die Schule keine Räume.
const ROOM_HISTORY_BINARY_MODE_INFO =
  "Hier siehst du, wann dieses Kind kam und ging. Bei jedem Tag steht, wer es an- und abgemeldet hat.";

// ─── Types ───────────────────────────────────────────────────────────────────

const ROOM_HISTORY_DESCRIPTION =
  "Wo dieses Kind an einem Tag war und wer es ein- und ausgecheckt hat.";

const FEATURE_DISABLED_DESCRIPTION =
  "Das Anwesenheitsprotokoll ist für deine Schule ausgeschaltet. Bitte frage deine Administration.";

const LazyHistoryCharts = dynamic(() => import("./history-charts"), {
  ssr: false,
  loading: () => (
    <Skeleton
      shape="card"
      className="h-[404px] w-full md:h-[200px]"
      aria-hidden
    />
  ),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Erklärung am „Korrigieren“-Knopf eines Betreuungsangebots (#6643). */
const CORRECTION_TOOLTIP =
  "Öffnet die Anwesenheit dieses Termins zum Ändern, mit Angabe eines Grundes.";

function formatDateShort(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  const day = d.getDate().toString().padStart(2, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  return `${day}.${month}`;
}

function HistoryCharts({ days }: { readonly days: AttendanceHistoryDay[] }) {
  const todayKey = useBerlinToday();

  const chartData = useMemo<HistoryChartPoint[]>(() => {
    return days
      .filter((day) => day.attendance)
      .slice()
      .reverse()
      .map((day) => ({
        date: formatDateShort(day.date),
        isToday: day.date === todayKey,
        roomDetailAvailable: day.roomDetailAvailable,
        duration: day.attendance
          ? Math.round(((day.attendance.durationMinutes ?? 0) / 60) * 10) / 10
          : 0,
        visits: day.visits.length,
      }));
  }, [days, todayKey]);

  if (chartData.length === 0) return null;
  return <LazyHistoryCharts data={chartData} />;
}

// ─── HistoryTable ──────────────────────────────────────────────────────────

// On a phone the same rows stack as cards (#7915): the day with its status
// as title, the duration beside it, arrival, departure and the counts below;
// the rooms and offerings open with the card's details button.
const HISTORY_COLUMNS: DataTableColumn<AttendanceHistoryDay>[] = [
  {
    key: "day",
    header: "Tag",
    stacked: "title",
    render: (day) => {
      const statusLabel = day.statusEntries
        .map((entry) => entry.label)
        .join(", ");
      return (
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">
            {formatDate(day.date)}
          </span>
          {statusLabel && (
            <StatusColorBadge
              label={statusLabel}
              color={LOCATION_COLORS.WARNING}
              compact
              wrap
            />
          )}
        </div>
      );
    },
  },
  {
    key: "arrival",
    header: "Ankunft",
    className: "tabular-nums",
    render: (day) => (
      <span className="text-gray-600">
        {day.attendance ? formatTime(day.attendance.checkInTime) : "–"}
        {day.attendance?.checkedInActor && (
          <span className="mt-0.5 block text-xs text-gray-500">
            Angemeldet: {attendanceActorLabel(day.attendance.checkedInActor)}
          </span>
        )}
      </span>
    ),
  },
  {
    key: "departure",
    header: "Abmeldung",
    className: "tabular-nums",
    render: (day) => (
      <span className="text-gray-600">
        {day.attendance
          ? day.attendance.checkOutTime
            ? formatTime(day.attendance.checkOutTime)
            : "Noch anwesend"
          : "–"}
        {day.attendance?.checkOutTime && day.attendance.checkedOutActor && (
          <span className="mt-0.5 block text-xs text-gray-500">
            Abgemeldet: {attendanceActorLabel(day.attendance.checkedOutActor)}
          </span>
        )}
        {day.attendance?.leftForClassAt.map((at) => (
          <span
            key={at.getTime()}
            className="mt-0.5 block text-xs text-gray-500"
          >
            Zum Unterricht gegangen: {formatTime(at)} Uhr
          </span>
        ))}
        {day.attendance?.checkOutNote && (
          <span className="mt-0.5 block text-xs text-gray-500">
            Grund für das frühe Gehen: {day.attendance.checkOutNote}
          </span>
        )}
      </span>
    ),
  },
  {
    key: "duration",
    header: "Dauer",
    stacked: "meta",
    // A card without attendance and without a status (sick, excused) names
    // the missing data; with a status the title already says what was.
    stackedRender: (day) =>
      day.attendance ? (
        <StatusBadge
          label={formatDuration(day.attendance.durationMinutes)}
          tone="green"
          compact
        />
      ) : day.statusEntries.length === 0 ? (
        <StatusColorBadge
          label="Keine Daten"
          color={LOCATION_COLORS.WARNING}
          compact
        />
      ) : null,
    render: (day) =>
      day.attendance ? (
        <StatusBadge
          label={formatDuration(day.attendance.durationMinutes)}
          tone="green"
          compact
        />
      ) : (
        <span className="text-gray-500">–</span>
      ),
  },
  {
    key: "rooms",
    header: "Angebote / Räume",
    render: (day) => (
      <span className="text-gray-500">
        {`${day.slots.length} Angebot${day.slots.length !== 1 ? "e" : ""}`}
        {day.roomDetailAvailable &&
          ` · ${day.visits.length} Raum${day.visits.length !== 1 ? "wechsel" : ""}`}
      </span>
    ),
  },
];

// Die Betreuungsangebote eines aufgeklappten Tages.
function daySlotRows(
  day: AttendanceHistoryDay,
  canCorrect: boolean,
  onCorrect: (slot: CorrectableSlot) => void,
): DataTableExtraRow[] {
  return day.slots.map((slot) => ({
    key: `${day.date}-slot-${slot.instanceId}`,
    cells: [
      {
        columnKey: "day",
        content: (
          <>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">{slot.title}</span>
              <span className="text-gray-500 tabular-nums">
                {slot.startTime}
                {slot.endTime && <>–{slot.endTime}</>}
              </span>
              {slot.isUnplanned && (
                <span className="text-moto-orange-strong">ungeplant</span>
              )}
            </div>
            {/* Die Bemerkung aus der Betreuung (#2898): ruhige Information
                unter ihrem Block, nicht klickbar. Korrigieren ist nur mit
                Recht und nach Abschluss des Termins sichtbar. */}
            {slot.note && (
              <p className="mt-1 text-gray-500 italic">
                Bemerkung: {slot.note}
              </p>
            )}
            {canCorrect &&
              slot.instanceStatus === "completed" &&
              slot.status && (
                <Button
                  type="button"
                  variant="link"
                  size="md"
                  onClick={() =>
                    onCorrect({
                      instanceId: slot.instanceId,
                      title: slot.title,
                      date: formatDateShort(day.date),
                      startTime: slot.startTime,
                      endTime: slot.endTime,
                      status: slot.status ?? "",
                      substatus: slot.substatus,
                      note: slot.note,
                    })
                  }
                  tooltip={CORRECTION_TOOLTIP}
                  className="mt-1"
                >
                  Korrigieren
                </Button>
              )}
          </>
        ),
      },
      {
        columnKey: "arrival",
        content: (
          <span className="tabular-nums">
            {slot.checkedInAt ? formatTime(slot.checkedInAt) : "–"}
          </span>
        ),
      },
      {
        columnKey: "departure",
        content: (
          <span className="tabular-nums">
            {slot.checkedOutAt ? formatTime(slot.checkedOutAt) : "–"}
          </span>
        ),
      },
      {
        columnKey: "duration",
        content: (
          <span className="text-gray-600">
            {formatAttendanceSlotStatus(slot.status, slot.substatus)}
          </span>
        ),
      },
    ],
  }));
}

// Die Statusmeldungen und Raumwechsel eines aufgeklappten Tages.
function dayRoomRows(day: AttendanceHistoryDay): DataTableExtraRow[] {
  // A report stands under the arrival and departure columns, named as a
  // report: stacked on a phone, the column label alone would read as an
  // arrival (#7915). Reports outlive the room-detail retention.
  const statusRows: DataTableExtraRow[] = day.statusEntries.map((entry) => ({
    key: `${day.date}-${entry.status}`,
    cells: [
      {
        columnKey: "day",
        content: (
          <span className="text-moto-amber-strong font-medium">
            {entry.label}
          </span>
        ),
      },
      {
        columnKey: "arrival",
        content: (
          <span className="tabular-nums">
            gemeldet {formatTime(entry.reportedAt)}
          </span>
        ),
      },
      {
        columnKey: "departure",
        content: (
          <span className="tabular-nums">
            {entry.clearedAt ? `beendet ${formatTime(entry.clearedAt)}` : "–"}
          </span>
        ),
      },
      {
        columnKey: "duration",
        content: <span className="text-gray-500">–</span>,
      },
    ],
  }));
  if (!day.roomDetailAvailable) {
    return [
      ...statusRows,
      {
        key: `${day.date}-rooms-expired`,
        content: (
          <span className="italic">
            Raumdetails nicht mehr verfügbar (Aufbewahrungsfrist überschritten).
          </span>
        ),
      },
    ];
  }
  if (day.visits.length === 0) {
    return [
      ...statusRows,
      {
        key: `${day.date}-no-room-change`,
        content: "Keine Raumwechsel an diesem Tag.",
      },
    ];
  }
  return [
    ...statusRows,
    ...day.visits.map((v, i) => ({
      key: `${day.date}-${i}-${v.entryTime.toISOString()}`,
      cells: [
        {
          columnKey: "day",
          content: (
            <span className="font-medium text-gray-700">
              {v.roomName || "Unbekannt"}
            </span>
          ),
        },
        {
          columnKey: "arrival",
          content: (
            <span className="tabular-nums">{formatTime(v.entryTime)}</span>
          ),
        },
        {
          columnKey: "departure",
          content: (
            <span className="tabular-nums">
              {v.exitTime ? formatTime(v.exitTime) : "–"}
            </span>
          ),
        },
        {
          columnKey: "duration",
          content:
            v.durationMinutes != null ? (
              <span className="rounded bg-gray-200/60 px-1.5 py-0.5 text-gray-600 tabular-nums">
                {formatDuration(v.durationMinutes)}
              </span>
            ) : (
              <span className="text-gray-500">–</span>
            ),
        },
      ],
    })),
  ];
}

function HistoryTable({
  days,
  caps,
  studentId,
  onCorrected,
}: {
  readonly days: AttendanceHistoryDay[];
  readonly caps: { attendanceDays: number; roomDetailDays: number };
  readonly studentId: string;
  readonly onCorrected: () => void;
}) {
  const todayKey = useBerlinToday();
  // Korrigieren darf nur, wer den Plan verwaltet (#2898) — dieselbe
  // Berechtigung, die das Backend auf der Korrektur-Route verlangt.
  const { data: session } = useSession();
  const canCorrect = hasPermission(session, "schedules:manage");
  const [correcting, setCorrecting] = useState<CorrectableSlot | null>(null);

  return (
    <>
      <SectionCard
        title="Anwesenheitsprotokoll"
        description={`${ROOM_HISTORY_DESCRIPTION} Letzte ${caps.attendanceDays} Tage · Raumdetails für ${caps.roomDetailDays} Tage`}
        concept={changeHistoryConcept}
      >
        {days.length === 0 ? null : (
          <DataTable
            columns={HISTORY_COLUMNS}
            rows={days}
            getRowKey={(day) => day.date}
            expandable={{
              rowLabel: (day, expanded) =>
                `${formatDate(day.date)}: Details ${expanded ? "schließen" : "öffnen"}`,
            }}
            renderSubRows={(day, expanded) =>
              expanded
                ? [
                    ...daySlotRows(day, canCorrect, setCorrecting),
                    ...dayRoomRows(day),
                  ]
                : []
            }
            rowTone={(day) => (day.date === todayKey ? "today" : null)}
            stackedOnMobile
          />
        )}
      </SectionCard>
      {correcting && (
        <AttendanceCorrectionModal
          isOpen
          onClose={() => setCorrecting(null)}
          studentId={studentId}
          slot={correcting}
          onCorrected={onCorrected}
        />
      )}
    </>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function StudentRoomHistoryPage() {
  return (
    <Suspense fallback={<RoomHistorySkeleton />}>
      <StudentRoomHistoryPageContent />
    </Suspense>
  );
}

function StudentRoomHistoryPageContent() {
  const today = useBerlinToday();
  const presenceMode = usePresenceMode();
  const params = useParams();
  const searchParams = useSearchParams();
  const studentId = params.id as string;
  const referrer = resolveStudentReferrer(searchParams.get("from"));
  useSession();

  // Dieselbe Kindakte wie die Akte selbst (studentKeys.detail). Der Name
  // schmückt nur den Kopf; ohne ihn zeigt die Seite das Protokoll unter dem
  // allgemeinen Titel.
  const { student, loading: studentLoading } = useStudentData(studentId);
  // Der Schlüssel trägt das Kind: ein Protokoll steht nur unter genau diesem
  // Kind, und nach zwei Korrekturen zählt nur der jüngste Abruf (#6503).
  const {
    data: loadedHistory,
    error: historyError,
    mutate: mutateHistory,
  } = useSWRAuth(
    tenantStudentKeys.attendanceHistory(studentId),
    () => fetchStudentAttendanceHistory(studentId),
    { keepPreviousData: false },
  );
  const history = loadedHistory ?? null;
  // A 404 is its own state, not an error to retry.
  const notFound =
    historyError instanceof ApiError && historyError.status === 404;
  // Ein bereits geladenes Protokoll dieses Kindes bleibt stehen; der Fehler
  // einer Aktualisierung steht dann darüber.
  const historyLoadError = useSwrLoadError(
    notFound ? undefined : historyError,
    "das Anwesenheitsprotokoll",
    () => mutateHistory(),
  );
  const loading = (!loadedHistory && !historyError) || studentLoading;
  const [exportOpen, setExportOpen] = useState(false);

  useStudentHistoryBreadcrumb({ studentName: student?.name, referrer });

  // Start at the top instead of inheriting the previous page's scroll position
  useScrollToTop(studentId);

  const displayName = student
    ? (student.name ?? `${student.first_name} ${student.second_name}`)
    : "";
  // Statuszeile: Klasse, Gruppe und die Zahl der protokollierten Tage, alles
  // aus den Daten, die die Seite ohnehin geladen hat. Ohne geladenes
  // Protokoll steht keine "0 Tage erfasst" neben dem Ladefehler (#2517).
  const dayCount = history ? history.days.length : null;
  const dayStat =
    dayCount === null
      ? null
      : {
          value: dayCount,
          label: `${dayCount === 1 ? "Tag" : "Tage"} erfasst`,
        };
  const dayLine = dayStat ? `${dayStat.value} ${dayStat.label}` : null;
  const studentFacts = student
    ? [student.school_class, student.group_name].filter(
        (part): part is string => Boolean(part),
      )
    : [];
  const studentMeta =
    studentFacts.length + (dayStat ? 1 : 0) > 1 ? (
      <TenantPageStats
        items={[
          ...studentFacts.map((label) => ({ label })),
          ...(dayStat ? [dayStat] : []),
        ]}
      />
    ) : (
      (studentFacts[0] ?? null)
    );
  // Eine ausgeschaltete Funktion ist ein Zustand, kein Fehler. Erkannt wird
  // sie am Schalter im Datensatz des Kindes, nicht am Text der 403-Antwort.
  const featureDisabled = student?.attendance_log_enabled === false;
  const hasDays = history !== null && history.days.length > 0;
  // Der Fehler ersetzt die Seite nur, wenn kein Protokoll zu zeigen ist.
  const pageError = notFound
    ? "Kind nicht gefunden."
    : featureDisabled || hasDays
      ? null
      : historyLoadError;
  const back = studentHistoryBack(studentId, referrer, pageError !== null);

  return (
    <>
      {/* Der Entitätskopf ist die Kopfkarte der Seite. */}
      <TenantPage
        back
        {...back}
        leading={<ConceptIconTile concept={changeHistoryConcept} size="page" />}
        title={displayName || "Anwesenheitsprotokoll"}
        info={
          presenceMode === "binary"
            ? ROOM_HISTORY_BINARY_MODE_INFO
            : ROOM_HISTORY_INFO
        }
        stats={studentMeta ?? dayLine}
        statsLoading={loading}
        loading={loading}
        error={pageError}
        // Exportieren steht im Kebab der Kopfkarte, wie auf jeder anderen
        // Werkzeugfläche; der Zeitraum wird im Export-Dialog gewählt.
        actions={
          hasDays ? (
            <OverflowMenu
              items={[
                {
                  label: "Exportieren",
                  description:
                    "Öffnet den Export der Anwesenheit, mit Wahl von Zeitraum und Format.",
                  icon: <Download className="h-4 w-4" aria-hidden />,
                  onClick: () => setExportOpen(true),
                },
              ]}
              ariaLabel="Weitere Aktionen"
            />
          ) : undefined
        }
        // Eine ausgeschaltete Funktion ist ein Zustand, kein Fehler; ebenso ein
        // Zeitraum ohne Eintrag. Beide nennen den nächsten Schritt.
        empty={
          featureDisabled
            ? {
                title: "Anwesenheitsprotokoll ist ausgeschaltet",
                description: FEATURE_DISABLED_DESCRIPTION,
              }
            : history && history.days.length === 0
              ? {
                  title:
                    "Keine Anwesenheitsdaten für den ausgewählten Zeitraum verfügbar",
                  description: `Letzte ${history.caps.attendanceDays} Tage · Raumdetails für ${history.caps.roomDetailDays} Tage. Sobald das Kind an- oder abgemeldet wird, erscheint der Tag hier.`,
                }
              : null
        }
      >
        {history && hasDays && (
          <>
            {historyLoadError ? (
              <LoadErrorAlert error={historyLoadError} />
            ) : null}
            <HistoryCharts days={history.days} />

            <HistoryTable
              days={history.days}
              caps={history.caps}
              studentId={studentId}
              onCorrected={() => void mutateHistory()}
            />
          </>
        )}
      </TenantPage>
      {history && exportOpen ? (
        <AttendanceExportDialog
          isOpen
          onClose={() => setExportOpen(false)}
          studentId={studentId}
          studentName={displayName}
          today={today}
          visibleDays={history.caps.attendanceDays}
        />
      ) : null}
    </>
  );
}
