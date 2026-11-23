import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

import { ApiError } from "./api-error";
import {
  staffBalanceAdjustmentService,
  staffMonthCloseService,
} from "./staff-api";

const snapshot = {
  staff_id: "12",
  year: 2026,
  month: 6,
  closing_balance_minutes: 90,
  carry_in_minutes: 30,
  target_minutes: 7_200,
  actual_minutes: 7_260,
  credited_minutes: 0,
  adjustment_minutes: 0,
  closed_at: "2026-07-01T08:00:00Z",
  closed_by: "4",
  close_reason: "Lohnlauf",
  source: "manual",
};

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(data),
  } as Response;
}

function errorResponse(code: string, message = "backend error"): Response {
  return {
    ok: false,
    status: 409,
    text: () => Promise.resolve(JSON.stringify({ code, detail: message })),
  } as Response;
}

describe("staffMonthCloseService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and maps the school month-close status", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [snapshot] }))
      .mockResolvedValueOnce(jsonResponse({ data: null }));

    const result = await staffMonthCloseService.getStatus(2026, 6);
    const empty = await staffMonthCloseService.getStatus(2026, 5);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/staff/time-tracking/month-close?year=2026&month=6",
      { method: "GET" },
    );
    expect(result).toEqual([
      {
        staffId: "12",
        year: 2026,
        month: 6,
        closingBalanceMinutes: 90,
        closedAt: "2026-07-01T08:00:00Z",
        closedBy: "4",
        closeReason: "Lohnlauf",
        source: "manual",
      },
    ]);
    expect(empty).toEqual([]);
  });

  it("reports a failed status request", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      statusText: "Bad Gateway",
    } as Response);

    await expect(
      staffMonthCloseService.getStatus(2026, 6),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("closes a month with backend request keys and maps the result", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          year: 2026,
          month: 6,
          closed_staff: 19,
          skipped_staff: 2,
          snapshots: [snapshot],
        },
      }),
    );

    const result = await staffMonthCloseService.closeMonth({
      year: 2026,
      month: 6,
      reason: "Lohnlauf",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/staff/time-tracking/month-close",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: 2026,
          month: 6,
          reason: "Lohnlauf",
        }),
      },
    );
    expect(result).toEqual({
      year: 2026,
      month: 6,
      closedStaff: 19,
      skippedStaff: 2,
    });
  });

  // The catalog explains each code (#2514); the client keeps it intact and
  // leaves the backend sentence as diagnostics only.
  it.each([
    "workforce.month_not_closable",
    "workforce.later_month_closed",
    "unexpected_code",
  ])("keeps close error %s", async (code) => {
    fetchMock.mockResolvedValueOnce(errorResponse(code));

    const failure = staffMonthCloseService.closeMonth({
      year: 2026,
      month: 6,
      reason: "Lohnlauf",
    });
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      code,
      status: 409,
      message: "Monatsabschluss fehlgeschlagen",
      detail: "backend error",
    });
  });

  it("reopens one staff month with backend request keys", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
    } as Response);

    await staffMonthCloseService.reopenMonth("12", {
      year: 2026,
      month: 6,
      reason: "Fehlende Schicht",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/staff/12/time-tracking/month-close/reopen",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: 2026,
          month: 6,
          reason: "Fehlende Schicht",
        }),
      },
    );
  });

  it.each([
    "workforce.month_not_closed",
    "workforce.later_month_closed",
    "unexpected_code",
  ])("keeps reopen error %s", async (code) => {
    fetchMock.mockResolvedValueOnce(errorResponse(code));

    const failure = staffMonthCloseService.reopenMonth("12", {
      year: 2026,
      month: 6,
      reason: "Fehlende Schicht",
    });
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ code, status: 409 });
  });
});

describe("staffBalanceAdjustmentService closed-month errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the closed-month code of a rejected adjustment", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse("workforce.adjustment_in_closed_month"),
    );

    await expect(
      staffBalanceAdjustmentService.create("12", {
        type: "payout",
        minutesDelta: -60,
        effectiveDate: "2026-06-30",
        note: "Korrektur",
      }),
    ).rejects.toMatchObject({
      code: "workforce.adjustment_in_closed_month",
      status: 409,
    });
  });

  it("keeps the closed-month code of a rejected reset", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse("workforce.adjustment_in_closed_month"),
    );

    await expect(
      staffBalanceAdjustmentService.reset("12", {
        effectiveDate: "2026-06-30",
        carryoverMinutes: 0,
        note: "Korrektur",
      }),
    ).rejects.toMatchObject({
      code: "workforce.adjustment_in_closed_month",
      status: 409,
    });
  });

  it("keeps the closed-month code of a rejected deletion", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse("workforce.adjustment_in_closed_month"),
    );

    await expect(
      staffBalanceAdjustmentService.delete("12", "17"),
    ).rejects.toMatchObject({
      code: "workforce.adjustment_in_closed_month",
      status: 409,
    });
  });
});
