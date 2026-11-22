/**
 * Tests for the group and room list clients and the room delete of api.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { pagedJson } from "~/test/mocks/plain-session-fetch";

vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

vi.mock("./group-helpers", () => ({
  mapGroupsResponse: vi.fn(<T>(data: T): T => data),
}));

vi.mock("./room-helpers", () => ({
  mapRoomsResponse: vi.fn(<T>(data: T): T => data),
}));

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function calledURL(): string {
  const input = fetchMock.mock.calls[0]?.[0];
  return typeof input === "string" ? input : String(input);
}

describe("api.ts list clients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("groupService.getGroups", () => {
    it("rejects a refused list instead of caching an empty success (#2353)", async () => {
      fetchMock.mockResolvedValue(json({ status: 403 }, 403));
      const { groupService } = await import("./api");

      await expect(groupService.getGroups()).rejects.toMatchObject({
        status: 403,
      });
    });

    it.each([
      ["groups", 401],
      ["groups", 403],
      ["rooms", 401],
      ["rooms", 403],
    ] as const)(
      "keeps code, details and request ID of a %s refusal (%s)",
      async (resource, status) => {
        fetchMock.mockResolvedValue(
          json(
            {
              status,
              code: "module.not_booked",
              detail: "module rooms is not booked",
              details: { module: "rooms" },
              instance: "req-42",
            },
            status,
          ),
        );
        const { groupService, roomService } = await import("./api");

        const read =
          resource === "groups"
            ? groupService.getGroups()
            : roomService.getRooms();
        await expect(read).rejects.toMatchObject({
          status,
          code: "module.not_booked",
          details: { module: "rooms" },
          instance: "req-42",
        });
      },
    );

    // #2353: a refusal or an unreadable body is an error, never "no groups".
    it.each([
      ["a refusal", json({}, 403)],
      ["a null body", json(null)],
      ["an object without a list", json({ rows: [] })],
    ])(
      "rejects %s instead of resolving to no groups",
      async (_case, answer) => {
        fetchMock.mockResolvedValue(answer);
        const { groupService } = await import("./api");

        await expect(groupService.getGroups()).rejects.toBeInstanceOf(Error);
      },
    );

    it("maps the list of the paginated answer", async () => {
      const mockGroups = [{ id: "1", name: "Group A" }];
      fetchMock.mockResolvedValue(json(pagedJson(mockGroups)));
      const { groupService } = await import("./api");
      const { mapGroupsResponse } = await import("./group-helpers");

      await groupService.getGroups();

      expect(mapGroupsResponse).toHaveBeenCalledWith(mockGroups);
      expect(calledURL()).toBe("/api/groups");
    });
  });

  describe("roomService.getRooms", () => {
    it.each([401, 403] as const)(
      "preserves a refused shared room list (%s)",
      async (status) => {
        fetchMock.mockResolvedValue(json({ status }, status));
        const { rooms } = await import("./swr/rooms");

        await expect(rooms.fetcher()).rejects.toMatchObject({ status });
      },
    );

    it("sends the filters the room list reads as query parameters", async () => {
      fetchMock.mockResolvedValue(json(pagedJson([])));
      const { roomService } = await import("./api");

      await roomService.getRooms({
        building: "Building A",
        category: "classroom",
        includeSystem: false,
        page: 1,
        pageSize: 1000,
      });

      const url = calledURL();
      expect(url).toContain("building=Building+A");
      expect(url).toContain("category=classroom");
      expect(url).toContain("include_system=false");
      expect(url).toContain("page=1");
      expect(url).toContain("page_size=1000");
    });

    it("unwraps paginated room responses before mapping", async () => {
      const wrappedRooms = {
        data: [
          { id: "101", name: "Raum 101", capacity: 20 },
          { id: "102", name: "Raum 102", capacity: 18 },
        ],
        pagination: {
          current_page: 1,
          page_size: 1000,
          total_pages: 1,
          total_records: 2,
        },
      };
      fetchMock.mockResolvedValue(json(wrappedRooms));
      const { roomService } = await import("./api");
      const { mapRoomsResponse } = await import("./room-helpers");

      await roomService.getRooms({ page: 1, pageSize: 1000 });

      expect(mapRoomsResponse).toHaveBeenCalledWith(wrappedRooms.data);
    });

    // #2353: an unreadable body is a failure, never "no rooms".
    it.each([
      ["a null body", null],
      ["a string body", "oops"],
      ["an object without a list", { rooms: [] }],
    ])("rejects %s instead of resolving to no rooms", async (_case, body) => {
      fetchMock.mockResolvedValue(json(body));
      const { roomService } = await import("./api");
      const { mapRoomsResponse } = await import("./room-helpers");

      await expect(roomService.getRooms()).rejects.toMatchObject({
        status: 502,
        code: "general.unavailable",
      });
      expect(mapRoomsResponse).not.toHaveBeenCalled();
    });
  });

  describe("roomService.deleteRoom", () => {
    it("calls fetch with correct URL and method", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      const { roomService } = await import("./api");

      await roomService.deleteRoom("456");

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/rooms/456"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });
});
