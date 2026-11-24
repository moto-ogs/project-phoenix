import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

import { ApiError } from "./api-error";
import { testClockDay } from "~/test/clock";
import {
  bulkApproveParentRequests,
  fetchPendingEnrollmentChangeRequestCount,
  getFamilyProtection,
  listAggregatedOpenRequests,
  listAggregatedRequestHistory,
  listEnrollmentChangeRequests,
  markRequestDone,
} from "./change-request-list-api";

describe("change request list API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const masterData = {
    id: "5",
    student_id: "42",
    first_name: "Emma",
    last_name: "Beispiel",
    target: "student",
    field_key: "phone",
    new_value: "0123",
    status: "pending",
    created_at: "2026-09-01T08:00:00Z",
  };
  const openItem = {
    request_type: "master_data",
    occurred_at: "2026-09-01T08:00:00Z",
    student_id: "42",
    student_name: "Emma Beispiel",
    expected_version: "v1",
    urgent_today: false,
    past: false,
    bulk_eligible: true,
    family_protected: false,
    data: null,
    master_data: masterData,
  };
  const answer = (items: unknown[]) =>
    new Response(JSON.stringify({ data: { items } }), { status: 200 });

  it("puts each row's projection of its kind under data (#7882)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(answer([openItem]));

    const page = await listAggregatedOpenRequests();

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      request_type: "master_data",
      student_name: "Emma Beispiel",
      expected_version: "v1",
      data: masterData,
    });
    expect(page.items[0]).not.toHaveProperty("master_data");
  });

  it("reads a correction's missing diff in the history as an empty list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer([
        {
          request_type: "direct_correction",
          occurred_at: "2026-09-02T08:00:00Z",
          student_id: "42",
          student_name: "Emma Beispiel",
          expected_version: "v2",
          family_protected: false,
          direct_correction: {
            id: "9",
            student_id: "42",
            student_name: "Emma Beispiel",
            changed_at: "2026-09-02T08:00:00Z",
            changed_by_name: "Frau Admin",
            reason: "Korrektur",
            diff: null,
          },
        },
      ]),
    );

    const page = await listAggregatedRequestHistory();

    expect(page.items[0]).toMatchObject({
      request_type: "direct_correction",
      data: { id: "9", diff: [] },
    });
  });

  it.each([
    ["excused", "done"],
    ["excused", "care_ended"],
    ["offering", "done"],
    ["offering", "care_ended"],
    ["master_data", "care_ended"],
  ] as const)(
    "loads %s history with terminal status %s",
    async (kind, status) => {
      const common = {
        id: "5",
        student_id: "42",
        created_at: masterData.created_at,
        decided_at: masterData.created_at,
        status,
      };
      const projections = {
        master_data: { ...masterData, ...common },
        excused: {
          ...common,
          first_name: "Emma",
          last_name: "Beispiel",
          absence_status: "excused",
          dates: [testClockDay()],
          note: "",
        },
        offering: {
          ...common,
          student_name: "Emma Beispiel",
          effective_from: testClockDay(),
          diff: [],
        },
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        answer([
          {
            request_type: kind,
            occurred_at: common.decided_at,
            [kind]: projections[kind],
          },
        ]),
      );

      const page = await listAggregatedRequestHistory();

      expect(page.items).toMatchObject([
        { request_type: kind, data: projections[kind] },
      ]);
    },
  );

  it("fails the load on a status this build does not know", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer([{ ...openItem, master_data: { ...masterData, status: "new" } }]),
    );

    await expect(listAggregatedOpenRequests()).rejects.toThrow(
      "status has an unknown value",
    );
  });

  it("fails the load on a row without the projection of its kind", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      answer([{ ...openItem, master_data: undefined }]),
    );

    await expect(listAggregatedOpenRequests()).rejects.toThrow(
      "change request row without its master_data",
    );
  });

  it("loads open requests with trimmed search and type filters", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { items: [] } }), { status: 200 }),
      );

    await expect(
      listAggregatedOpenRequests({
        search: "  Emma  ",
        types: ["master_data", "excused"],
      }),
    ).resolves.toEqual({ items: [] });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/students/change-requests?search=Emma&types=master_data%2Cexcused",
      { method: "GET" },
    );
  });

  it("loads history with status, date, and cursor filters", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { items: [], next_cursor: "next" } }),
        {
          status: 200,
        },
      ),
    );

    await expect(
      listAggregatedRequestHistory({
        statuses: ["approved"],
        from: "2026-08-01",
        to: "2026-08-19",
        cursor: "current",
      }),
    ).resolves.toEqual({ items: [], next_cursor: "next" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/students/change-requests/history?status=approved&from=2026-08-01&to=2026-08-19&cursor=current",
      { method: "GET" },
    );
  });

  it("scopes the history to one child via the student filter", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { items: [] } }), { status: 200 }),
      );

    await expect(
      listAggregatedRequestHistory({ studentId: "42" }),
    ).resolves.toEqual({ items: [] });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/students/change-requests/history?student_id=42",
      { method: "GET" },
    );
  });

  it("throws an ApiError with the wire code when loading fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "absence read required",
          code: "students.absence_read_required",
          instance: "req-403",
        }),
        { status: 403 },
      ),
    );

    const error = await listAggregatedOpenRequests().catch((err) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      code: "students.absence_read_required",
      requestId: "req-403",
    });
  });

  it("keeps the status class when the error body carries no code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 500 }),
    );

    await expect(listAggregatedOpenRequests()).rejects.toMatchObject({
      status: 500,
      code: "general.server",
    });
  });

  it("classifies non-JSON failures by status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream error", { status: 502 }),
    );

    await expect(listAggregatedRequestHistory()).rejects.toMatchObject({
      status: 502,
      code: "general.unavailable",
    });
  });

  it("keeps the stale code of a write that lost the race", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "general.changed_since_read" }), {
        status: 409,
      }),
    );

    const error = (await markRequestDone("excused", "7", "v1").catch(
      (err: unknown) => err,
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("general.changed_since_read");
  });

  it("keeps the code of any other failed write", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ code: "students.bulk_approval_ineligible" }),
        { status: 409 },
      ),
    );

    await expect(
      bulkApproveParentRequests(
        [{ kind: "excused", id: "1", expected_version: "v" }],
        "",
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "students.bulk_approval_ineligible",
    });
  });

  it("throws an ApiError when the family protection cannot be loaded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 503 }),
    );

    await expect(getFamilyProtection("5")).rejects.toMatchObject({
      status: 503,
      code: "general.unavailable",
    });
  });
});

describe("pending enrollment change request count", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the count from the envelope", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { pending_count: 3 } }), {
        status: 200,
      }),
    );

    await expect(fetchPendingEnrollmentChangeRequestCount()).resolves.toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/enrollment/admin/change-requests/pending-count",
      { method: "GET" },
    );
  });

  it("falls back to 0 when the envelope has no data at all", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await expect(fetchPendingEnrollmentChangeRequestCount()).resolves.toBe(0);
  });

  it("falls back to 0 on an error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 403 }),
    );

    await expect(fetchPendingEnrollmentChangeRequestCount()).resolves.toBe(0);
  });

  it("falls back to 0 when the request itself fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await expect(fetchPendingEnrollmentChangeRequestCount()).resolves.toBe(0);
  });
});

describe("enrollment change request list", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("drops the type filter and keeps the remaining filters", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { items: [], next_cursor: "next" } }),
          { status: 200 },
        ),
      );

    await expect(
      listEnrollmentChangeRequests("history", {
        types: ["enrollment"],
        search: "  Mia  ",
        statuses: ["approved", "rejected"],
        from: "2026-08-01",
        to: "2026-08-19",
        cursor: "current",
      }),
    ).resolves.toEqual({ items: [], next_cursor: "next" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/enrollment/admin/change-requests/list?view=history&search=Mia&status=approved%2Crejected&from=2026-08-01&to=2026-08-19&cursor=current",
      { method: "GET" },
    );
  });

  it("omits empty filters on the open view", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { items: [] } }), { status: 200 }),
      );

    await expect(listEnrollmentChangeRequests("open")).resolves.toEqual({
      items: [],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/enrollment/admin/change-requests/list?view=open",
      { method: "GET" },
    );
  });

  it("ignores a blank search and empty filter arrays", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { items: [] } }), { status: 200 }),
      );

    await listEnrollmentChangeRequests("open", {
      search: "   ",
      types: [],
      statuses: [],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/enrollment/admin/change-requests/list?view=open",
      { method: "GET" },
    );
  });

  it("drops the student filter, which this endpoint does not know", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { items: [] } }), { status: 200 }),
      );

    await listEnrollmentChangeRequests("open", {
      studentId: "42",
      search: "Mia",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/enrollment/admin/change-requests/list?view=open&search=Mia",
      { method: "GET" },
    );
  });

  it("throws an ApiError when the list fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 }),
    );

    const error = await listEnrollmentChangeRequests("open").catch(
      (err) => err,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("general.server");
  });
});
