/**
 * Tests for api.ts helper functions
 * These test the pure helper functions that parse, validate, and transform API data
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("next-auth/react", () => ({
  getSession: vi.fn(() => Promise.resolve({ user: { id: "1" } })),
}));

vi.mock("./auth-failure", () => ({
  handleAuthFailure: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("./api-helpers", () => ({
  fetchWithRetry: vi.fn(),
}));

vi.mock("./group-helpers", () => ({
  mapGroupsResponse: vi.fn(<T>(data: T): T => data),
}));

vi.mock("./room-helpers", () => ({
  mapRoomsResponse: vi.fn(<T>(data: T): T => data),
}));

// Helper function to setup window mock for browser environment
function setupBrowserEnv() {
  const original = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value: {},
    writable: true,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, "window", {
      value: original,
      writable: true,
      configurable: true,
    });
  };
}

describe("api.ts helper functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("groupService.getGroups", () => {
    it("rejects a refused list instead of caching an empty success (#2353)", async () => {
      const { fetchWithRetry } = await import("./api-helpers");
      vi.mocked(fetchWithRetry).mockResolvedValue({
        data: null,
        response: null,
        accessDeniedStatus: 403,
      });
      const { groupService } = await import("./api");
      const restore = setupBrowserEnv();
      try {
        await expect(groupService.getGroups()).rejects.toMatchObject({
          status: 403,
        });
      } finally {
        restore();
      }
    });
    it.each([
      ["groups", 401],
      ["groups", 403],
      ["rooms", 401],
      ["rooms", 403],
    ] as const)(
      "keeps code, details and request ID of a %s refusal (%s)",
      async (resource, status) => {
        const { fetchWithRetry } = await import("./api-helpers");
        vi.mocked(fetchWithRetry).mockResolvedValue({
          data: null,
          response: null,
          accessDeniedStatus: status,
          accessDeniedBody: {
            status,
            code: "module.not_booked",
            detail: "module rooms is not booked",
            details: { module: "rooms" },
            instance: "req-42",
          },
        });
        const { groupService, roomService } = await import("./api");
        const restore = setupBrowserEnv();
        try {
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
        } finally {
          restore();
        }
      },
    );
    // #2353: a refusal or an unreadable body is an error, never "no groups".
    it.each([
      ["a refusal", { data: null, response: null }],
      ["a null body", { data: null, response: new Response() }],
      [
        "an object without a list",
        { data: { rows: [] }, response: new Response() },
      ],
    ])(
      "rejects %s instead of resolving to no groups",
      async (_case, result) => {
        const { fetchWithRetry } = await import("./api-helpers");
        vi.mocked(fetchWithRetry).mockResolvedValue(result);

        const { groupService } = await import("./api");

        const restore = setupBrowserEnv();
        try {
          await expect(groupService.getGroups()).rejects.toBeInstanceOf(Error);
        } finally {
          restore();
        }
      },
    );

    it("parses wrapped API response format", async () => {
      const { fetchWithRetry } = await import("./api-helpers");
      const mockGroups = [{ id: 1, name: "Group A" }];
      vi.mocked(fetchWithRetry).mockResolvedValue({
        data: { data: mockGroups },
        response: new Response(),
      });

      const { groupService } = await import("./api");
      const { mapGroupsResponse } = await import("./group-helpers");

      const restore = setupBrowserEnv();
      try {
        await groupService.getGroups();
        expect(mapGroupsResponse).toHaveBeenCalledWith(mockGroups);
      } finally {
        restore();
      }
    });
  });

  describe("roomService.getRooms", () => {
    it.each([401, 403] as const)(
      "preserves a refused shared room list (%s)",
      async (status) => {
        const { fetchWithRetry } = await import("./api-helpers");
        vi.mocked(fetchWithRetry).mockResolvedValue({
          data: null,
          response: null,
          accessDeniedStatus: status,
        });
        const { rooms } = await import("./swr/rooms");
        const restore = setupBrowserEnv();
        try {
          await expect(rooms.fetcher()).rejects.toMatchObject({ status });
        } finally {
          restore();
        }
      },
    );

    it("builds correct query params with filters", async () => {
      const { fetchWithRetry } = await import("./api-helpers");
      vi.mocked(fetchWithRetry).mockResolvedValue({
        data: [],
        response: new Response(),
      });

      const { roomService } = await import("./api");

      const restore = setupBrowserEnv();
      try {
        await roomService.getRooms({
          building: "Building A",
          floor: 2,
          category: "classroom",
          occupied: true,
          search: "test",
          page: 1,
          pageSize: 1000,
        });

        const callUrl = vi.mocked(fetchWithRetry).mock.calls[0]?.[0];
        expect(callUrl).toContain("building=Building+A");
        expect(callUrl).toContain("floor=2");
        expect(callUrl).toContain("category=classroom");
        expect(callUrl).toContain("occupied=true");
        expect(callUrl).toContain("search=test");
        expect(callUrl).toContain("page=1");
        expect(callUrl).toContain("page_size=1000");
      } finally {
        restore();
      }
    });

    it("unwraps paginated room responses before mapping", async () => {
      const wrappedRooms = {
        data: [
          { id: 101, name: "Raum 101", capacity: 20 },
          { id: 102, name: "Raum 102", capacity: 18 },
        ],
        pagination: {
          current_page: 1,
          page_size: 1000,
          total_pages: 1,
          total_records: 2,
        },
      };
      const { fetchWithRetry } = await import("./api-helpers");
      vi.mocked(fetchWithRetry).mockResolvedValue({
        data: wrappedRooms,
        response: new Response(),
      });

      const { roomService } = await import("./api");
      const { mapRoomsResponse } = await import("./room-helpers");

      const restore = setupBrowserEnv();
      try {
        await roomService.getRooms({ page: 1, pageSize: 1000 });
        expect(mapRoomsResponse).toHaveBeenCalledWith(wrappedRooms.data);
      } finally {
        restore();
      }
    });

    // #2353: an invalid answer rejects instead of mapping to no rooms.
    it("rejects wrapped room responses with non-array data as invalid", async () => {
      const { fetchWithRetry } = await import("./api-helpers");
      vi.mocked(fetchWithRetry).mockResolvedValue({
        data: { data: { id: 101, name: "Not a list" } },
        response: new Response(),
      });

      const { roomService } = await import("./api");
      const { mapRoomsResponse } = await import("./room-helpers");

      const restore = setupBrowserEnv();
      try {
        await expect(roomService.getRooms()).rejects.toMatchObject({
          status: 500,
        });
        expect(mapRoomsResponse).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });
  });

  describe("roomService.deleteRoom", () => {
    it("calls fetch with correct URL and method", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { getSession } = await import("next-auth/react");
      vi.mocked(getSession).mockResolvedValue({
        user: { id: "1" },
      } as never);

      const { roomService } = await import("./api");

      const restore = setupBrowserEnv();
      try {
        await roomService.deleteRoom("456");
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/rooms/456"),
          expect.objectContaining({ method: "DELETE" }),
        );
      } finally {
        restore();
      }
    });
  });

  describe("query parameter builders", () => {
    it("buildRoomQueryParams includes all filters", async () => {
      const { fetchWithRetry } = await import("./api-helpers");
      vi.mocked(fetchWithRetry).mockResolvedValue({
        data: [],
        response: new Response(),
      });

      const { roomService } = await import("./api");

      const restore = setupBrowserEnv();
      try {
        await roomService.getRooms({
          building: "Main Building",
          floor: 3,
          category: "lab",
          occupied: false,
          search: "chemistry",
          page: 1,
          pageSize: 1000,
        });

        const url = vi.mocked(fetchWithRetry).mock.calls[0]?.[0] ?? "";
        expect(url).toContain("building=Main+Building");
        expect(url).toContain("floor=3");
        expect(url).toContain("category=lab");
        expect(url).toContain("occupied=false");
        expect(url).toContain("search=chemistry");
        expect(url).toContain("page=1");
        expect(url).toContain("page_size=1000");
      } finally {
        restore();
      }
    });
  });

  describe("response parsing edge cases", () => {
    // #2353: an unreadable body is a server failure, never "no rooms".
    it.each([
      ["a null body", null],
      ["a string body", "oops"],
      ["an object without a list", { data: { rooms: [] } }],
    ])("rejects %s instead of resolving to no rooms", async (_case, data) => {
      const { fetchWithRetry } = await import("./api-helpers");
      vi.mocked(fetchWithRetry).mockResolvedValue({
        data,
        response: new Response(),
      });

      const { roomService } = await import("./api");

      const restore = setupBrowserEnv();
      try {
        await expect(roomService.getRooms()).rejects.toMatchObject({
          status: 500,
          code: "general.server",
        });
      } finally {
        restore();
      }
    });
  });
});
