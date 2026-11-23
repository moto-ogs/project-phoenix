import { beforeEach, describe, expect, it, vi } from "vitest";
import { plainFetch } from "~/test/mocks/plain-session-fetch";

vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

global.fetch = vi.fn(plainFetch(mockFetch)) as unknown as typeof fetch;

import {
  caregiverCapabilityService,
  CaregiverCapabilityApiError,
} from "./caregiver-capability-api";

const backendState = {
  account_id: "42",
  email: "caregiver@example.com",
  first_name: "Ada",
  last_name: "Lovelace",
  person_id: "101",
  staff_id: "202",
  teacher_id: "303",
  has_admin_role: true,
  has_user_role: true,
  has_person: true,
  has_staff: true,
  has_teacher: true,
  has_caregiver_profile: true,
  is_active_caregiver: true,
  disable_blocked: true,
  disable_blockers: ["active_group_supervisions", "group_assignments"],
  active_supervisions: [
    { id: "1", group_name: "Gruppe Blau", start_date: "2026-04-05" },
  ],
  active_substitutions: [
    {
      id: "2",
      group_name: "Gruppe Rot",
      start_date: "2026-04-05",
      end_date: "2026-04-06",
    },
  ],
  activity_supervisions: [
    {
      id: "3",
      activity_id: "4",
      activity_name: "Theater",
      is_primary: true,
    },
  ],
  group_assignments: [
    {
      id: "5",
      group_id: "6",
      group_name: "Gruppe Gelb",
      teacher_id: "7",
      teacher_ids: ["7", "8"],
    },
  ],
};

describe("caregiverCapabilityService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps wrapped tenant capability responses into frontend shape", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: backendState }),
    });

    const result =
      await caregiverCapabilityService.getTenantAccountCapability("42/unsafe");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/auth/accounts/42%2Funsafe/caregiver-capability",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toMatchObject({
      accountId: "42",
      personId: "101",
      staffId: "202",
      teacherId: "303",
      hasAdminRole: true,
      hasUserRole: true,
      disableBlocked: true,
      disableBlockers: ["1 aktive Gruppenaufsicht", "1 Stammgruppen-Zuordnung"],
    });
    expect(result.activeSupervisions).toEqual([
      { id: "1", groupName: "Gruppe Blau", startDate: "2026-04-05" },
    ]);
    expect(result.groupAssignments).toEqual([
      {
        id: "5",
        groupId: "6",
        groupName: "Gruppe Gelb",
        teacherId: "7",
        teacherIds: ["7", "8"],
      },
    ]);
  });

  it("posts operator enable requests with a JSON body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: backendState }),
    });

    await caregiverCapabilityService.enableOperatorAccountCapability(
      "10",
      "55",
      {
        first_name: "Ada",
        last_name: "Lovelace",
        position: "Betreuungskraft",
      },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/operator/schools/10/accounts/55/caregiver-capability",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          first_name: "Ada",
          last_name: "Lovelace",
          position: "Betreuungskraft",
        }),
      }),
    );
  });

  it("throws parsed blocker details on API errors", async () => {
    const problem = {
      status: "error",
      code: "general.business_rejection",
      detail: "Betreuung kann nicht deaktiviert werden",
      details: { count: 1 },
      errors: [{ field: "account_id", reason: "blocked" }],
      instance: "capability-request",
      blockers: ["active_group_supervisions"],
    };
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      headers: new Headers({ "Retry-After": "30" }),
      json: async () => problem,
    });

    await expect(
      caregiverCapabilityService.disableTenantAccountCapability("42"),
    ).rejects.toMatchObject({
      name: "CaregiverCapabilityApiError",
      message: "Betreuung kann nicht deaktiviert werden",
      status: 409,
      code: problem.code,
      detail: problem.detail,
      details: problem.details,
      errors: problem.errors,
      instance: problem.instance,
      requestId: problem.instance,
      retryAfterSeconds: 30,
      problem,
      blockers: ["Aktive Gruppenaufsichten"],
    });
  });

  it.each([
    ["tenant", "POST", "not JSON"],
    ["tenant", "DELETE", JSON.stringify({ status: "success" })],
    ["operator", "POST", JSON.stringify({ status: "success" })],
    ["operator", "DELETE", "not JSON"],
  ])(
    "preserves the reload-only error for %s %s with an unreadable answer",
    async (scope, method, body) => {
      mockFetch.mockResolvedValue(new Response(body, { status: 200 }));

      const request =
        scope === "tenant"
          ? method === "POST"
            ? caregiverCapabilityService.enableTenantAccountCapability("42", {})
            : caregiverCapabilityService.disableTenantAccountCapability("42")
          : method === "POST"
            ? caregiverCapabilityService.enableOperatorAccountCapability(
                "10",
                "42",
                {},
              )
            : caregiverCapabilityService.disableOperatorAccountCapability(
                "10",
                "42",
              );

      await expect(request).rejects.toMatchObject({
        name: "CaregiverCapabilityApiError",
        status: 502,
        code: "general.write_answer_unreadable",
        blockers: [],
      });
    },
  );

  it("preserves the no-response marker on a network failure", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      caregiverCapabilityService.disableTenantAccountCapability("42"),
    ).rejects.toMatchObject({
      name: "CaregiverCapabilityApiError",
      status: 503,
      code: "general.unavailable",
      noResponse: true,
      blockers: [],
    });
  });

  it("keeps the class code when the error body cannot be parsed", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server exploded",
      json: async () => {
        throw new Error("invalid json");
      },
    });

    await expect(
      caregiverCapabilityService.getOperatorAccountCapability("10", "42"),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CaregiverCapabilityApiError>>({
        name: "CaregiverCapabilityApiError",
        message: "Betreuung konnte nicht geändert werden",
        status: 500,
        code: "general.server",
        blockers: [],
      }),
    );
  });
});
