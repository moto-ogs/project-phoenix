import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTraegerPlanningWeek } from "./traeger-planning-api";
import { fetchTraegerTimeAccount } from "./traeger-time-account-api";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify({ data: body }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const MINUTES = {
  target_minutes: 600,
  actual_minutes: 540,
  credited_minutes: 0,
  adjustment_minutes: 0,
  balance_minutes: -60,
  carry_in_minutes: 0,
  closing_balance_minutes: -60,
};

// The answers as the catalog proxy hands them on (ADR 0270).
const WEEK = {
  week_start: "2027-01-04",
  rules: {
    enabled: true,
    max_daily_minutes: 600,
    min_rest_minutes: 660,
    check_breaks: true,
  },
  schools: [{ id: "3", name: "OGS Süd" }],
  unreached: [],
  people: [
    {
      staff_record_id: "9",
      first_name: "Mira",
      last_name: "Sommer",
      sites: [{ school_id: "3", school_name: "OGS Süd", staff_id: "17" }],
      shifts: [],
      planned_minutes: 0,
      soll_minutes: null,
      soll_days: [{ school_id: "3", date: "2027-01-05", minutes: 240 }],
      absent_days: [],
      warnings: null,
    },
  ],
};

describe("Träger time account and planning read the decoded contract (#2353)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ADR 0270 point 6: a month state a newer backend adds is no known one, so
  // the card offers no month close for it.
  it("keeps a month state this build does not know apart", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...MINUTES,
        year: 2027,
        month: 1,
        state: "locked",
        ended: false,
        schools: [],
      }),
    );
    const account = await fetchTraegerTimeAccount("9", 2027, 1);
    expect(account.state).toBeUndefined();
  });

  it("reads a planning week with string IDs", async () => {
    fetchMock.mockResolvedValue(jsonResponse(WEEK));
    const week = await fetchTraegerPlanningWeek("2027-01-04");
    expect(week.people[0]).toMatchObject({
      recordId: "9",
      sites: [{ schoolId: "3", staffId: "17" }],
      sollDays: [{ schoolId: "3", date: "2027-01-05", minutes: 240 }],
      warnings: [],
    });
  });

  it("fails on a Soll day without its date", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...WEEK,
        people: [
          {
            ...WEEK.people[0],
            soll_days: [{ school_id: "3", date: null, minutes: 240 }],
          },
        ],
      }),
    );
    await expect(fetchTraegerPlanningWeek("2027-01-04")).rejects.toThrow(
      "contract: required day traeger_planning_soll_day.date is null",
    );
  });
});
