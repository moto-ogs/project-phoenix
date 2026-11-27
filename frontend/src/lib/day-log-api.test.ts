import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api-error";
import {
  DAY_LOG_STATUS_COLORS,
  DAY_LOG_STATUS_ORDER,
  dayLogSourceLabel,
  fetchDayLog,
  fetchDayLogExport,
  type DayLogResponse,
} from "./day-log-api";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const dayLogPayload: DayLogResponse = {
  date: "2026-07-24",
  groups: [
    {
      group_id: "7",
      name: "Igel",
      students: [
        {
          student_id: "42",
          first_name: "Mia",
          last_name: "Muster",
          school_class: "1a",
          status: "present",
          label: "Anwesend",
          check_in_time: "2026-07-24T06:58:00Z",
        },
      ],
      counters: {
        present: 1,
        sick: 0,
        class_trip: 0,
        excused: 0,
        absent: 0,
        not_scheduled: 0,
        total: 1,
      },
    },
  ],
  counters: {
    present: 1,
    sick: 0,
    class_trip: 0,
    excused: 0,
    absent: 0,
    not_scheduled: 0,
    total: 1,
  },
};

describe("fetchDayLog", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("fetches the day log for a date and unwraps the data envelope", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: dayLogPayload }));

    await expect(fetchDayLog("2026-07-24")).resolves.toEqual(dayLogPayload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/students/day-log?date=2026-07-24",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("fails the read for a status this build does not know", async () => {
    const group = dayLogPayload.groups[0]!;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          ...dayLogPayload,
          groups: [
            {
              ...group,
              students: [{ ...group.students[0]!, status: "teleported" }],
            },
          ],
        },
      }),
    );

    await expect(fetchDayLog("2026-07-24")).rejects.toThrow(
      "day log status has an unknown value",
    );
  });

  it("reads null lists as empty lists", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          ...dayLogPayload,
          groups: [{ ...dayLogPayload.groups[0]!, students: null }],
        },
      }),
    );

    await expect(fetchDayLog("2026-07-24")).resolves.toMatchObject({
      groups: [{ group_id: "7", students: [] }],
    });
  });

  it("carries the backend code, details, field errors and request ID", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          detail: "feature_disabled",
          code: "students.day_log_disabled",
          details: { setting: "day_log" },
          errors: [{ field: "date", reason: "unavailable" }],
          instance: "request-day-log-403",
        },
        { status: 403 },
      ),
    );

    const failure = fetchDayLog("2026-07-24");
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      code: "students.day_log_disabled",
      details: { setting: "day_log" },
      errors: [{ field: "date", reason: "unavailable" }],
      requestId: "request-day-log-403",
      // The diagnostic is retained separately and never shown to the user.
      message: "day log request failed",
      detail: "feature_disabled",
    });
  });

  it("reads the state codes, never the error text", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { detail: "no_permitted_groups", code: "students.day_log_no_groups" },
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(
        // A text alone no longer selects a state: it is the class code.
        jsonResponse({ detail: "feature_disabled" }, { status: 403 }),
      );

    await expect(fetchDayLog("2026-07-24")).rejects.toMatchObject({
      code: "students.day_log_no_groups",
    });
    await expect(fetchDayLog("2026-07-24")).rejects.toMatchObject({
      code: "general.permission",
    });
  });

  it("falls back to the class code for unrecognized error bodies", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "failed to load day log" }, { status: 500 }),
    );

    await expect(fetchDayLog("2026-07-24")).rejects.toMatchObject({
      code: "general.server",
    });
  });

  it("falls back to the class code for non-JSON error bodies", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>gateway timeout</html>", { status: 504 }),
    );

    await expect(fetchDayLog("2026-07-24")).rejects.toMatchObject({
      code: "general.unavailable",
      message: "day log request failed",
    });
  });

  it("turns a request that never reached the API into general.unavailable", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(fetchDayLog("2026-07-24")).rejects.toMatchObject({
      code: "general.unavailable",
    });
  });
});

describe("fetchDayLogExport", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response("file"));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the export for all groups", async () => {
    await fetchDayLogExport("2026-07-24", "pdf");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/students/day-log/export?date=2026-07-24&format=pdf",
    );
  });

  it("requests the export for one group", async () => {
    await fetchDayLogExport("2026-07-24", "xlsx", "7");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/students/day-log/export?date=2026-07-24&format=xlsx&group_id=7",
    );
  });

  it("requests the Word export the backend already accepts", async () => {
    await fetchDayLogExport("2026-07-24", "docx");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/students/day-log/export?date=2026-07-24&format=docx",
    );
  });
});

describe("dayLogSourceLabel", () => {
  it("labels parent-portal sign-offs", () => {
    expect(dayLogSourceLabel("parent")).toBe("Eltern-App");
  });

  it("labels cancelled care days", () => {
    expect(dayLogSourceLabel("care_plan_cancelled")).toBe(
      "Abmeldung im Betreuungsplan",
    );
  });

  it("stays empty for staff-entered or missing sources", () => {
    expect(dayLogSourceLabel("staff")).toBe("");
    expect(dayLogSourceLabel(undefined)).toBe("");
  });
});

describe("status metadata", () => {
  it("covers every status exactly once, unexplained absence last", () => {
    expect(DAY_LOG_STATUS_ORDER).toHaveLength(6);
    expect(new Set(DAY_LOG_STATUS_ORDER).size).toBe(6);
    expect(DAY_LOG_STATUS_ORDER.at(-1)).toBe("absent");
    for (const status of DAY_LOG_STATUS_ORDER) {
      expect(DAY_LOG_STATUS_COLORS[status]).toMatch(/^#/);
    }
  });
});
