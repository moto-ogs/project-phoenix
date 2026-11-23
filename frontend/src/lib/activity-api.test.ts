// activity-api.test.ts
// Comprehensive tests for activity API service

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Activity } from "./activity-helpers";
import type { ActivityRequest } from "./contract/activities.generated";
import { mapActivityResponse } from "./activity-helpers";
import { buildBackendActivity } from "~/test/fixtures/activities";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

vi.mock("./auth-api", () => ({
  handleAuthFailure: vi.fn(),
}));

// Import after mocks
import { ApiError } from "./api-error";
import * as sessionCache from "./session-cache";
import * as activityApi from "./activity-api";

/** The staff session gate refuses before any request leaves. */
function refuseSession(
  error: unknown = new ApiError("Authentication required", 401, {
    code: "general.permission",
  }),
) {
  vi.spyOn(sessionCache, "requireTenantSession").mockRejectedValueOnce(error);
}

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

    it("returns empty array for empty response", async () => {
      vi.stubGlobal("window", {});
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
      refuseSession();

      await expect(activityApi.fetchActivities()).rejects.toMatchObject({
        message: "Authentication required",
        status: 401,
        code: "general.permission",
      });
    });
  });

  describe("updateActivity", () => {
    const updateRequest: ActivityRequest = {
      name: "Updated Activity",
      max_participants: 25,
      is_open: false,
      category_id: "2",
      supervisor_ids: ["11"],
    };

    it("updates activity in browser context", async () => {
      vi.stubGlobal("window", {});

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
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: "success",
            data: sampleBackendActivity,
          }),
        }),
      );

      const result = await activityApi.updateActivity("1", updateRequest);

      expect(result).toEqual(mapActivityResponse(sampleBackendActivity));
    });
  });

  describe("deleteActivity", () => {
    it("deletes activity in browser context", async () => {
      vi.stubGlobal("window", {});

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })),
      );

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

    it("maps the raw backend shape (shift_type_id) in browser context (#1837)", async () => {
      // Regression: the browser path used to return the raw payload unmapped,
      // so consumers reading category.shiftTypeId (e.g. the shift-type mapping
      // modal) never matched and could clear links.
      vi.stubGlobal("window", {});

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
  });

  describe("getEnrolledStudents", () => {
    it("reads the contract's roster and maps it to the view", async () => {
      vi.stubGlobal("window", {});
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          data: [{ id: "42", first_name: "Jane", last_name: "Smith" }],
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await activityApi.getEnrolledStudents("1");

      expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/activities/1/students");
      expect(result).toEqual([{ id: "42", name: "Jane Smith" }]);
    });

    it("throws the API error of a failed read", async () => {
      vi.stubGlobal("window", {});
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: 403,
              code: "general.forbidden",
              detail: "no",
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/problem+json" },
            },
          ),
        ),
      );

      await expect(activityApi.getEnrolledStudents("1")).rejects.toMatchObject({
        status: 403,
      });
    });
  });
});
