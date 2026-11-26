import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideHolidayAllocation,
  fetchHolidayAllocation,
  fetchHolidayCriteria,
  saveHolidayCriteria,
} from "./traeger-holiday-allocation-api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// The decoded answer of the catalog proxy: identifiers arrive as strings.
const BACKEND_BOARD = {
  allocation_mode: "criteria",
  ranking: "points",
  max_score: 3,
  criteria: [
    {
      id: "1",
      name: "Beide Eltern berufstätig",
      scope: "family",
      position: 1,
      points: 3,
    },
  ],
  weeks: [
    {
      week_id: "51",
      starts_on: "2027-07-05",
      ends_on: "2027-07-09",
      host_school_id: "31",
      booking_unit: "week",
      capacity: 2,
      placed: 1,
      free: 1,
      pending: [
        {
          booking_id: "100",
          rank: 1,
          registration_id: "7",
          submitted_at: "2026-09-01T08:00:00Z",
          child_id: "9",
          child_first_name: "Mia",
          child_last_name: "Muster",
          time_model_name: "bis 13 Uhr",
          days: null,
          criteria: [{ criterion_id: "1", value: "unknown", source: "parent" }],
          score: 0,
          proposal: "placed",
        },
      ],
    },
  ],
  decisions: [
    {
      id: "3",
      week_id: "51",
      week_starts_on: "2027-07-05",
      week_ends_on: "2027-07-09",
      registration_id: "8",
      child_id: "10",
      child_first_name: "Ben",
      child_last_name: "Beispiel",
      placement: "placed",
      proposal: "waitlisted",
      rank: 2,
      criteria_met: null,
      reason: "Härtefall",
      decided_at: "2026-09-02T08:00:00Z",
      decided_by_account_id: "4",
      ranking: "points",
      score: 3,
      max_score: 5,
    },
  ],
};

describe("traeger holiday allocation api (#4700)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("maps the allocation list with IDs as strings", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: BACKEND_BOARD }));
    const board = await fetchHolidayAllocation("5");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/traeger/holiday-periods/5/allocation",
    );
    expect(board.weeks[0]?.pending[0]).toEqual({
      bookingId: "100",
      rank: 1,
      registrationId: "7",
      submittedAt: "2026-09-01T08:00:00Z",
      childId: "9",
      childFirstName: "Mia",
      childLastName: "Muster",
      timeModelName: "bis 13 Uhr",
      days: [],
      criteria: [{ criterionId: "1", value: "unknown", source: "parent" }],
      score: 0,
      proposal: "placed",
    });
    // How the criteria count, for the explanation of the order (#8135).
    expect(board.ranking).toBe("points");
    expect(board.maxScore).toBe(3);
    expect(board.criteria[0]?.points).toBe(3);
    expect(board.decisions[0]).toMatchObject({
      id: "3",
      placement: "placed",
      proposal: "waitlisted",
      criteriaMet: [],
      reason: "Härtefall",
      ranking: "points",
      score: 3,
      maxScore: 5,
    });
  });

  it("sends decisions and criteria with string IDs", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: BACKEND_BOARD }));
    await decideHolidayAllocation("5", [
      {
        bookingId: "100",
        placement: "waitlisted",
        proposal: "placed",
        reason: "Grund",
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/traeger/holiday-periods/5/allocation/decisions");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      decisions: [
        {
          booking_id: "100",
          placement: "waitlisted",
          proposal: "placed",
          reason: "Grund",
        },
      ],
    });

    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: { criteria: [], ranking: "equal", version: "saved" },
      }),
    );
    await saveHolidayCriteria(
      [
        {
          id: "",
          name: "Neu",
          question: "Trifft das zu?",
          scope: "child",
          active: true,
          points: 1,
        },
        {
          id: "4",
          name: "Alt",
          question: "Und das?",
          scope: "family",
          active: false,
          points: 5,
        },
      ],
      "equal",
      "criteria-read",
    );
    const [, saveInit] = fetchMock.mock.calls[1]!;
    expect(saveInit?.method).toBe("PUT");
    expect(JSON.parse(String(saveInit?.body))).toEqual({
      expected_version: "criteria-read",
      ranking: "equal",
      criteria: [
        {
          id: "0",
          name: "Neu",
          question: "Trifft das zu?",
          scope: "child",
          active: true,
          points: 1,
        },
        {
          id: "4",
          name: "Alt",
          question: "Und das?",
          scope: "family",
          active: false,
          points: 5,
        },
      ],
    });
  });

  // Open enums of the contract (#2353).
  it("fails the criteria read on a scope this build does not know", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          criteria: [
            {
              id: "1",
              name: "Neu",
              question: "Trifft das zu?",
              scope: "school",
              active: true,
              position: 1,
              points: 1,
              answered: false,
            },
          ],
          periods: [],
          ranking: "priority",
        },
      }),
    );
    // The editor saves the whole list and archives a criterion left out:
    // neither dropping nor guessing the scope is safe.
    await expect(fetchHolidayCriteria()).rejects.toThrow(
      "holiday_criterion.scope",
    );
  });

  it("fails a read whose way of counting this build does not know", async () => {
    // The editor saves the ranking back and the list explains its order
    // with it: a guessed one would do either wrongly.
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: { criteria: [], periods: [], ranking: "lottery", version: "v" },
      }),
    );
    await expect(fetchHolidayCriteria()).rejects.toThrow(
      "holiday_criteria.ranking",
    );
    fetchMock.mockResolvedValue(
      jsonResponse(200, { data: { ...BACKEND_BOARD, ranking: "lottery" } }),
    );
    await expect(fetchHolidayAllocation("5")).rejects.toThrow(
      "holiday_allocation.ranking",
    );
  });

  it("shows a decision from before the ways of counting without a score", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          ...BACKEND_BOARD,
          decisions: [
            {
              ...BACKEND_BOARD.decisions[0],
              ranking: "priority",
              score: null,
              max_score: null,
            },
          ],
        },
      }),
    );
    const board = await fetchHolidayAllocation("5");
    expect(board.decisions[0]).toMatchObject({
      ranking: "priority",
      score: null,
      maxScore: null,
    });
  });

  it("leaves out an open booking with a proposal this build does not know", async () => {
    const week = BACKEND_BOARD.weeks[0]!;
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          ...BACKEND_BOARD,
          weeks: [
            {
              ...week,
              pending: [
                week.pending[0],
                { ...week.pending[0], booking_id: "101", proposal: "lottery" },
              ],
            },
          ],
        },
      }),
    );
    const board = await fetchHolidayAllocation("5");
    expect(board.weeks[0]?.pending.map((entry) => entry.bookingId)).toEqual([
      "100",
    ]);
  });
});
