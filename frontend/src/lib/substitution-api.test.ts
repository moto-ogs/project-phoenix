import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

import { substitutionService } from "./substitution-api";
import { routes } from "./contract/substitutions.generated";

const handover = {
  id: "5",
  type: "group_handover" as const,
  group: { id: "12", name: "Robins Gruppe" },
  target: {
    id: "34",
    full_name: "Toni Test",
  },
  period: { start_date: "2026-08-29", end_date: "2026-08-30" },
  can_end: true,
};

describe("substitutionService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads only narrow schedule substitutions and staff targets", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          group_handovers: [],
          targets: [],
          schedule_appointments: [
            {
              id: "42",
              type: "schedule_substitution",
              date: "2026-08-31",
              start_time: "12:00",
              end_time: "13:00",
              title: "Mensa",
              status: "planned",
              staff: [
                {
                  assignment_id: "9",
                  staff: { id: "7", full_name: "Ada Alt" },
                  is_absent: true,
                  is_substitute: false,
                  can_end: false,
                },
              ],
            },
          ],
          schedule_targets: [{ id: "8", full_name: "Nora Neu" }],
        },
      }),
    });

    const result = await substitutionService.fetchScheduleOverview(
      "2026-08-31",
      "2026-09-04",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/substitutions?from=2026-08-31&to=2026-09-04",
      { method: "GET" },
    );
    expect(result.staff).toEqual([
      { id: "8", name: "Nora Neu", isExternal: false },
    ]);
    expect(result.appointments[0]).toMatchObject({
      id: "42",
      staff: [{ assignmentId: "9", id: "7", isAbsent: true }],
    });
  });

  it("rejects a missing schedule overview envelope clearly", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(
      substitutionService.fetchScheduleOverview("2026-08-31", "2026-09-04"),
    ).rejects.toMatchObject({ name: "ApiError", status: 502 });
  });

  it("preserves string IDs in every appointment-scoped change", async () => {
    const instanceId = "9007199254740993";
    const staffId = "9007199254740995";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          type: "schedule_substitution",
          schedule_substitution: {
            instance_id: instanceId,
            cancelled: false,
            understaffed_ack: false,
            affected_instances: [],
            warnings: [],
          },
        },
      }),
    });

    await substitutionService.applyScheduleSubstitution(instanceId, {
      understaffedAck: true,
      understaffedNote: "Vertretung offen",
      absences: [{ staffId, reason: "Krank", instanceIds: [instanceId] }],
      substitutions: [
        {
          absentStaffId: staffId,
          substituteStaffId: "8",
          instanceIds: [instanceId, "43"],
        },
      ],
      substitutionRemovals: [{ staffId, instanceIds: ["43"] }],
      presences: [
        { staffId, instanceIds: [instanceId] },
        { staffId: "12", instanceIds: [] },
        { staffId: "13" },
      ],
    });

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      type: "schedule_substitution",
      schedule_substitution: {
        instance_id: instanceId,
        understaffed_ack: true,
        understaffed_note: "Vertretung offen",
        absences: [
          { staff_id: staffId, reason: "Krank", instance_ids: [instanceId] },
        ],
        substitutions: [
          {
            absent_staff_id: staffId,
            substitute_staff_id: "8",
            instance_ids: [instanceId, "43"],
          },
        ],
        substitution_removals: [{ staff_id: staffId, instance_ids: ["43"] }],
        presences: [
          { staff_id: staffId, instance_ids: [instanceId] },
          { staff_id: "12", instance_ids: [] },
          { staff_id: "13" },
        ],
      },
    });
  });

  it.each([
    {
      substituteStaffId: "9007199254740995",
      expectedTarget: { substitute_staff_id: "9007199254740995" },
    },
    { substituteStaffId: undefined, expectedTarget: {} },
  ])(
    "preserves day-wide string IDs with target $substituteStaffId",
    async ({ substituteStaffId, expectedTarget }) => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            type: "schedule_substitution",
            schedule_substitution: { days: [], total_affected: 0 },
          },
        }),
      });

      await substitutionService.applyBulkSubstitution({
        absentStaffId: "9007199254740993",
        substituteStaffId,
        dates: ["2026-08-31", "2026-09-01"],
      });

      expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
        type: "schedule_substitution",
        schedule_substitution: {
          whole_days: {
            absent_staff_id: "9007199254740993",
            ...expectedTarget,
            dates: ["2026-08-31", "2026-09-01"],
          },
        },
      });
    },
  );

  it("loads the central overview through one module request", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          groups: [{ id: "12", name: "Robins Gruppe" }],
          group_handovers: [handover],
          targets: [{ id: "34", full_name: "Toni Test" }],
          running_supervisions: [
            {
              id: "41",
              type: "additional_supervision",
              name: "Freispiel",
              room_name: "Atelier",
              supervisors: [{ id: "11", full_name: "Alex Alt" }],
              available_targets: [{ id: "73", full_name: "Nora Neu" }],
              is_current_user_supervising: true,
              can_assign: true,
            },
          ],
        },
      }),
    });

    const result = await substitutionService.fetchOverview();

    expect(fetchMock).toHaveBeenCalledWith("/api/substitutions", {
      method: "GET",
    });
    expect(result.groups).toEqual([{ id: "12", name: "Robins Gruppe" }]);
    expect(result.groupHandovers).toMatchObject([
      {
        id: "5",
        type: "group_handover",
        groupId: "12",
        groupName: "Robins Gruppe",
        substituteStaffId: "34",
        substituteStaffName: "Toni Test",
        canEnd: true,
      },
    ]);
    expect(result.targets).toEqual([{ id: "34", fullName: "Toni Test" }]);
    expect(result.runningSupervisions[0]).toMatchObject({
      id: "41",
      roomName: "Atelier",
      canAssign: true,
    });
  });

  // A malformed overview never reaches the client: the catalog proxy's
  // decoder refuses it and answers 502, so no empty plan is shown.
  it("refuses a malformed overview at the proxy instead of showing an empty plan", () => {
    expect(
      routes["GET /api/substitutions/"].response.safeParse({
        status: "success",
        data: { group_handovers: null, targets: [] },
      }).success,
    ).toBe(false);
  });

  // The catalog proxy hands over the backend's answer, which names its
  // shape in `type` (#2352).
  it("maps a group handover from the named shape of the proxy", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { type: "group_handover", group_handover: handover },
      }),
    });

    const result = await substitutionService.createSubstitution(
      "12",
      "34",
      "2026-08-29",
      "2026-08-30",
    );

    expect(result).toMatchObject({ id: "5", groupId: "12" });
  });

  it("rejects an assignment answer without its named member", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: handover }),
    });

    await expect(
      substitutionService.createSubstitution(
        "12",
        "34",
        "2026-08-29",
        "2026-08-30",
      ),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("maps an added supervisor from the named shape", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          type: "additional_supervision",
          additional_supervision: {
            id: "41",
            type: "additional_supervision",
            active_group_id: "41",
            target: { id: "73", full_name: "Nora Neu" },
          },
        },
      }),
    });

    await expect(
      substitutionService.addSupervisor("41", "73"),
    ).resolves.toEqual({ id: "41", targetName: "Nora Neu" });
  });

  it("maps a schedule substitution from the named shape with string ids", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          type: "schedule_substitution",
          schedule_substitution: {
            instance_id: "42",
            cancelled: false,
            understaffed_ack: false,
            affected_instances: [
              {
                instance_id: "43",
                title: "Mensa",
                start_time: "12:00",
                action: "absent",
              },
            ],
            warnings: [],
            total_affected: 1,
          },
        },
      }),
    });

    const result = await substitutionService.applyScheduleSubstitution("42", {
      substitutions: [
        { absentStaffId: "7", substituteStaffId: "8", instanceIds: ["42"] },
      ],
    });

    expect(result.instanceId).toBe("42");
    expect(result.affectedInstances[0]?.instanceId).toBe("43");
  });

  it("reads appointment ids the proxy sends as strings", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          group_handovers: [],
          targets: [],
          running_supervisions: [],
          schedule_appointments: [
            {
              id: "42",
              type: "schedule_substitution",
              date: "2026-08-31",
              start_time: "12:00",
              end_time: "13:00",
              title: "Mensa",
              status: "planned",
              staff: [
                {
                  assignment_id: "9",
                  staff: { id: "7", full_name: "Ada Alt" },
                  is_absent: true,
                  is_substitute: false,
                  can_end: false,
                },
              ],
            },
          ],
          schedule_targets: [],
        },
      }),
    });

    const result = await substitutionService.fetchScheduleOverview(
      "2026-08-31",
      "2026-09-04",
    );

    expect(result.appointments[0]).toMatchObject({ id: "42" });
    expect(result.appointments[0]?.staff[0]).toMatchObject({
      assignmentId: "9",
      id: "7",
    });
  });

  it("marks forbidden group-overview access for the page guard", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          error: "forbidden",
          code: "substitutions.forbidden",
        }),
        { status: 403 },
      ),
    );

    await expect(substitutionService.fetchOverview()).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      code: "substitutions.forbidden",
    });
  });

  it("assigns and maps a typed group handover", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { type: "group_handover", group_handover: handover },
      }),
    });

    const result = await substitutionService.createSubstitution(
      "12",
      "34",
      "2026-08-29",
      "2026-08-30",
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/substitutions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "group_handover",
        group_handover: {
          group_id: "12",
          target_staff_id: "34",
          start_date: "2026-08-29",
          end_date: "2026-08-30",
        },
      }),
    });
    expect(result.id).toBe("5");
  });

  it("keeps code and request ID of a group-handover creation error", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          error: "substitution already exists",
          code: "substitutions.already_assigned",
          instance: "req-1",
        }),
        { status: 409 },
      ),
    );

    await expect(
      substitutionService.createSubstitution(
        "12",
        "34",
        "2026-08-29",
        "2026-08-30",
      ),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "substitutions.already_assigned",
      requestId: "req-1",
    });
  });

  it("loads one running supervision with its available targets", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          group_handovers: [],
          targets: [],
          running_supervisions: [
            {
              id: "41",
              type: "additional_supervision",
              name: "Freispiel",
              room_name: "Atelier",
              supervisors: [{ id: "11", full_name: "Alex Alt" }],
              available_targets: [{ id: "73", full_name: "Toni Test" }],
              is_current_user_supervising: true,
              can_assign: true,
            },
          ],
        },
      }),
    });

    const result = await substitutionService.fetchRunningSupervision("41");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/substitutions?active_group_id=41",
      { method: "GET" },
    );
    expect(result).toEqual({
      id: "41",
      name: "Freispiel",
      roomName: "Atelier",
      supervisors: [{ id: "11", fullName: "Alex Alt" }],
      availableTargets: [{ id: "73", fullName: "Toni Test" }],
      isCurrentUserSupervising: true,
      canAssign: true,
    });
  });

  it("keeps the account state and organization of external supervisors and targets (#4573)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          group_handovers: [],
          targets: [],
          running_supervisions: [
            {
              id: "41",
              type: "additional_supervision",
              name: "Trommel-AG",
              supervisors: [
                {
                  id: "75",
                  full_name: "Elli Extern",
                  is_external: true,
                  external_account_status: "none",
                },
              ],
              available_targets: [
                {
                  id: "76",
                  full_name: "Jonas Becker",
                  is_external: true,
                  external_organization: "Musikschule",
                  external_account_status: "invitation_pending",
                },
                { id: "73", full_name: "Toni Test" },
              ],
              is_current_user_supervising: true,
              can_assign: true,
            },
          ],
        },
      }),
    });

    const result = await substitutionService.fetchRunningSupervision("41");

    expect(result.supervisors).toEqual([
      {
        id: "75",
        fullName: "Elli Extern",
        isExternal: true,
        externalAccountStatus: "none",
      },
    ]);
    expect(result.availableTargets).toEqual([
      {
        id: "76",
        fullName: "Jonas Becker",
        isExternal: true,
        externalOrganization: "Musikschule",
        externalAccountStatus: "invitation_pending",
      },
      { id: "73", fullName: "Toni Test" },
    ]);
  });

  it("adds a supervisor with only the two allowed ids", async () => {
    const json = vi.fn(async () => ({
      data: {
        type: "additional_supervision",
        additional_supervision: {
          id: "91",
          type: "additional_supervision",
          active_group_id: "41",
          target: { id: "73", full_name: "Toni Test" },
        },
      },
    }));
    fetchMock.mockResolvedValue({
      ok: true,
      json,
    });

    const result = await substitutionService.addSupervisor(
      "9007199254740993",
      "9007199254740995",
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/substitutions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "additional_supervision",
        additional_supervision: {
          active_group_id: "9007199254740993",
          target_staff_id: "9007199254740995",
        },
      }),
    });
    expect(result).toEqual({ id: "91", targetName: "Toni Test" });
    expect(json).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing proxy envelope", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(substitutionService.fetchOverview()).rejects.toMatchObject({
      status: 502,
    });
  });

  it("ends a typed group handover", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });

    await substitutionService.deleteSubstitution("9007199254740993");

    expect(fetchMock).toHaveBeenCalledWith("/api/substitutions/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "group_handover",
        id: "9007199254740993",
      }),
    });
  });

  it("keeps the code of a group-handover cancellation error", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          error: "substitution not running",
          code: "substitutions.not_running",
        }),
        { status: 409 },
      ),
    );

    await expect(
      substitutionService.deleteSubstitution("9007199254740993"),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "substitutions.not_running",
    });
  });
});
