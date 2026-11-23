// lib/room-helpers.ts
// Type definitions and helper functions for rooms

import type { RoomRequest, RoomResponse } from "~/lib/contract/rooms.generated";
import { MOTO_COLOR_PALETTE } from "~/lib/kit-palette";

// Accent per room category — used by the rooms grid card and the
// room-detail history timeline so a category reads the same way in both
// places. Values come from MOTO_COLOR_PALETTE (Querregel Farbe); the
// fallback for unknown / missing categories is the neutral gray below.
// Single source of truth: previously this map was duplicated in
// rooms/page.tsx and components/rooms/room-detail-content.tsx.
const ROOM_CATEGORY_COLORS: Record<string, string> = {
  "Normaler Raum": MOTO_COLOR_PALETTE.indigo.base,
  Gruppenraum: MOTO_COLOR_PALETTE.emerald.base,
  Themenraum: MOTO_COLOR_PALETTE.violet.base,
  Sport: MOTO_COLOR_PALETTE.pink.base,
};

const ROOM_CATEGORY_FALLBACK_COLOR = MOTO_COLOR_PALETTE.neutral.base;

/** The backend's code for a room history the school switched off. */
export const ROOM_HISTORY_DISABLED_CODE = "attendance.log_disabled";

export function getRoomCategoryColor(
  category: string | null | undefined,
): string {
  if (!category) return ROOM_CATEGORY_FALLBACK_COLOR;
  return ROOM_CATEGORY_COLORS[category] ?? ROOM_CATEGORY_FALLBACK_COLOR;
}

// Frontend types
export interface Room {
  id: string;
  name: string;
  building?: string;
  floor?: number; // Optional (nullable in DB)
  capacity?: number; // Optional (nullable in DB)
  category?: string; // Optional (nullable in DB)
  color?: string; // Optional (nullable in DB)
  deviceId?: string;
  isOccupied: boolean;
  isSystem?: boolean;
  /** Permanently released for use ("offener Raum"), set by the administration. */
  isOpenRoom?: boolean;
  /** Archiviert: aus allen Listen genommen, nur noch im Verlauf (#6845). */
  archivedAt?: string;
  activityName?: string;
  groupName?: string;
  supervisorName?: string;
  studentCount?: number;
  createdAt?: string;
  updatedAt?: string;
  /** Stand des Raums; das Speichern schickt ihn mit (ADR 0311). */
  version?: string;
}

// System room names that cannot be deleted or renamed.
// Must stay in sync with backend constants/activities.go
// (SchulhofRoomName, WCRoomName, WCRoomAliasName) and PyrePortal
// src/services/api.ts (WC_ROOM_ALIASES). Matching is exact-case to mirror
// the backend's `name == SchulhofRoomName || IsWCRoomName(name)` check.
const SCHULHOF_ROOM_NAME = "Schulhof";
const SYSTEM_ROOM_NAMES = [SCHULHOF_ROOM_NAME, "WC", "Toilette"] as const;

/** Returns true if the room is a system room (Schulhof, WC, Toilette). */
export function isSystemRoom(room: Room | null | undefined): boolean {
  if (!room) return false;
  return SYSTEM_ROOM_NAMES.includes(
    room.name as (typeof SYSTEM_ROOM_NAMES)[number],
  );
}

// Toilet-room aliases — the subset of system rooms whose color is NOT
// admin-configurable. The Schulhof left this set with #2405: schools
// color-code rooms and tablets and need the yard to take part, so it keeps
// only the rename/delete protection. The WC has no badge of its own, so a
// color picker there would configure nothing.
const TOILET_ROOM_NAMES = ["WC", "Toilette"] as const;

/**
 * Returns true if the room is one of the canonical toilet rooms. They are
 * kiosk infrastructure for short stays and can never be released as an open
 * room — the backend refuses that with ErrToiletRoomNotReleasable.
 */
export function isToiletRoom(room: Room | null | undefined): boolean {
  if (!room) return false;
  return TOILET_ROOM_NAMES.includes(
    room.name as (typeof TOILET_ROOM_NAMES)[number],
  );
}

/**
 * Returns true if the room's color is fixed by the system and must not be
 * offered for editing. Mirrors the backend guard in
 * services/facilities.UpdateRoom, which rejects color changes for exactly
 * these rooms.
 */
export function isColorLockedRoom(room: Room | null | undefined): boolean {
  return isToiletRoom(room);
}

// Mapping functions

/**
 * Maps a room of the contract (`RoomResponse`, via the catalog proxy) onto the
 * frontend room. The identifier arrives as a decimal string.
 */
export function mapRoomResponse(room: RoomResponse): Room {
  return {
    id: String(room.id),
    name: room.name,
    building: room.building,
    floor: room.floor ?? undefined,
    capacity:
      room.capacity !== null && room.capacity !== undefined && room.capacity > 0
        ? room.capacity
        : undefined,
    category: room.category ?? undefined,
    color: room.color ?? undefined,
    isOccupied: room.is_occupied,
    isSystem: room.is_system,
    isOpenRoom: room.is_open_room,
    archivedAt: room.archived_at,
    groupName: room.group_name,
    supervisorName: room.supervisor_names,
    studentCount: room.student_count,
    createdAt: room.created_at,
    updatedAt: room.updated_at,
    version: room.version,
  };
}

/**
 * The room as read, with the stored fields and the version of a save's
 * answer. The answer of PUT /api/rooms/{id} names no occupancy, so the
 * occupancy stays as read.
 */
export function withStoredRoomFields(read: Room, saved: Room): Room {
  return {
    ...read,
    name: saved.name,
    building: saved.building,
    floor: saved.floor,
    capacity: saved.capacity,
    category: saved.category,
    color: saved.color,
    isSystem: saved.isSystem,
    isOpenRoom: saved.isOpenRoom,
    archivedAt: saved.archivedAt,
    updatedAt: saved.updatedAt,
    version: saved.version,
  };
}

/** The rooms of a list answer; Go writes an empty list as null. */
export function mapRoomsResponse(
  rooms: readonly RoomResponse[] | null,
): Room[] {
  return (rooms ?? []).map(mapRoomResponse);
}

/** Prepares a frontend room as the body of POST and PUT /api/rooms. */
export function prepareRoomForBackend(room: Partial<Room>): RoomRequest {
  // Make sure we don't send an empty name
  if (room.name === "") return {};

  const body: RoomRequest = { name: room.name };

  // Only include optional fields if they have non-empty values
  if (room.building !== undefined && room.building !== "") {
    body.building = room.building;
  }
  if (room.floor !== undefined) {
    body.floor = room.floor;
  }
  const capacity = (room as { capacity?: unknown }).capacity;
  if (typeof capacity === "number") {
    body.capacity = capacity;
  } else if (capacity === null || capacity === "") {
    body.capacity = null;
  }
  if (room.category !== undefined && room.category !== "") {
    body.category = room.category;
  }
  if (room.color !== undefined && room.color !== "") {
    body.color = room.color;
  }
  // Sent only when the form actually carries a value. The backend treats an
  // omitted is_open_room as "leave the release as it is", which is what keeps
  // an unrelated edit from revoking a standing release (#3064). false is a
  // real answer here and must survive the check.
  if (typeof room.isOpenRoom === "boolean") {
    body.is_open_room = room.isOpenRoom;
  }
  // The stored state the form was filled from; the backend refuses a save
  // over a room someone changed since (ADR 0311).
  if (room.version !== undefined) {
    body.expected_version = room.version;
  }

  return body;
}

// Request/Response types

// Helper functions
export function formatFloor(floor: number | undefined): string {
  if (floor === undefined) return "Etage nicht angegeben";
  if (floor === 0) return "Erdgeschoss";
  return `Etage ${floor}`;
}
