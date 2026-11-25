import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { getSession } from "next-auth/react";
import { ApiError } from "./api-error";
import { timeTrackingService } from "./time-tracking-api";
import type {
  CreateAbsenceRequest,
  UpdateSessionRequest,
} from "./time-tracking-api";
import type * as tt from "~/lib/contract/time-tracking.generated";

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  getSession: vi.fn(),
}));

vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

const mockGetSession = vi.mocked(getSession);

// Helper to create a mock fetch response
function mockFetchResponse(data: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  });
}

// Sample backend responses (snake_case, numeric IDs)
const backendSession = {
  id: "1",
  staff_id: "10",
  date: "2025-06-15T00:00:00Z",
  status: "present",
  check_in_time: "2025-06-15T08:00:00Z",
  check_out_time: null,
  break_minutes: 0,
  notes: "",
  auto_checked_out: false,
  created_by: "10",
  updated_by: null,
  created_at: "2025-06-15T08:00:00Z",
  updated_at: "2025-06-15T08:00:00Z",
};

const backendSessionWithCheckout = {
  ...backendSession,
  check_out_time: "2025-06-15T16:30:00Z",
  break_minutes: 30,
};

const backendBreak = {
  id: "5",
  session_id: "1",
  started_at: "2025-06-15T12:00:00Z",
  ended_at: "2025-06-15T12:30:00Z",
  duration_minutes: 30,
  created_at: "2025-06-15T12:00:00Z",
  updated_at: "2025-06-15T12:30:00Z",
};

const backendEdit = {
  id: "3",
  session_id: "1",
  staff_id: "10",
  edited_by: "99",
  field_name: "notes",
  old_value: null,
  new_value: "Updated",
  notes: "Changed notes",
  created_at: "2025-06-15T09:00:00Z",
};

const backendAbsence = {
  id: "7",
  staff_id: "10",
  absence_type: "sick",
  date_start: "2025-06-20T00:00:00Z",
  date_end: "2025-06-21T00:00:00Z",
  half_day: false,
  note: "Flu",
  status: "approved",
  approved_by: "99",
  approved_at: "2025-06-20T08:00:00Z",
  created_by: "10",
  created_at: "2025-06-20T07:00:00Z",
  updated_at: "2025-06-20T08:00:00Z",
  duration_days: 2,
};

describe("TimeTrackingService", () => {
  const unexpectedFetch = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    unexpectedFetch.mockImplementation(() => {
      throw new Error("Unexpected fetch: configure a mock for this test");
    });
    vi.stubGlobal("fetch", unexpectedFetch);
    mockGetSession.mockResolvedValue({
      user: { id: "1" },
      expires: "2025-12-31",
    } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Transport errors are normalized to 503, so throwing alone can pass.
    expect(unexpectedFetch).not.toHaveBeenCalled();
  });

  describe("checkIn", () => {
    it("sends POST with status and returns mapped session", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        message: "Checked in",
        data: backendSession,
      });

      const result = await timeTrackingService.checkIn("present");

      expect(global.fetch).toHaveBeenCalledWith("/api/time-tracking/check-in", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "present" }),
      });
      expect(result.id).toBe("1");
      expect(result.staffId).toBe("10");
      expect(result.status).toBe("present");
    });

    it("sends home_office status", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        message: "Checked in",
        data: backendSession,
      });

      await timeTrackingService.checkIn("home_office");

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/check-in",
        expect.objectContaining({
          body: JSON.stringify({ status: "home_office" }),
        }),
      );
    });

    it("throws on error response", async () => {
      global.fetch = mockFetchResponse(
        { detail: "Already checked in" },
        false,
        409,
      );

      await expect(timeTrackingService.checkIn("present")).rejects.toThrow(
        "Failed to check in",
      );
    });

    it("uses fallback error message when API error has no error field", async () => {
      global.fetch = mockFetchResponse({}, false, 500);

      await expect(timeTrackingService.checkIn("present")).rejects.toThrow(
        "Failed to check in",
      );
    });

    it("does not read a legacy message field as the diagnostic", async () => {
      global.fetch = mockFetchResponse({ message: "Server error" }, false, 500);

      await expect(timeTrackingService.checkIn("present")).rejects.toThrow(
        "Failed to check in",
      );
    });
  });

  describe("transport failures", () => {
    // A request that never reaches the API is "not reachable", with retry
    // (#2514), not a crash.
    it("reports a network failure as unavailable", async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError("Failed to fetch"));

      const failure = timeTrackingService.checkIn("present");
      await expect(failure).rejects.toBeInstanceOf(ApiError);
      await expect(failure).rejects.toMatchObject({
        code: "general.unavailable",
        status: 503,
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("reports a network failure of a void request as unavailable", async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError("Failed to fetch"));

      const failure = timeTrackingService.deleteAbsence("3");
      await expect(failure).rejects.toBeInstanceOf(ApiError);
      await expect(failure).rejects.toMatchObject({
        code: "general.unavailable",
        status: 503,
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("keeps the code and request ID of a refused stamp", async () => {
      global.fetch = mockFetchResponse(
        {
          detail: "already checked in",
          code: "general.business_rejection",
          instance: "req-stamp",
        },
        false,
        409,
      );

      await expect(
        timeTrackingService.checkIn("present"),
      ).rejects.toMatchObject({
        code: "general.business_rejection",
        status: 409,
        requestId: "req-stamp",
      });
    });
  });

  describe("checkOut", () => {
    it("sends POST and returns mapped session", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        message: "Checked out",
        data: backendSessionWithCheckout,
      });

      const result = await timeTrackingService.checkOut();

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/check-out",
        expect.objectContaining({ method: "POST" }),
      );
      expect(result.checkOutTime).toBe("2025-06-15T16:30:00Z");
      expect(result.breakMinutes).toBe(30);
    });

    it("throws on error", async () => {
      global.fetch = mockFetchResponse(
        { detail: "Not checked in" },
        false,
        400,
      );

      await expect(timeTrackingService.checkOut()).rejects.toThrow(
        "Failed to check out",
      );
    });
  });

  describe("getConfig", () => {
    it("returns the configured account start date", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        data: {
          account_start_date: "2026-06-01",
        },
      });

      const result = await timeTrackingService.getConfig();

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/config",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.accountStartDate).toBe("2026-06-01");
    });

    it("returns an empty account start date when backend config is unset", async () => {
      // Go sends the unset date as an empty string; the contract decodes it.
      global.fetch = mockFetchResponse({
        status: "success",
        data: { account_start_date: "" },
      });

      const result = await timeTrackingService.getConfig();

      expect(result.accountStartDate).toBe("");
    });
  });

  describe("getHolidays", () => {
    it("sends the date range and maps holidays by calendar date", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        data: [
          {
            date: "2026-12-25T00:00:00Z",
            name: "Erster Weihnachtsfeiertag",
          },
        ],
      });

      const result = await timeTrackingService.getHolidays(
        "2026-12-01",
        "2026-12-31",
      );

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/holidays?from=2026-12-01&to=2026-12-31",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toEqual(
        new Map([["2026-12-25", "Erster Weihnachtsfeiertag"]]),
      );
    });

    it("returns an empty map when the backend returns null", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        data: null,
      });

      await expect(
        timeTrackingService.getHolidays("2026-12-01", "2026-12-31"),
      ).resolves.toEqual(new Map());
    });
  });

  describe("getClosingDays", () => {
    it("sends the date range and expands ranges day-wise", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        data: [
          {
            start_date: "2026-12-24",
            end_date: "2026-12-26",
            reason: "Weihnachtsschließung",
          },
        ],
      });

      const result = await timeTrackingService.getClosingDays(
        "2026-12-01",
        "2026-12-31",
      );

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/closing-days?from=2026-12-01&to=2026-12-31",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toEqual(
        new Map([
          ["2026-12-24", "Weihnachtsschließung"],
          ["2026-12-25", "Weihnachtsschließung"],
          ["2026-12-26", "Weihnachtsschließung"],
        ]),
      );
    });

    it("returns an empty map when the backend returns null", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        data: null,
      });

      await expect(
        timeTrackingService.getClosingDays("2026-12-01", "2026-12-31"),
      ).resolves.toEqual(new Map());
    });

    it("maps the visible part of a stored range that starts over 400 days earlier", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        data: [
          {
            start_date: "2020-01-01",
            end_date: "2030-12-31",
            reason: "Langzeit-Schließung",
          },
        ],
      });

      const result = await timeTrackingService.getClosingDays(
        "2026-12-01",
        "2026-12-31",
      );

      expect(result.size).toBe(31);
      expect(result.get("2026-12-01")).toBe("Langzeit-Schließung");
      expect(result.get("2026-12-31")).toBe("Langzeit-Schließung");
    });
  });

  describe("updateSession", () => {
    it("sends PUT with updates and returns mapped session", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        message: "Updated",
        data: { ...backendSession, notes: "Updated notes" },
      });

      const updates: UpdateSessionRequest = {
        notes: "Updated notes",
        expectedVersion: "v1",
      };
      const result = await timeTrackingService.updateSession("1", updates);

      expect(global.fetch).toHaveBeenCalledWith("/api/time-tracking/1", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notes: "Updated notes",
          expected_version: "v1",
        }),
      });
      expect(result.notes).toBe("Updated notes");
    });
  });

  describe("startBreak", () => {
    it("sends POST and returns mapped break", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        message: "Break started",
        data: { ...backendBreak, ended_at: null, duration_minutes: 0 },
      });

      const result = await timeTrackingService.startBreak();

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/break/start",
        expect.objectContaining({ method: "POST" }),
      );
      expect(result.id).toBe("5");
      expect(result.sessionId).toBe("1");
      expect(result.endedAt).toBeNull();
    });

    it("sends planned duration for timed breaks", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        message: "Break started",
        data: { ...backendBreak, ended_at: null, duration_minutes: 0 },
      });

      await timeTrackingService.startBreak(90);

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/break/start",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ planned_duration_minutes: 90 }),
        }),
      );
    });
  });

  describe("endBreak", () => {
    it("sends POST and returns mapped session", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        message: "Break ended",
        data: { ...backendSession, break_minutes: 30 },
      });

      const result = await timeTrackingService.endBreak();

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/break/end",
        expect.objectContaining({ method: "POST" }),
      );
      expect(result.breakMinutes).toBe(30);
    });
  });

  describe("getSessionEdits", () => {
    it("returns mapped edits for a session", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        data: [backendEdit],
      });

      const result = await timeTrackingService.getSessionEdits("1");

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/1/edits",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.fieldName).toBe("notes");
      expect(result[0]!.editedBy).toBe("99");
    });

    it("handles null data gracefully", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        data: null,
      });

      const result = await timeTrackingService.getSessionEdits("1");
      expect(result).toEqual([]);
    });
  });

  describe("getAbsences", () => {
    it("sends date range and returns mapped absences", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        data: [backendAbsence],
      });

      const result = await timeTrackingService.getAbsences(
        "2025-06-01",
        "2025-06-30",
      );

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/absences?from=2025-06-01&to=2025-06-30",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.absenceType).toBe("sick");
      expect(result[0]!.durationDays).toBe(2);
      expect(result[0]!.dateStart).toBe("2025-06-20");
    });

    it("handles null data gracefully", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        data: null,
      });

      const result = await timeTrackingService.getAbsences(
        "2025-06-01",
        "2025-06-30",
      );
      expect(result).toEqual([]);
    });
  });

  describe("createAbsence", () => {
    it("sends POST with absence data and returns mapped absence", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        message: "Created",
        data: backendAbsence,
      });

      const req: CreateAbsenceRequest = {
        absence_type: "sick",
        date_start: "2025-06-20",
        date_end: "2025-06-21",
        note: "Flu",
      };
      const result = await timeTrackingService.createAbsence(req);

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/absences",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(req),
        }),
      );
      expect(result.id).toBe("7");
      expect(result.note).toBe("Flu");
    });
  });

  describe("updateAbsence", () => {
    it("sends PUT with updates and returns mapped absence", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        message: "Updated",
        data: { ...backendAbsence, note: "Severe flu" },
      });

      const req: tt.UpdateAbsenceRequest = { note: "Severe flu" };
      const result = await timeTrackingService.updateAbsence("7", req);

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/absences/7",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(req),
        }),
      );
      expect(result.note).toBe("Severe flu");
    });
  });

  describe("deleteAbsence", () => {
    it("sends DELETE request", async () => {
      global.fetch = mockFetchResponse(null, true, 204);

      await timeTrackingService.deleteAbsence("7");

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/absences/7",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("throws on error", async () => {
      global.fetch = mockFetchResponse({ detail: "Not found" }, false, 404);

      await expect(timeTrackingService.deleteAbsence("999")).rejects.toThrow(
        "Failed to delete absence",
      );
    });
  });

  describe("requestVacation", () => {
    it("sends vacation request data and returns the mapped absence", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        message: "Created",
        data: { ...backendAbsence, absence_type: "vacation" },
      });

      const result = await timeTrackingService.requestVacation({
        date_start: "2025-06-20",
        date_end: "2025-06-21",
        start_half_day: false,
        end_half_day: true,
        note: "Family",
        substitute_staff_id: "42",
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/vacation/request",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            date_start: "2025-06-20",
            date_end: "2025-06-21",
            start_half_day: false,
            end_half_day: true,
            note: "Family",
            substitute_staff_id: "42",
          }),
        }),
      );
      expect(result.absenceType).toBe("vacation");
    });
  });

  describe("cancelAbsence", () => {
    it("sends cancel request", async () => {
      global.fetch = mockFetchResponse(null, true, 204);

      await timeTrackingService.cancelAbsence("7");

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/absences/7/cancel",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("resubmitAbsence", () => {
    it("sends the amended note for another decision round", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        message: "Resubmitted",
        data: null,
      });

      await timeTrackingService.resubmitAbsence(
        "7",
        "Die Vertretung ist geklärt",
      );

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/time-tracking/absences/7/resubmit",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ note: "Die Vertretung ist geklärt" }),
        }),
      );
    });

    it("surfaces the backend error", async () => {
      global.fetch = mockFetchResponse(
        { detail: "Nur Rückfragen können erneut eingereicht werden" },
        false,
        409,
      );

      await expect(
        timeTrackingService.resubmitAbsence("7", "Antwort"),
      ).rejects.toThrow("Antrag konnte nicht erneut eingereicht werden");
    });
  });

  describe("authentication", () => {
    it("sends request without auth header when no session", async () => {
      mockGetSession.mockResolvedValue(null);
      global.fetch = mockFetchResponse({
        status: "success",
        data: [],
      });

      await timeTrackingService.getSessionEdits("123");

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, RequestInit];
      const headers = new Headers(callArgs[1].headers);
      expect(headers.get("Authorization")).toBeNull();
    });

    it("sends request without auth header when session has no token", async () => {
      mockGetSession.mockResolvedValue({
        user: {},
        expires: "2025-12-31",
      } as never);
      global.fetch = mockFetchResponse({
        status: "success",
        data: [],
      });

      await timeTrackingService.getSessionEdits("123");

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, RequestInit];
      const headers = new Headers(callArgs[1].headers);
      expect(headers.get("Authorization")).toBeNull();
    });
  });

  describe("request headers", () => {
    it("includes Content-Type for requests with body", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        data: backendSession,
      });

      await timeTrackingService.checkIn("present");

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, RequestInit];
      const headers = new Headers(callArgs[1].headers);
      expect(headers.get("Content-Type")).toBe("application/json");
    });

    it("omits Content-Type for GET requests", async () => {
      global.fetch = mockFetchResponse({
        status: "success",
        data: [],
      });

      await timeTrackingService.getSessionEdits("123");

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, RequestInit];
      const headers = new Headers(callArgs[1].headers);
      expect(headers.get("Content-Type")).toBeNull();
    });
  });
});
