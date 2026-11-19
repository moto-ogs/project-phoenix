import { describe, it, expect, vi } from "vitest";
import type { RoomResponse } from "./contract/rooms.generated";
import type { Room } from "./room-helpers";
import {
  mapRoomResponse,
  mapRoomsResponse,
  prepareRoomForBackend,
  getRoomCategoryColor,
  isColorLockedRoom,
  isSystemRoom,
  formatFloor,
} from "./room-helpers";
import { MOTO_COLOR_PALETTE } from "~/lib/kit-palette";
import { suppressConsole } from "~/test/helpers/console";
import { buildRoomResponse } from "~/test/fixtures/rooms";

// A room as the catalog proxy hands it on (#7563).
const sampleBackendRoom = buildRoomResponse({
  id: "1",
  name: "Room 101",
  building: "Building A",
  floor: 2,
  capacity: 30,
  category: "classroom",
  color: "#FF0000",
  is_occupied: true,
  group_name: "Class 3A",
  supervisor_names: "John Smith, Erika Muster",
  student_count: 25,
});

describe("mapRoomResponse", () => {
  it("maps the contract room to the frontend room structure", () => {
    const result = mapRoomResponse(sampleBackendRoom);

    expect(result.id).toBe("1");
    expect(result.name).toBe("Room 101");
    expect(result.building).toBe("Building A");
    expect(result.floor).toBe(2);
    expect(result.capacity).toBe(30);
    expect(result.category).toBe("classroom");
    expect(result.color).toBe("#FF0000");
    expect(result.isOccupied).toBe(true);
    expect(result.groupName).toBe("Class 3A");
    // The backend names every supervisor of the room in one field.
    expect(result.supervisorName).toBe("John Smith, Erika Muster");
    expect(result.studentCount).toBe(25);
    expect(result.createdAt).toBe("2024-01-15T10:00:00Z");
    expect(result.updatedAt).toBe("2024-01-15T12:00:00Z");
  });

  it("keeps the release, system and archive flags", () => {
    const result = mapRoomResponse({
      ...sampleBackendRoom,
      is_system: true,
      is_open_room: true,
      archived_at: "2026-09-01T08:00:00Z",
    });

    expect(result.isSystem).toBe(true);
    expect(result.isOpenRoom).toBe(true);
    expect(result.archivedAt).toBe("2026-09-01T08:00:00Z");
  });

  it("leaves absent optional fields undefined", () => {
    const backendRoom: RoomResponse = {
      ...sampleBackendRoom,
      floor: undefined,
      capacity: undefined,
      category: undefined,
      color: undefined,
    };

    const result = mapRoomResponse(backendRoom);

    expect(result.floor).toBeUndefined();
    expect(result.capacity).toBeUndefined();
    expect(result.category).toBeUndefined();
    expect(result.color).toBeUndefined();
  });

  it("treats a legacy zero capacity as no limit", () => {
    const result = mapRoomResponse({
      ...sampleBackendRoom,
      capacity: 0,
    });

    expect(result.capacity).toBeUndefined();
  });

  it("handles minimal backend room (required fields only)", () => {
    const minimalRoom: RoomResponse = {
      id: "2",
      name: "Minimal Room",
      is_occupied: false,
      student_count: 0,
      is_system: false,
      is_open_room: false,
      created_at: "2024-01-15T10:00:00Z",
      updated_at: "2024-01-15T10:00:00Z",
    };

    const result = mapRoomResponse(minimalRoom);

    expect(result.id).toBe("2");
    expect(result.name).toBe("Minimal Room");
    expect(result.isOccupied).toBe(false);
    expect(result.building).toBeUndefined();
    expect(result.floor).toBeUndefined();
  });
});

describe("mapRoomsResponse", () => {
  const consoleSpies = suppressConsole("warn", "log");

  it("maps array of backend rooms", () => {
    const backendRooms = [sampleBackendRoom, { ...sampleBackendRoom, id: "2" }];

    const result = mapRoomsResponse(backendRooms);

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("1");
    expect(result[1]?.id).toBe("2");
  });

  it("handles nested API response structure { data: [...] }", () => {
    const debugSpy = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    const nestedResponse = {
      data: [sampleBackendRoom, { ...sampleBackendRoom, id: "2" }],
    };

    const result = mapRoomsResponse(nestedResponse);

    expect(result).toHaveLength(2);
    expect(debugSpy).toHaveBeenCalledWith(
      "handling nested API response for rooms",
      undefined,
    );
    debugSpy.mockRestore();
  });

  it("returns empty array for null input", () => {
    const result = mapRoomsResponse(null);

    expect(result).toEqual([]);
    expect(consoleSpies.warn).toHaveBeenCalledWith(
      "received invalid response format for rooms",
      { received: "object" },
    );
  });

  it("returns empty array for undefined-like input", () => {
    // TypeScript types prevent passing undefined directly, but runtime might receive it
    const result = mapRoomsResponse(
      undefined as unknown as RoomResponse[] | null,
    );

    expect(result).toEqual([]);
  });

  it("returns empty array for non-array input", () => {
    const result = mapRoomsResponse(
      "invalid" as unknown as RoomResponse[] | null,
    );

    expect(result).toEqual([]);
    expect(consoleSpies.warn).toHaveBeenCalled();
  });

  it("handles empty array", () => {
    const result = mapRoomsResponse([]);

    expect(result).toEqual([]);
  });
});

describe("prepareRoomForBackend", () => {
  it("converts frontend room to the contract body", () => {
    const frontendRoom: Partial<Room> = {
      id: "1",
      name: "Room 101",
      building: "Building A",
      floor: 2,
      capacity: 43,
      category: "classroom",
      color: "#FF0000",
      deviceId: "device-123",
      isOccupied: true,
    };

    const result = prepareRoomForBackend(frontendRoom);

    // The body carries only what the backend reads (RoomRequest).
    expect(result).not.toHaveProperty("id");
    expect(result.name).toBe("Room 101");
    expect(result.building).toBe("Building A");
    expect(result.floor).toBe(2);
    expect(result.capacity).toBe(43);
    expect(result.category).toBe("classroom");
    expect(result.color).toBe("#FF0000");
    expect(result).not.toHaveProperty("device_id");
    expect(result).not.toHaveProperty("is_occupied");
  });

  it("returns empty object when name is empty string", () => {
    const result = prepareRoomForBackend({ name: "" });

    expect(result).toEqual({});
  });

  it("omits optional fields that are undefined", () => {
    const result = prepareRoomForBackend({
      name: "Test Room",
    });

    expect(result).toEqual({ name: "Test Room" });
    expect(result.building).toBeUndefined();
    expect(result.floor).toBeUndefined();
    expect(result.capacity).toBeUndefined();
    expect(result.category).toBeUndefined();
  });

  it("omits optional fields that are empty strings", () => {
    const result = prepareRoomForBackend({
      name: "Test Room",
      building: "",
      category: "",
      color: "",
      deviceId: "",
    });

    expect(result.name).toBe("Test Room");
    expect(result.building).toBeUndefined();
    expect(result.category).toBeUndefined();
    expect(result.color).toBeUndefined();
  });

  it("includes floor when explicitly set to 0", () => {
    const result = prepareRoomForBackend({
      name: "Ground Floor Room",
      floor: 0,
    });

    expect(result.floor).toBe(0);
  });

  it("maps an empty capacity to null so an existing limit is cleared", () => {
    const result = prepareRoomForBackend({
      name: "Room without limit",
      capacity: "" as unknown as number,
    });

    expect(result.capacity).toBeNull();
  });

  it("handles room without id (for creation)", () => {
    const result = prepareRoomForBackend({
      name: "New Room",
    });

    expect(result).not.toHaveProperty("id");
  });
});

describe("formatFloor", () => {
  it.each([
    [2, "Etage 2"],
    [0, "Erdgeschoss"],
    [undefined, "Etage nicht angegeben"],
  ])("formats floor %j as %j", (floor, expected) => {
    expect(formatFloor(floor)).toBe(expected);
  });
});

describe("isColorLockedRoom", () => {
  // Issue #2405 — the Schulhof left the colour-locked set: schools colour-code
  // rooms and tablets and need the yard in that scheme. Only the toilet rooms
  // keep the frozen colour (they have no badge of their own).
  it("locks the WC", () => {
    expect(isColorLockedRoom({ id: "1", name: "WC" } as never)).toBe(true);
  });

  it("locks the Toilette alias", () => {
    expect(isColorLockedRoom({ id: "1", name: "Toilette" } as never)).toBe(
      true,
    );
  });

  it("does NOT lock the Schulhof", () => {
    expect(isColorLockedRoom({ id: "1", name: "Schulhof" } as never)).toBe(
      false,
    );
  });

  it("does not lock a regular room", () => {
    expect(isColorLockedRoom({ id: "1", name: "Werkraum" } as never)).toBe(
      false,
    );
  });

  it("returns false for null/undefined", () => {
    expect(isColorLockedRoom(null)).toBe(false);
    expect(isColorLockedRoom(undefined)).toBe(false);
  });
});

describe("isSystemRoom", () => {
  it("returns true for Schulhof", () => {
    const room: Room = { id: "1", name: "Schulhof", isOccupied: false };
    expect(isSystemRoom(room)).toBe(true);
  });

  it("returns true for WC", () => {
    const room: Room = { id: "2", name: "WC", isOccupied: false };
    expect(isSystemRoom(room)).toBe(true);
  });

  it("returns true for Toilette", () => {
    const room: Room = { id: "3", name: "Toilette", isOccupied: false };
    expect(isSystemRoom(room)).toBe(true);
  });

  it("returns false for regular room", () => {
    const room: Room = { id: "4", name: "Gruppenraum 1", isOccupied: false };
    expect(isSystemRoom(room)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isSystemRoom(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isSystemRoom(undefined)).toBe(false);
  });
});

describe("getRoomCategoryColor", () => {
  it("resolves every known category to its palette token", () => {
    expect(getRoomCategoryColor("Normaler Raum")).toBe(
      MOTO_COLOR_PALETTE.indigo.base,
    );
    expect(getRoomCategoryColor("Gruppenraum")).toBe(
      MOTO_COLOR_PALETTE.emerald.base,
    );
    expect(getRoomCategoryColor("Themenraum")).toBe(
      MOTO_COLOR_PALETTE.violet.base,
    );
    expect(getRoomCategoryColor("Sport")).toBe(MOTO_COLOR_PALETTE.pink.base);
  });

  it("keeps the four categories visually distinct", () => {
    const colors = ["Normaler Raum", "Gruppenraum", "Themenraum", "Sport"].map(
      (category) => getRoomCategoryColor(category),
    );
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("falls back to the neutral palette gray for unknown or missing categories", () => {
    expect(getRoomCategoryColor("Aula")).toBe(MOTO_COLOR_PALETTE.neutral.base);
    expect(getRoomCategoryColor(null)).toBe(MOTO_COLOR_PALETTE.neutral.base);
    expect(getRoomCategoryColor(undefined)).toBe(
      MOTO_COLOR_PALETTE.neutral.base,
    );
    expect(getRoomCategoryColor("")).toBe(MOTO_COLOR_PALETTE.neutral.base);
  });
});
