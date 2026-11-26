// Raumsperren (#7653): ein Raum ist für einen Tag oder Zeitraum gesperrt, mit
// Grund. Neue Termine und der Kiosk bieten ihn in der Zeit nicht an; Termine,
// die schon im Raum liegen, verlegt die Leitung selbst.

import { bffJson } from "~/lib/bff-fetch";
import type { RoomClosureResponse } from "~/lib/contract/rooms.generated";
import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";

export interface RoomClosure {
  readonly id: string;
  readonly roomId: string;
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate: string; // YYYY-MM-DD
  readonly reason: string;
}

/** Längste Sperre und maximaler Vorlauf, wie das Backend sie annimmt. */
export const ROOM_CLOSURE_MAX_DAYS = 366;
/** Höchstzahl Zeichen im Grund. */
export const ROOM_CLOSURE_REASON_MAX_LENGTH = 200;

function mapRoomClosure(raw: RoomClosureResponse): RoomClosure {
  return {
    id: raw.id,
    roomId: raw.room_id,
    startDate: raw.start_date ?? "",
    endDate: raw.end_date ?? "",
    reason: raw.reason,
  };
}

/** Die Sperren, die `from` bis `to` (beide inklusive) berühren. */
export async function fetchRoomClosures(
  from: string,
  to: string,
  roomId?: string,
): Promise<RoomClosure[]> {
  const rows = await bffJson("tenant", "GET /api/rooms/closures", {
    query: { from, to, ...(roomId ? { room_id: roomId } : {}) },
  });
  return rows.map(mapRoomClosure);
}

export async function closeRoom(
  roomId: string,
  input: { startDate: string; endDate: string; reason: string },
): Promise<RoomClosure> {
  const saved = await bffJson("tenant", "POST /api/rooms/{id}/closures", {
    params: { id: roomId },
    body: {
      start_date: input.startDate,
      end_date: input.endDate,
      reason: input.reason,
    },
  });
  return mapRoomClosure(saved);
}

export async function reopenRoom(
  roomId: string,
  closureId: string,
): Promise<void> {
  await bffJson("tenant", "DELETE /api/rooms/{id}/closures/{closureId}", {
    params: { id: roomId, closureId },
  });
}

/** Die Sperre, die den Raum an `day` sperrt, je Raum. */
export function closedRoomsOn(
  closures: readonly RoomClosure[] | undefined,
  day: string,
): ReadonlyMap<string, RoomClosure> {
  const closed = new Map<string, RoomClosure>();
  for (const closure of closures ?? []) {
    if (closure.startDate > day || closure.endDate < day) continue;
    const current = closed.get(closure.roomId);
    if (!current || closure.endDate > current.endDate) {
      closed.set(closure.roomId, closure);
    }
  }
  return closed;
}

/** „30.11.2026“ oder „30.11.2026 bis 02.12.2026“. */
export function roomClosurePeriod(closure: {
  readonly startDate: string;
  readonly endDate: string;
}): string {
  return closure.startDate === closure.endDate
    ? formatDate(closure.startDate)
    : `${formatDate(closure.startDate)} bis ${formatDate(closure.endDate)}`;
}

/** Text an einem gesperrten Raum in einer Auswahl: „Gesperrt: Wasserschaden“. */
export function roomClosureHint(closure: RoomClosure): string {
  return `Gesperrt: ${closure.reason}`;
}

/** `day` plus `days` Kalendertage, als YYYY-MM-DD. */
export function addCalendarDays(day: string, days: number): string {
  const date = parseISODate(day);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}
