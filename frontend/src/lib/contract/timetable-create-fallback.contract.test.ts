import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { mapInstance } from "~/lib/timetable-helpers";
import type { BackendEnrichedInstance } from "~/lib/timetable-types";
import { makeCatalogProxy } from "./catalog-proxy.server";
import { portalRoutes } from "./portals.generated";

/**
 * A created block whose enriched re-read failed (#2352): the backend answers
 * 201 in the registered answer type, with the block's own fields, the
 * warning and every enriched field empty. This is the body
 * `respondCreatedWithoutEnrichment` writes, as its Go test renders it.
 */
const createdWithoutEnrichment = {
  status: "success",
  data: {
    enrich_warning: "enrichment failed: read failed",
    id: "41",
    date: "2026-11-18",
    start_time: "13:30",
    end_time: "14:15",
    title: "Hausaufgaben",
    status: "planned",
    is_spontaneous: false,
    is_live: false,
    activity_type: "",
    room_id: "7",
    room_name: "",
    staff: [],
    student_ids: [],
    students: [],
    staff_count: 0,
    absent_staff_count: 0,
    understaffed_ack: false,
    expected_students_count: 0,
    present_students_count: 0,
    current_students_count: 0,
    not_scheduled_students_count: 0,
    required_staff_count: 0,
    assigned_staff_count: 0,
    conflict_warnings: null,
    can_complete: false,
    complete_available_at: "",
  },
  message: "Instance created (without enrichment)",
};

type Handler = (...args: unknown[]) => Promise<unknown>;

// Stands for the portal's handlers; makePortalHandlers has its own tests.
// The catalog proxy answers a Response, which the portal hands on as it is.
const withBody =
  (handler: Handler) =>
  async (request: NextRequest, context: { params: Promise<unknown> }) =>
    (await handler(
      request,
      await request.json(),
      "token",
      await context.params,
    )) as Response;

describe("POST /api/timetable/instances without enrichment", () => {
  it("reaches the client as the created block, not as a 502", async () => {
    const api = vi.fn().mockResolvedValue(createdWithoutEnrichment);
    const portal = { post: withBody, api } as unknown as Parameters<
      typeof makeCatalogProxy
    >[0];
    const request = new NextRequest(
      "http://schule.localhost/api/timetable/instances",
      { method: "POST", body: JSON.stringify({ title: "Hausaufgaben" }) },
    );

    const response = await makeCatalogProxy(
      portal,
      "/api",
      portalRoutes.tenant,
      "POST",
    )(request, {
      params: Promise.resolve({ path: ["timetable", "instances"] }),
    });

    expect(response.status).toBe(200);
    expect(api).toHaveBeenCalledWith(
      "POST",
      "/api/timetable/instances",
      "token",
      { title: "Hausaufgaben" },
      expect.anything(),
    );
    const { status, data } = (await response.json()) as {
      status: string;
      data: BackendEnrichedInstance;
    };
    expect(status).toBe("success");
    // The page shows the block with what was saved and nothing invented.
    expect(mapInstance(data)).toMatchObject({
      id: "41",
      date: "2026-11-18",
      startTime: "13:30",
      endTime: "14:15",
      title: "Hausaufgaben",
      status: "planned",
      roomId: "7",
      staff: [],
      studentIds: [],
    });
  });
});
