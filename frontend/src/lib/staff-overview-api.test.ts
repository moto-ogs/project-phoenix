import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  mapDashboardSummary,
  mapTimeAccountRow,
  staffOverviewService,
} from "./staff-overview-api";
import { routes } from "./contract/staff.generated";
import type * as staffContract from "./contract/staff.generated";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve({ data }),
  } as unknown as Response;
}

const summaryFixture: staffContract.DashboardSummary = {
  active_staff_count: 18,
  sick_today: 2,
  vacation_today: 1,
  currently_clocked_in: 12,
  expected_clocked_in: 15,
  period: { soll_minutes: 9600, ist_minutes: 9000, delta_minutes: -120 },
  saldo_school_total_minutes: 1440,
  pending_requests_count: 3,
};

describe("mapDashboardSummary", () => {
  it("flattens the period block without recomputing the delta", () => {
    const mapped = mapDashboardSummary(summaryFixture);

    expect(mapped.sollMinutes).toBe(9600);
    expect(mapped.istMinutes).toBe(9000);
    // The backend delta credits sick and vacation days, so it is NOT
    // ist − soll (that would be −600 here). Recomputing it in the frontend is
    // exactly the drift this tranche exists to prevent.
    expect(mapped.deltaMinutes).toBe(-120);
    expect(mapped.deltaMinutes).not.toBe(
      summaryFixture.period.ist_minutes - summaryFixture.period.soll_minutes,
    );
    expect(mapped.saldoSchoolTotalMinutes).toBe(1440);
  });
});

describe("mapTimeAccountRow", () => {
  it("reads the int64 staff id the proxy decoded as a string", () => {
    // Go sends the id as a string; the catalog proxy hands it on unchanged.
    const decoded = routes[
      "GET /api/staff/time-tracking/overview"
    ].response.parse({
      status: "success",
      data: {
        year: 2026,
        month: 9,
        rows: [
          {
            staff_id: "42",
            first_name: "Anna",
            last_name: "Müller",
            name: "Anna Müller",
            employment_type: "part_time",
            soll_minutes: 600,
            has_target: false,
            ist_minutes: 660,
            balance_minutes: 60,
            remaining_vacation_days: 12.5,
            labor_hint_days: 0,
          },
        ],
      },
    });
    const row = decoded.data.rows?.[0];
    if (!row) throw new Error("decoded row missing");

    expect(mapTimeAccountRow(row).staffId).toBe("42");
    expect(mapTimeAccountRow(row).remainingVacationDays).toBe(12.5);
    expect(mapTimeAccountRow(row).hasTarget).toBe(false);
  });
});

describe("staffOverviewService", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requests the selected period", async () => {
    fetchMock.mockResolvedValue(jsonResponse(summaryFixture));

    await staffOverviewService.getDashboardSummary("week");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/staff/dashboard-summary?period=week",
      { method: "GET" },
    );
  });

  it.each([{ year: 2026 }, { month: 7 }])(
    "rejects a partial year/month query: %o",
    async (query) => {
      await expect(staffOverviewService.getTimeAccounts(query)).rejects.toThrow(
        "Jahr und Monat müssen gemeinsam angegeben werden",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("omits year/month when neither is given", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ year: 2026, month: 7, rows: [] }),
    );

    await staffOverviewService.getTimeAccounts();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/staff/time-tracking/overview",
      { method: "GET" },
    );
  });

  it("forwards month, employment type and saldo bounds", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ year: 2026, month: 6, rows: [] }),
    );

    await staffOverviewService.getTimeAccounts({
      year: 2026,
      month: 6,
      employmentType: "part_time",
      saldoMin: -600,
      saldoMax: 600,
    });

    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("year=2026");
    expect(url).toContain("month=6");
    expect(url).toContain("employment_type=part_time");
    expect(url).toContain("saldo_min=-600");
    expect(url).toContain("saldo_max=600");
  });

  it("sends saldo_min=0 rather than dropping a zero bound", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ year: 2026, month: 7, rows: [] }),
    );

    await staffOverviewService.getTimeAccounts({ saldoMin: 0 });

    expect(fetchMock.mock.calls[0]?.[0]).toContain("saldo_min=0");
  });

  it("survives a null rows array", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ year: 2026, month: 7, rows: null }),
    );

    await expect(staffOverviewService.getTimeAccounts()).resolves.toMatchObject(
      {
        rows: [],
      },
    );
  });

  it("throws a German message on a failed response", async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response);

    await expect(staffOverviewService.getTimeAccounts()).rejects.toThrow(
      "Zeitkonten konnten nicht geladen werden",
    );
  });
});
