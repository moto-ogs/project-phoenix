import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffRecordResponse } from "~/lib/contract/staff.generated";
import type { ModuleKey } from "~/lib/modules";
import type { PortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";
import { timeTrackingKeys } from "~/lib/swr/portal-keys";
import {
  staffAbsenceKeys,
  staffAccessKeys,
  staffKeys,
  staffQualificationKeys,
  staffTimeKeys,
} from "~/lib/swr/staff-keys";
import type { ServerSeed } from "~/lib/swr/server-seed";
import {
  TEST_CLOCK_INSTANT,
  TEST_CLOCK_TODAY,
  testClockDay,
} from "~/test/clock-instant";

const state = vi.hoisted(() => ({
  snapshot: null as PortalSessionSnapshot | null,
  modules: [] as ModuleKey[],
  school: "1",
  host: "staff-school.localhost:3000",
  send: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: state.host }),
}));
vi.mock("~/lib/portal-session-snapshot.server", () => ({
  readPortalSessionSnapshot: async () => state.snapshot,
}));
vi.mock("~/lib/tenant-resolve.server", () => ({
  resolveTenantCached: async () => ({ settings: null }),
}));
vi.mock("~/lib/tenant-api", async (original) => ({
  ...(await original<typeof import("~/lib/tenant-api")>()),
  projectTenantResolve: () => ({
    tenantId: state.school,
    subdomain: "staff-school",
    bookedModules: state.modules,
  }),
}));
vi.mock("~/lib/backend-client.server", async (original) => ({
  ...(await original<typeof import("~/lib/backend-client.server")>()),
  sendBackend: state.send,
}));
vi.mock("./page-content", () => ({ default: () => null }));

import StaffDetailPage from "./page";

const id = "41";
const year = Number(TEST_CLOCK_TODAY.slice(0, 4));
const instant = TEST_CLOCK_INSTANT.toISOString();
const record: StaffRecordResponse = {
  id,
  person_id: "11",
  started_on: testClockDay(-100),
  ended_on: null,
  is_teacher: true,
  is_external: false,
  was_present_today: false,
  created_at: instant,
  updated_at: instant,
};
const identity = { id, name: "A B", firstName: "A", lastName: "B" };
const absence = {
  id: "18",
  staff_id: id,
  tenant_id: "1",
  absence_type: "vacation",
  date_start: TEST_CLOCK_TODAY,
  date_end: TEST_CLOCK_TODAY,
  half_day: false,
  start_half_day: false,
  end_half_day: false,
  note: "Private request note",
  status: "requested",
  created_by: "7",
  requested_at: instant,
  created_at: instant,
  updated_at: instant,
  duration_days: 1,
};

function setSession(permissions: string[], scope?: Session["user"]["scope"]) {
  state.snapshot = {
    session: {
      expires: instant,
      user: { id: "7", tenantId: "1", roles: ["staff"], permissions, scope },
    },
    notBooked: false,
    accessToken: "test-staff-token",
  };
}

function response(data: unknown) {
  return Response.json({ status: "success", data });
}

function requested() {
  return state.send.mock.calls.map(
    ([path]) => new URL(path, "http://localhost"),
  );
}

async function open(tab?: string | string[], date?: string | string[]) {
  const page = await StaffDetailPage({
    params: Promise.resolve({ tenant: "staff-school", id }),
    searchParams: Promise.resolve({ tab, date }),
  });
  const seed: ServerSeed | null = await page.props.seed;
  return new Map(
    await Promise.all(
      (seed?.entries ?? []).map(
        async ({ key, value }) => [key, await value] as const,
      ),
    ),
  );
}

beforeEach(() => {
  vi.stubEnv("TENANT_DOMAIN", "localhost");
  setSession(["time_tracking:manage", "users:read"]);
  state.modules = ["zeiterfassung", "personalakte"];
  state.school = "1";
  state.host = "staff-school.localhost:3000";
  state.send.mockReset();
  state.send.mockImplementation(async (path: string) => {
    if (path === `/api/staff/${id}`) return response(record);
    if (path.startsWith(`/api/staff/${id}/absences?`))
      return response([absence]);
    return new Response(null, { status: 503 });
  });
});

describe("staff detail's first-display seed", () => {
  it("uses only the default overview and waits for the configured account window", async () => {
    const anchor = testClockDay(-400);
    const fallback = state.send.getMockImplementation()!;
    state.send.mockImplementation(async (path: string) => {
      if (path === "/api/time-tracking/config")
        return response({ account_start_date: anchor });
      if (path.includes("/time-tracking/history")) {
        return response({
          sessions: [
            {
              id: "17",
              tenant_id: "1",
              staff_id: id,
              date: TEST_CLOCK_TODAY,
              status: "present",
              source: "app",
              check_in_time: instant,
              notes: "Not for an overview chart",
              auto_checked_out: false,
              created_by: "7",
              created_at: instant,
              updated_at: instant,
              break_minutes: 0,
              net_minutes: 15,
              is_overtime: false,
              is_break_compliant: true,
              breaks: null,
              edit_count: 0,
              audit_count: 0,
              pack_up_minutes: 0,
              rounding_minutes: 0,
              version: "edit-token",
            },
          ],
          weekly_summaries: null,
          labor_days: null,
        });
      }
      if (path.includes("/schedule-targets")) return response([]);
      return fallback(path);
    });

    const seed = await open();
    expect(seed.get(timeTrackingKeys.config())).toEqual({
      accountStartDate: anchor,
    });
    expect(
      seed.get(
        staffTimeKeys.historyAccount(id, testClockDay(-401), TEST_CLOCK_TODAY),
      ),
    ).toEqual([
      {
        date: TEST_CLOCK_TODAY,
        status: "present",
        check_in_time: instant,
        check_out_time: null,
        break_minutes: 0,
        net_minutes: 15,
        breaks: [],
      },
    ]);
    expect(seed.get(staffAbsenceKeys.pendingForStaff(id))).toBe(1);
    expect(
      seed.get(staffTimeKeys.balanceAdjustments(id, anchor, "9999-12-31")),
    ).toBeUndefined();
    expect(
      seed.get(
        staffTimeKeys.scheduleTargetsAccount(id, anchor, TEST_CLOCK_TODAY),
      ),
    ).toEqual(new Map());
    expect(
      requested().filter(({ pathname }) =>
        pathname.endsWith("/schedule-targets"),
      ),
    ).toHaveLength(2);
  });

  it("seeds the explicit permitted week and the current-week KPI under distinct keys", async () => {
    const day = testClockDay(-21);
    await open(["zeiterfassung", "stammdaten"], [day, TEST_CLOCK_TODAY]);

    const calls = requested();
    const targets = calls.filter(({ pathname }) =>
      pathname.endsWith("/schedule-targets"),
    );
    expect(targets).toHaveLength(2);
    const shifts = calls.find(
      ({ pathname }) => pathname === "/api/staff-shifts/",
    );
    expect(shifts?.searchParams.get("staff_id")).toBe(id);
    const from = shifts?.searchParams.get("from");
    const to = shifts?.searchParams.get("to");
    expect(from! <= day && day <= to!).toBe(true);
    expect(from! <= TEST_CLOCK_TODAY && TEST_CLOCK_TODAY <= to!).toBe(false);
    const history = calls.find(({ pathname }) =>
      pathname.endsWith("/time-tracking/history"),
    );
    expect(history?.searchParams.get("from")).not.toBe(from);
    expect(history?.searchParams.get("to")).toBe(to);
  });

  it("shares the absences GET with the badge and seeds only enabled allowance types", async () => {
    const type = {
      name: "Bildungsurlaub",
      base_type: "other",
      is_active: true,
      carryover_until: null,
      requestable: false,
      kept_by_traeger: false,
      offered: true,
      school_limit_days: null,
      version: "type-version",
    };
    const fallback = state.send.getMockImplementation()!;
    state.send.mockImplementation(async (path: string) => {
      if (path === "/api/absence-types/") {
        return response([
          { ...type, id: "3", allowance_enabled: true },
          { ...type, id: "4", allowance_enabled: false },
        ]);
      }
      if (path.startsWith(`/api/absence-types/3/allowances/${id}?`)) {
        return response({
          staff_id: id,
          absence_type_id: "3",
          year,
          entitled_days: 5,
          taken_days: 0,
          reserved_days: 0,
          remaining_days: 5,
          expires_on: "",
          expired_days: 0,
          booking_days: 0,
          carried_in: null,
          kept_by_traeger: false,
          version: "quota-version",
        });
      }
      return fallback(path);
    });

    const seed = await open("abwesenheiten");
    expect(seed.get(staffAbsenceKeys.pendingForStaff(id))).toBe(1);
    expect(
      seed.get(staffAbsenceKeys.list(id, `${year}-01-01`, `${year}-12-31`)),
    ).toEqual([
      expect.objectContaining({ id: absence.id, note: absence.note }),
    ]);
    expect(seed.get(staffAbsenceKeys.allowances(id, year, ["3"]))).toEqual([
      expect.objectContaining({
        summary: expect.objectContaining({ remainingDays: 5 }),
      }),
    ]);
    expect(
      requested().filter(({ pathname }) => pathname.includes("/absences")),
    ).toHaveLength(1);
    expect(
      requested().filter(({ pathname }) => pathname.includes("/allowances/")),
    ).toHaveLength(1);
  });

  it.each([
    ["staff:documents", "dokumente", "documents"],
    ["staff:financial", "stammdaten", "financial"],
  ] as const)(
    "seeds only limited identity for %s, never the side-effecting tab GET",
    async (permission, tab, profile) => {
      setSession([permission]);
      state.send.mockResolvedValueOnce(response(identity));
      const seed = await open(tab);
      expect(seed.get(staffKeys.profileKey(id))).toEqual(
        expect.objectContaining({ id, firstName: "A" }),
      );
      expect(requested().map(({ pathname }) => pathname)).toEqual([
        `/api/staff/${profile}-profile/${id}`,
      ]);
    },
  );

  it("seeds payroll and Träger proof status but not GETs that create standard qualification types", async () => {
    const fallback = state.send.getMockImplementation()!;
    state.send.mockImplementation(async (path: string) => {
      if (path.endsWith("/payroll-number")) {
        return response({
          staff_id: id,
          personnel_number: "PN 17",
          kept_by_traeger: false,
          version: "payroll-version",
        });
      }
      if (path.endsWith("/traeger-proofs")) {
        return response([
          { type_name: "Erste Hilfe", status: "valid", expires_on: null },
        ]);
      }
      return fallback(path);
    });
    const seed = await open("stammdaten");
    expect(seed.get(staffKeys.payrollNumber(id))).toEqual({
      personnelNumber: "PN 17",
      keptByTraeger: false,
      version: "payroll-version",
    });
    expect(seed.get(staffQualificationKeys.traeger(id))).toEqual([
      { typeName: "Erste Hilfe", status: "valid", expiresOn: "" },
    ]);
    expect(
      requested()
        .map(({ pathname }) => pathname)
        .sort(),
    ).toEqual([
      `/api/staff/${id}`,
      `/api/staff/${id}/absences`,
      `/api/staff/${id}/payroll-number`,
      `/api/staff/${id}/traeger-proofs`,
    ]);
  });

  it("keeps the work-time model's dependent display reads behind schedule success", async () => {
    setSession(["admin:*"]);
    const fallback = state.send.getMockImplementation()!;
    state.send.mockImplementation(async (path: string) => {
      if (path.endsWith("/schedule")) {
        return response({
          mode: "custom",
          rotation_length: 1,
          rotation_anchor_date: "",
          entries: null,
          weekly_totals: null,
          kept_by_traeger: false,
          version: "schedule-version",
        });
      }
      if (
        path.endsWith("/target-overrides") ||
        path.includes("/schedule-targets?")
      ) {
        return response([]);
      }
      return fallback(path);
    });
    const seed = await open("arbeitszeitmodell");
    expect(seed.get(staffTimeKeys.schedule(id))).toEqual(
      expect.objectContaining({ entries: [], version: "schedule-version" }),
    );
    expect(seed.get(staffTimeKeys.targetOverrides(id))).toEqual([]);
    const preview = requested().find(({ pathname }) =>
      pathname.endsWith("/schedule-targets"),
    );
    const from = preview?.searchParams.get("from");
    const to = preview?.searchParams.get("to");
    expect(from! <= TEST_CLOCK_TODAY && TEST_CLOCK_TODAY <= to!).toBe(true);
    expect(
      seed.get(staffTimeKeys.scheduleTargetsPreview(id, from!, to!)),
    ).toEqual(new Map());
  });

  it("loads only assigned classes, not suggestions or a disallowed explicit tab", async () => {
    setSession(["users:read"]);
    state.send.mockResolvedValueOnce(response(record)).mockResolvedValueOnce(
      response({
        staff_id: id,
        school_classes: ["1a"],
        version: "class-version",
      }),
    );
    const seed = await open("klassen");
    expect(seed.get(staffAccessKeys.schoolClasses(id))).toEqual({
      classes: ["1a"],
      version: "class-version",
    });
    expect(requested().map(({ pathname }) => pathname)).toEqual([
      `/api/staff/${id}`,
      `/api/staff/${id}/school-classes`,
    ]);
    state.send.mockClear();
    expect([...(await open("zeiterfassung"))]).toEqual([
      [staffKeys.recordKey(id), record],
    ]);
    expect(requested().map(({ pathname }) => pathname)).toEqual([
      `/api/staff/${id}`,
    ]);
  });

  it.each(["former", "refused"] as const)(
    "does not start tab reads for a %s identity",
    async (status) => {
      state.send.mockResolvedValueOnce(
        status === "former"
          ? response({ ...record, ended_on: testClockDay(-1) })
          : new Response(null, { status: 403 }),
      );
      const seed = await open("zeiterfassung");
      expect(seed.get(staffKeys.recordKey(id))).toEqual(
        status === "former"
          ? { ...record, ended_on: testClockDay(-1) }
          : undefined,
      );
      expect(requested().map(({ pathname }) => pathname)).toEqual([
        `/api/staff/${id}`,
      ]);
    },
  );

  it.each(["host", "school", "scope"] as const)(
    "does not start protected reads for a %s mismatch",
    async (boundary) => {
      if (boundary === "host") state.host = "another-school.localhost:3000";
      if (boundary === "school") state.school = "2";
      if (boundary === "scope") setSession(["time_tracking:manage"], "parent");
      expect(await open()).toEqual(new Map());
      expect(state.send).not.toHaveBeenCalled();
    },
  );
});
