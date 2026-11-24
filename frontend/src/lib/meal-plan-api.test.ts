import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

import {
  getMealPlanWeek,
  getWeeklyMealParticipants,
  setDay,
  mondayOf,
  workWeekDates,
} from "./meal-plan-api";
vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

const fetchMock: Mock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("getWeeklyMealParticipants", () => {
  it("requests the week and maps each day's children", async () => {
    let seenURL = "";
    fetchMock.mockImplementation(async (url: string) => {
      seenURL = url;
      return jsonResponse({
        data: {
          week_start: "2026-09-07",
          cutoff_time: "09:00",
          cutoff_lead_days: 1,
          days: [
            {
              date: "2026-09-07",
              closed: false,
              participants: [
                {
                  student_id: "42",
                  first_name: "Mia",
                  last_name: "Muster",
                  school_class: "2a",
                },
              ],
            },
            { date: "2026-09-08", closed: true, participants: [] },
          ],
        },
      });
    });

    const week = await getWeeklyMealParticipants("2026-09-09");
    expect(seenURL).toBe(
      "/api/meal-plan/participants/week?week_start=2026-09-09",
    );
    expect(week).toEqual({
      weekStart: "2026-09-07",
      days: [
        {
          date: "2026-09-07",
          closed: false,
          participants: [
            {
              studentId: "42",
              firstName: "Mia",
              lastName: "Muster",
              schoolClass: "2a",
            },
          ],
        },
        { date: "2026-09-08", closed: true, participants: [] },
      ],
    });
  });
});

describe("getMealPlanWeek", () => {
  it("requests the days and maps their versions and dishes, trimming empty notes to null", async () => {
    let seenURL = "";
    fetchMock.mockImplementation(async (url: string) => {
      seenURL = url;
      return jsonResponse({
        data: [
          {
            date: "2026-07-06",
            version: "v-mon",
            dishes: [
              { dish: "Nudeln", note: "  vegetarisch  " },
              { dish: "Salat", note: "   " },
            ],
          },
          {
            date: "2026-07-07",
            version: "v-tue",
            dishes: [{ dish: "Suppe" }],
          },
          { date: "2026-07-08", version: "v-wed", dishes: null },
        ],
      });
    });

    const out = await getMealPlanWeek("2026-07-06");
    expect(seenURL).toContain("/api/meal-plan/days?week_start=2026-07-06");
    expect(out.map((day) => day.version)).toEqual(["v-mon", "v-tue", "v-wed"]);
    // A note with content is preserved verbatim (untrimmed value kept).
    expect(out[0]?.dishes[0]?.note).toBe("  vegetarisch  ");
    // A whitespace-only note collapses to null.
    expect(out[0]?.dishes[1]?.note).toBeNull();
    // A missing note stays null.
    expect(out[1]?.dishes[0]?.note).toBeNull();
    // An empty day has no dishes, but its version.
    expect(out[2]?.dishes).toEqual([]);
  });

  it("throws an ApiError with the status class on a non-OK response", async () => {
    fetchMock.mockResolvedValue(
      new Response("boom", { status: 500, statusText: "Server Error" }),
    );
    await expect(getMealPlanWeek("2026-07-06")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      code: "general.server",
    });
  });

  it("URL-encodes the week start", async () => {
    let seenURL = "";
    fetchMock.mockImplementation(async (url: string) => {
      seenURL = url;
      return jsonResponse({ data: [] });
    });
    await getMealPlanWeek("2026 07 06");
    expect(seenURL).toContain("week_start=2026+07+06");
  });
});

describe("setDay", () => {
  it("PUTs the day with the dishes and the version as read, and answers the stored day", async () => {
    let seenURL = "";
    let seenInit: RequestInit | undefined;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      seenURL = url;
      seenInit = init;
      return jsonResponse({
        status: "success",
        data: {
          date: "2026-07-06",
          version: "v-saved",
          dishes: [{ dish: "Nudeln", note: "vegetarisch", allergens: [] }],
        },
      });
    });

    const saved = await setDay(
      "2026-07-06",
      [{ dish: "Nudeln", note: "vegetarisch" }],
      "v-read",
    );
    expect(seenURL).toContain("/api/meal-plan/days/2026-07-06");
    expect(seenInit?.method).toBe("PUT");
    expect(JSON.parse(seenInit?.body as string)).toEqual({
      dishes: [{ dish: "Nudeln", note: "vegetarisch" }],
      expected_version: "v-read",
    });
    expect(saved.version).toBe("v-saved");
  });

  it("keeps code, field errors and request id of a refused save", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "meals.invalid_dishes",
          errors: [{ field: "dishes", reason: "invalid" }],
          instance: "req-1",
        }),
        { status: 400, statusText: "Bad Request" },
      ),
    );
    await expect(setDay("2026-07-06", [], "v-read")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: "meals.invalid_dishes",
      errors: [{ field: "dishes", reason: "invalid" }],
      requestId: "req-1",
    });
  });
});

describe("mondayOf", () => {
  it("returns the ISO Monday for any weekday", () => {
    // 2026-07-08 is a Wednesday → Monday is 2026-07-06.
    expect(mondayOf(new Date(2026, 6, 8))).toBe("2026-07-06");
    // Monday maps to itself.
    expect(mondayOf(new Date(2026, 6, 6))).toBe("2026-07-06");
    // Sunday belongs to the week that started the previous Monday.
    expect(mondayOf(new Date(2026, 6, 12))).toBe("2026-07-06");
  });
});

describe("workWeekDates", () => {
  it("expands a Monday into the five Mon-Fri ISO dates", () => {
    expect(workWeekDates("2026-07-06")).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
    ]);
  });
});
