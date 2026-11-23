import type { RoomResponse } from "~/lib/contract/rooms.generated";

let roomIdCounter = 0;

function nextId() {
  return String(++roomIdCounter);
}

/**
 * Builds a room of the contract (`RoomResponse`, as the catalog proxy hands
 * it on) with sensible defaults.
 */
export function buildRoomResponse(
  overrides?: Partial<RoomResponse>,
): RoomResponse {
  const id = overrides?.id ?? nextId();
  return {
    id,
    name: "Room 101",
    building: "Building A",
    floor: 2,
    capacity: 30,
    category: "classroom",
    color: "#FF0000",
    is_occupied: false,
    student_count: 0,
    is_system: false,
    is_open_room: false,
    created_at: "2024-01-15T10:00:00Z",
    updated_at: "2024-01-15T12:00:00Z",
    version: "2024-01-15T12:00:00Z",
    ...overrides,
  };
}
