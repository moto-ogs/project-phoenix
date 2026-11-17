import { previewRow, previewText, type ListPreview } from "./list-preview";
import { SWR_FAMILIES } from "./shell-keys";
import type { roomService } from "~/lib/api";
import { resourceKey } from "./resource-key";
export type RoomFilters = NonNullable<
  Parameters<typeof roomService.getRooms>[0]
>;
export const roomKeys = {
  previewSources: (key: string) => key.startsWith("rooms-list-"),
  preview(data: unknown, id: string): ListPreview | undefined {
    const row = previewRow(data, id);
    const name = previewText(row?.name);
    return name ? { id, name, context: previewText(row?.building) } : undefined;
  },
  family: SWR_FAMILIES.rooms,
  key: (params: RoomFilters = {}) => resourceKey("rooms-list-", params),
  // The room page's room with its history. Outside the list family; the SSE
  // hook and the room sections refresh it via the "room-detail-" prefix.
  detailKey: (id: string) => `room-detail-${encodeURIComponent(id)}`,
  // Children in a room (up to 200). The SSE hook and the check-in mode
  // refresh every key containing "room-students-".
  students: (roomId: string) => `room-students-${roomId}`,
  // Running visits of the source groups of a bulk move; the SSE hook
  // refreshes the "room-bulk-source-visits-" prefix.
  sourceVisits: (groupIds: readonly string[]) =>
    `room-bulk-source-visits-${JSON.stringify(groupIds)}`,
  /** The room's plan blocks in the shown span (#4768). */
  plan: (roomId: string, from: string, to: string) =>
    `room-plan-${roomId}-${from}-${to}`,
  /** Children on the way, optionally for one day status. */
  transitStudents: (dayStatus?: string) =>
    dayStatus ? `transit-students-${dayStatus}` : "transit-students",
} as const;

// Keys of the check-in target (#6953). The session and supervision keys are
// the room page's move keys on purpose: one fetch serves both, and a move or
// a check-in refreshes both lists.
export const checkinTargetKeys = {
  activeGroups: () => "room-bulk-active-groups",
  supervisions: (staffId: string) => `room-bulk-active-supervisions-${staffId}`,
  activities: () => "checkin-target-activities",
  roomCandidates: () => "room-checkin-candidates",
} as const;
