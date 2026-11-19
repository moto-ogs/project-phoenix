// activity-api.test.ts
// Comprehensive tests for activity API service

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  BackendStudentEnrollment,
  Activity,
  UpdateActivityRequest,
} from "./activity-helpers";
import { mapActivityResponse } from "./activity-helpers";
import { buildBackendActivity } from "~/test/fixtures/activities";

// Mock dependencies
vi.mock("./session-cache", () => {
  const getCachedSession = vi.fn();
  return {
    getCachedSession,
    clearSessionCache: vi.fn(),
    sessionFetch: vi.fn(async (url: string, init?: RequestInit) => {
      // Same gate as the real sessionFetch (hasSessionAccess, #5005).
      const session = (await getCachedSession()) as {
        user?: { id?: string };
        error?: string;
      } | null;
      if (!session?.user || session.error)
        throw new Error("No authentication token available");
      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers as Record<string, string> | undefined),
        },
      });
      if (response.status === 401) {
        const { handleAuthFailure } = (await import("./auth-failure")) as {
          handleAuthFailure: () => Promise<boolean>;
        };
        const refreshed = await handleAuthFailure();
        if (refreshed) {
          const freshSession = (await getCachedSession()) as {
            user?: { id?: string };
            error?: string;
          } | null;
          if (!freshSession?.user || freshSession.error) {
            throw new Error("Authentication expired");
          }
          return fetch(url, {
            ...init,
            headers: {
              "Content-Type": "application/json",
              ...(init?.headers as Record<string, string> | undefined),
            },
          });
        }
        throw new Error("Authentication expired");
      }
      return response;
    }),
  };
});

vi.mock("./auth-api", () => ({
  handleAuthFailure: vi.fn(),
}));

// Import after mocks
import { getCachedSession } from "./session-cache";
import * as activityApi from "./activity-api";

const mockedGetSession = vi.mocked(getCachedSession);

// Sample test data
const sampleBackendActivity = buildBackendActivity({
  id: "1",
  name: "Basketball AG",
  max_participants: 20,
  is_open: true,
  category_id: "1",
  supervisor_id: "10",
  enrollment_count: 15,
});

const sampleBackendEnrollment: BackendStudentEnrollment = {
  id: 1,
  first_name: "Jane",
  last_name: "Smith",
  school_class: "5a",
  current_location: "room_101",
};

describe("activity-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window for browser detection
    vi.stubGlobal("window", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("fetchActivities", () => {
    it("fetches activities in browser context using fetch", async () => {
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce({
        user: { id: "1" },
        expires: "2099-01-01",
      });

      const mockResponse = {
        ok: true,
        json: async () => ({ data: [sampleBackendActivity] }),
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));

      const result = await activityApi.fetchActivities();

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("Basketball AG");
      expect(result[0]?.ag_category_id).toBe("1");
      expect(result[0]?.created_at).toBeInstanceOf(Date);
    });

    // Temporary (#7563): the previous release's route file answers a paged
    // object of mapped activities.
    it("handles nested data.data structure in browser context", async () => {
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce({
        user: { id: "1" },
        expires: "2099-01-01",
      });

      const mockResponse = {
        ok: true,
        json: async () => ({
          data: {
            data: [
              JSON.parse(
                JSON.stringify(mapActivityResponse(sampleBackendActivity)),
              ) as unknown,
            ],
          },
        }),
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));

      const result = await activityApi.fetchActivities();

      expect(result).toEqual([mapActivityResponse(sampleBackendActivity)]);
    });

    it("handles direct array response in browser context", async () => {
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce({
        user: { id: "1" },
        expires: "2099-01-01",
      });

      const frontendActivity: Activity = {
        id: "1",
        name: "Test Activity",
        max_participant: 20,
        is_open_ags: true,
        supervisor_id: "1",
        ag_category_id: "1",
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockResponse = {
        ok: true,
        json: async () => [frontendActivity],
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));

      const result = await activityApi.fetchActivities();

      expect(result).toHaveLength(1);
    });

    it("returns empty array for empty response", async () => {
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce({
        user: { id: "1" },
        expires: "2099-01-01",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: [] }),
        }),
      );

      const result = await activityApi.fetchActivities();

      expect(result).toEqual([]);
    });

    it("throws error when no token available in browser context", async () => {
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce(null);

      await expect(activityApi.fetchActivities()).rejects.toThrow(
        "No authentication token available",
      );
    });
  });

  describe("updateActivity", () => {
    const updateRequest: UpdateActivityRequest = {
      name: "Updated Activity",
      max_participants: 25,
      is_open: false,
      category_id: 2,
      supervisor_ids: [11],
    };

    it("updates activity in browser context", async () => {
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce({
        user: { id: "1" },
        expires: "2099-01-01",
      });

      const updatedActivity: Activity = {
        id: "1",
        name: "Updated Activity",
        max_participant: 25,
        is_open_ags: false,
        supervisor_id: "11",
        ag_category_id: "2",
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockResponse = {
        ok: true,
        json: async () => ({ data: updatedActivity }),
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));

      const result = await activityApi.updateActivity("1", updateRequest);

      expect(result.name).toBe("Updated Activity");
    });

    it("maps the contract's activity", async () => {
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce({
        user: { id: "1" },
        expires: "2099-01-01",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, data: sampleBackendActivity }),
        }),
      );

      const result = await activityApi.updateActivity("1", updateRequest);

      expect(result).toEqual(mapActivityResponse(sampleBackendActivity));
    });
  });

  describe("deleteActivity", () => {
    it("deletes activity in browser context", async () => {
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce({
        user: { id: "1" },
        expires: "2099-01-01",
      });

      const mockResponse = { ok: true };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));

      await activityApi.deleteActivity("1");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/activities/1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  describe("getCategories", () => {
    it("fetches categories in browser context with wrapped response", async () => {
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce({
        user: { id: "1" },
        expires: "2099-01-01",
      });

      const frontendCategory = {
        id: "1",
        name: "Sport",
        description: "Sports",
        color: "#3b82f6",
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockResponse = {
        ok: true,
        json: async () => ({ data: [frontendCategory] }),
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));

      const result = await activityApi.getCategories();

      expect(result).toHaveLength(1);
    });

    it("fetches categories in browser context with direct response", async () => {
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce({
        user: { id: "1" },
        expires: "2099-01-01",
      });

      const frontendCategory = {
        id: "1",
        name: "Sport",
        description: "Sports",
        color: "#3b82f6",
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockResponse = {
        ok: true,
        json: async () => [frontendCategory],
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));

      const result = await activityApi.getCategories();

      expect(result).toHaveLength(1);
    });

    it("maps the raw backend shape (shift_type_id) in browser context (#1837)", async () => {
      // Regression: the browser path used to return the raw payload unmapped,
      // so consumers reading category.shiftTypeId (e.g. the shift-type mapping
      // modal) never matched and could clear links.
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce({
        user: { id: "1" },
        expires: "2099-01-01",
      });

      const backendShaped = {
        id: 7,
        name: "Betreuung",
        color: "#83CD2D",
        shift_type_id: 99,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: [backendShaped] }),
        }),
      );

      const result = await activityApi.getCategories();

      expect(result[0]?.id).toBe("7");
      expect(result[0]?.shiftTypeId).toBe("99");
    });

    it("returns empty array for non-array response", async () => {
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce({
        user: { id: "1" },
        expires: "2099-01-01",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: null }),
        }),
      );

      const result = await activityApi.getCategories();

      expect(result).toEqual([]);
    });
  });

  describe("getEnrolledStudents", () => {
    it("fetches enrolled students in browser context", async () => {
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce({
        user: { id: "1" },
        expires: "2099-01-01",
      });

      const mockResponse = {
        ok: true,
        json: async () => ({
          data: [
            {
              id: "42",
              student_id: "42",
              name: "Jane Smith",
              school_class: "3A",
              current_location: null,
              activity_id: "1",
              created_at: "2024-01-15T08:00:00Z",
              updated_at: "2024-01-15T08:00:00Z",
            },
          ],
        }),
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));

      const result = await activityApi.getEnrolledStudents("1");

      expect(result).toHaveLength(1);
      expect(result[0]?.student_id).toBe("42");
      expect(result[0]?.name).toBe("Jane Smith");
    });

    it("handles direct array response", async () => {
      vi.stubGlobal("window", {});
      mockedGetSession.mockResolvedValueOnce({
        user: { id: "1" },
        expires: "2099-01-01",
      });

      const mockResponse = {
        ok: true,
        json: async () => [sampleBackendEnrollment],
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(mockResponse));

      const result = await activityApi.getEnrolledStudents("1");

      expect(result).toHaveLength(1);
    });
  });
});
