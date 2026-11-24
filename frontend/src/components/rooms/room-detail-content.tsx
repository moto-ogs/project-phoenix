// components/rooms/room-detail-content.tsx
//
// Die Übersicht der Raumseite /rooms/[id] (#3115): Rauminformationen, Kinder
// im Raum und die Belegungshistorie. Bis #3115 lag das in einem Slide-over
// auf /rooms; die Kopfkarte (Name, Status) trägt jetzt `TenantPage`, hier
// stehen nur noch die Flächen darunter.
//
// Fetching is exposed via the `useRoomDetail` hook so the page can react to
// loading/error states with its own layout. The content component itself is
// purely presentational.

"use client";

import { BuildingsIcon, StackSimpleIcon, TagIcon } from "@phosphor-icons/react";
import { MotoDuotoneIcon } from "~/components/ui/moto-duotone-icon";
import type { FormError, FormErrorInput } from "~/components/ui/form-error";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import {
  ChoiceTileListSkeleton,
  HistorySkeleton,
} from "~/components/ui/page-skeletons";
import { SectionCard } from "~/components/ui/section-card";
import { Skeleton } from "~/components/ui/skeleton";
import {
  DataField,
  DataFieldSkeleton,
  DataGrid,
} from "~/components/ui/data-field";
import { revalidateOrThrow, useSWRAuth } from "~/lib/swr";
import { roomKeys } from "~/lib/swr/rooms-keys";
import { ApiError } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import type * as roomsContract from "~/lib/contract/rooms.generated";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import {
  berlinTodayISO,
  formatDate,
  formatTime,
  calculateDuration,
  formatDuration,
} from "~/lib/date-helpers";
import {
  formatFloor,
  mapRoomResponse,
  ROOM_HISTORY_DISABLED_CODE,
  type Room,
} from "~/lib/room-helpers";
import { createLogger } from "~/lib/logger";
import { useStudentPhotosEnabled } from "~/lib/hooks/use-student-photos-enabled";
import { StudentsInRoomSection } from "./students-in-room-section";

const logger = createLogger({ component: "RoomDetailContent" });

// One row in the room occupancy history. Issue #1425 moved this from
// per-student-visit rows to one row per active.groups session — no student
// IDs or names by design. Per-child detail lives behind
// /students/{id}/attendance-history under its own GDPR gates.
interface RoomHistoryEntry {
  sessionId: string;
  startedAt: string; // RFC3339
  endedAt: string | null; // RFC3339 or null while session is open
  durationMinutes: number | null;
  activityName: string;
  supervisorName: string;
  studentCount: number;
}

interface DateGroup {
  date: string;
  entries: RoomHistoryEntry[];
}

/** Maps one session of the contract (`RoomSessionEntry`). */
function mapRoomHistoryEntry(
  entry: roomsContract.RoomSessionEntry,
): RoomHistoryEntry {
  return {
    sessionId: entry.session_id,
    startedAt: entry.started_at,
    endedAt: entry.ended_at ?? null,
    durationMinutes: entry.duration_minutes ?? null,
    activityName: entry.activity_name,
    supervisorName: entry.supervisor_name,
    studentCount: entry.student_count,
  };
}

/**
 * A switched-off history (gdpr.attendance_log_enabled, #1425) arrives as the
 * backend's 403 with its code (#7563).
 */
function isRoomHistoryDisabled(failure: unknown): boolean {
  return (
    typeof failure === "object" &&
    failure !== null &&
    (failure as { code?: unknown }).code === ROOM_HISTORY_DISABLED_CODE
  );
}

function groupByDate(entries: readonly RoomHistoryEntry[]): DateGroup[] {
  const groups: Record<string, RoomHistoryEntry[]> = {};

  entries.forEach((entry) => {
    // School day in Berlin, the same day the group heading shows (#6471).
    const date = berlinTodayISO(new Date(entry.startedAt));
    groups[date] ??= [];
    groups[date].push(entry);
  });

  return Object.keys(groups)
    .sort((a, b) => b.localeCompare(a))
    .map((date) => ({
      date,
      entries: (groups[date] ?? []).sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      ),
    }));
}

export interface UseRoomDetailResult {
  room: Room | null;
  history: RoomHistoryEntry[];
  loading: boolean;
  /** Failed load of the room, for TenantPage `error` (retry, request ID). */
  error: FormError | null;
  // True when the tenant has gdpr.attendance_log_enabled = false: the
  // backend refuses the history with 403 and attendance.log_disabled, so the
  // page hides the "Belegungshistorie" section deliberately (issue #1425)
  // rather than letting it collapse incidentally on an empty history array.
  historyDisabled: boolean;
  /** Fehler beim separaten Laden der Belegungshistorie. */
  historyError: FormError | null;
  /** Reads the room again; rejects when the read fails (ADR 0311). */
  reload: () => Promise<Room>;
}

export function useRoomDetail(roomId: string): UseRoomDetailResult {
  // SWR-cached so the global SSE handler can invalidate the header on
  // checkin/checkout/activity events, see use-global-sse.ts. The cache
  // key shape is "room-detail-{id}" (the slug-prefix is added by
  // useSWRAuth); SSE matches via key.includes("room-detail-").
  //
  // NOTE: the cache key intentionally does NOT include start/end range
  // params because today the page always fetches the server-side default
  // window. If a future caller starts passing range params, fold them into
  // the cache key (e.g. `room-detail-${roomId}-${start}-${end}`) so
  // distinct windows don't share a cache slot.
  const read = useSWRAuth<{
    room: Room;
    history: RoomHistoryEntry[];
    historyDisabled: boolean;
    historyFailure: unknown;
  }>(
    roomKeys.detailKey(roomId),
    async () => {
      // Both routes read the session cookie (#5005). A failed history
      // leaves the room readable.
      const [roomData, historyResult] = await Promise.all([
        bffJson("tenant", "GET /api/rooms/{id}", {
          params: { id: roomId },
          errorMessage: "room detail failed",
        }),
        bffJson("tenant", "GET /api/rooms/{id}/history", {
          params: { id: roomId },
          errorMessage: "room history failed",
        }).then(
          (rows) => ({ rows, failure: null }),
          (failure: unknown) => ({ rows: null, failure }),
        ),
      ]);
      const room = mapRoomResponse(roomData);

      let history: RoomHistoryEntry[] = [];
      let historyDisabled = false;
      let historyFailure: unknown = null;
      if (historyResult.rows) {
        history = historyResult.rows.map(mapRoomHistoryEntry);
      } else {
        const failure = historyResult.failure;
        // gdpr.attendance_log_enabled is off for this school (#1425): the
        // section hides deliberately. Any other refusal is a real failure
        // and stays visible; hiding it would mask an outage.
        if (isRoomHistoryDisabled(failure)) {
          historyDisabled = true;
        } else {
          logger.warn("room_history_fetch_failed", {
            room_id: roomId,
            status: failure instanceof ApiError ? failure.status : undefined,
          });
          historyFailure = failure;
        }
      }

      return { room, history, historyDisabled, historyFailure };
    },
    { keepPreviousData: false },
  );
  const { data, error, isLoading, mutate } = read;

  if (error) {
    logger.error("failed to fetch room data", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  // Ladefehler mit Katalogtext, Wiederholen und Vorgangskennung (#2517).
  const loadError = useSwrLoadError(error, "die Raumseite", () => mutate());
  const historyError = useSwrLoadError(
    data?.historyFailure,
    "die Belegungshistorie",
    () => mutate(),
  );

  return {
    room: data?.room ?? null,
    history: data?.history ?? [],
    loading: isLoading,
    error: loadError,
    historyDisabled: data?.historyDisabled ?? false,
    historyError,
    reload: async () => (await revalidateOrThrow(read)).room,
  };
}

interface RoomDetailContentProps {
  readonly room: Room;
  readonly history: readonly RoomHistoryEntry[];
  readonly onSelectionActiveChange?: (active: boolean) => void;
  // When true, the tenant has gdpr.attendance_log_enabled = false and the
  // "Belegungshistorie" section must be hidden deliberately (issue #1425).
  // Without this flag the section already collapses when `history` is
  // empty, but that's incidental — the explicit flag prevents a future
  // empty-state placeholder from accidentally surfacing the section on a
  // tenant that has opted out.
  readonly historyDisabled?: boolean;
  /** Sichtbare Fehlermeldung statt einer irreführend leeren Historie. */
  readonly historyError?: FormErrorInput;
  /** Binärer Präsenzmodus kennt keine Raumbelegung. */
  readonly showOccupancy?: boolean;
}

export function RoomDetailContent({
  room,
  history,
  onSelectionActiveChange,
  historyDisabled = false,
  historyError = null,
  showOccupancy = true,
}: RoomDetailContentProps) {
  const groupedSessions = groupByDate(history);
  const hasHistory = !historyDisabled && groupedSessions.length > 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Feldgruppen aus dem Kit (`DataField`/`DataGrid` in einer
          `SectionCard`), statt einer eigenen Icon-Zeile: eine Objektansicht
          zeigt ihre Felder portalweit in derselben Form. */}
      <SectionCard title="Rauminformationen">
        <DataGrid>
          {/* Raumname bewusst ausgelassen: steht schon in der Kopfkarte. */}
          {room.building && (
            <DataField
              label="Gebäude"
              icon={
                <MotoDuotoneIcon
                  icon={BuildingsIcon}
                  tone="neutral"
                  size={14}
                />
              }
            >
              {room.building}
            </DataField>
          )}
          {room.floor !== undefined && (
            <DataField
              label="Etage"
              icon={
                <MotoDuotoneIcon
                  icon={StackSimpleIcon}
                  tone="neutral"
                  size={14}
                />
              }
            >
              {formatFloor(room.floor)}
            </DataField>
          )}
          {room.category && (
            <DataField
              label="Kategorie"
              icon={<MotoDuotoneIcon icon={TagIcon} tone="neutral" size={14} />}
            >
              {room.category}
            </DataField>
          )}
          {showOccupancy ? (
            <DataField label="Status">
              {room.isOccupied ? "Belegt" : "Frei"}
            </DataField>
          ) : null}
          {showOccupancy && room.isOccupied && room.groupName && (
            <DataField label="Aktuelle Aktivität">{room.groupName}</DataField>
          )}
          {showOccupancy &&
            room.isOccupied &&
            room.studentCount !== undefined &&
            room.studentCount > 0 && (
              <DataField label="Aktuell anwesend">
                {`${room.studentCount} ${
                  room.studentCount === 1 ? "Kind" : "Kinder"
                }`}
              </DataField>
            )}
          {showOccupancy && room.isOccupied && room.supervisorName && (
            <DataField label="Aktuelle Aufsicht">
              {room.supervisorName}
            </DataField>
          )}
        </DataGrid>
      </SectionCard>

      {showOccupancy ? (
        <StudentsInRoomSection
          roomId={room.id}
          roomName={room.name}
          onSelectionActiveChange={onSelectionActiveChange}
        />
      ) : null}

      {showOccupancy ? <LoadErrorAlert error={historyError} /> : null}

      {showOccupancy && hasHistory ? (
        <SectionCard title="Belegungshistorie">
          <div className="space-y-6">
            {groupedSessions.map((dateGroup) => (
              <div key={dateGroup.date}>
                <h3 className="mb-3 text-sm font-semibold text-gray-700">
                  {dateGroup.entries[0]?.startedAt
                    ? formatDate(dateGroup.entries[0].startedAt, true)
                    : ""}
                </h3>

                <div className="space-y-3">
                  {dateGroup.entries.map((session) => {
                    // Running sessions get a "Laufend" marker in the
                    // footer row below; suppress the top-right duration
                    // slot for them so the same state isn't labelled
                    // twice (formatDuration would otherwise render
                    // "Aktiv" next to a "Laufend" pill).
                    const isRunning = session.endedAt === null;
                    const duration = isRunning
                      ? null
                      : (session.durationMinutes ??
                        calculateDuration(session.startedAt, session.endedAt));

                    return (
                      <div
                        key={session.sessionId}
                        className="moto-content-surface rounded-xl border p-4"
                      >
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <h4 className="font-medium text-gray-900">
                            {session.activityName || "Aktivität"}
                          </h4>
                          {duration !== null && (
                            <span className="text-xs text-gray-500">
                              {formatDuration(duration)}
                            </span>
                          )}
                        </div>

                        <div className="space-y-1 text-sm text-gray-600">
                          {session.supervisorName && (
                            <div>Aufsicht: {session.supervisorName}</div>
                          )}
                          <div>Kinder: {session.studentCount}</div>
                        </div>

                        <div className="mt-3 flex justify-between border-t border-gray-100 pt-3 text-xs text-gray-500">
                          <span>Beginn: {formatTime(session.startedAt)}</span>
                          {session.endedAt ? (
                            <span>Ende: {formatTime(session.endedAt)}</span>
                          ) : (
                            <span className="font-medium text-gray-700">
                              Laufend
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}

// Content-shaped skeleton for the loading state. Mirrors the three card
// shells of the loaded layout (Rauminformationen / Kinder im Raum /
// Belegungshistorie) so the page doesn't visibly resize when real data
// arrives.
export function RoomDetailSkeleton() {
  // Read the per-tenant photo flag once at the top of the skeleton: the
  // child rows reserve an avatar slot only when the tenant has photos on.
  const { enabled: photosEnabled } = useStudentPhotosEnabled();
  return (
    <output
      aria-label="Raumdetails werden geladen"
      data-testid="room-detail-skeleton"
      className="block space-y-4 sm:space-y-6"
    >
      <SectionCard title="Rauminformationen">
        <DataGrid>
          <DataFieldSkeleton />
          <DataFieldSkeleton />
          <DataFieldSkeleton />
          <DataFieldSkeleton />
        </DataGrid>
      </SectionCard>

      <SectionCard title="Kinder im Raum">
        {/* Subline (count + Kindersuche button) and three child rows. */}
        <div className="flex items-end justify-between gap-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton shape="control" className="h-7 w-32" />
        </div>
        <div className="mt-4">
          <ChoiceTileListSkeleton rows={3} avatar={photosEnabled} />
        </div>
      </SectionCard>

      <SectionCard title="Belegungshistorie">
        <HistorySkeleton />
      </SectionCard>
    </output>
  );
}
