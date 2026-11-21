// Abruf des Raumplans (#4768): GET /api/timetable/instances mit `room_id`,
// abgebildet auf die wenigen Felder des Reiters. Eigener kleiner Client statt
// `timetableService.getWeek`, weil dessen Abbildung die Planner-Typen und
// -Helfer mitzieht.

import type { weeklyInstancesResponse } from "~/lib/contract/timetable.generated";
import { apiErrorFromBody, transportFetch } from "~/lib/api-error";
import type { RoomPlanBlock } from "~/lib/room-plan";

interface RoomPlanEnvelope {
  readonly data: weeklyInstancesResponse;
}

/** Die Blöcke des Raums von `from` bis `to` (beide inklusive). */
export async function fetchRoomPlanBlocks(
  roomId: string,
  from: string,
  to: string,
): Promise<RoomPlanBlock[]> {
  const params = new URLSearchParams({ from, to, room_id: roomId });
  const response = await transportFetch(`/api/timetable/instances?${params}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    throw apiErrorFromBody(
      `Anfrage fehlgeschlagen (HTTP ${response.status})`,
      response.status,
      await response.json().catch(() => undefined),
    );
  }
  const body = (await response.json()) as RoomPlanEnvelope;
  return (body.data.instances ?? []).map((raw) => ({
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
