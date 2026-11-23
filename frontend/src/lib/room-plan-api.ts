// Abruf des Raumplans (#4768): GET /api/timetable/instances mit `room_id`,
// abgebildet auf die wenigen Felder des Reiters. Eigener kleiner Client statt
// `timetableService.getWeek`, weil dessen Abbildung die Planner-Typen und
// -Helfer mitzieht.

import { bffJson } from "~/lib/bff-fetch";
import type { RoomPlanBlock } from "~/lib/room-plan";

/** Die Blöcke des Raums von `from` bis `to` (beide inklusive). */
export async function fetchRoomPlanBlocks(
  roomId: string,
  from: string,
  to: string,
): Promise<RoomPlanBlock[]> {
  const week = await bffJson("tenant", "GET /api/timetable/instances/", {
    query: { from, to, room_id: roomId },
    errorMessage: "Der Raumplan konnte nicht geladen werden.",
  });
  return (week.instances ?? []).map((raw) => ({
    id: raw.id,
    date: raw.date,
    startTime: raw.start_time,
    endTime: raw.end_time,
    title: raw.title,
    status: raw.status,
    ...(raw.group_name ? { groupName: raw.group_name } : {}),
    ...(raw.cancel_reason ? { cancelReason: raw.cancel_reason } : {}),
  }));
}
