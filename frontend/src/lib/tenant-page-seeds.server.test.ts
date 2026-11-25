import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTimeTrackingSeed } from "~/app/[tenant]/(protected)/time-tracking/page-seed.server";
import { buildSupervisionDashboardWire } from "~/test/fixtures/supervision-dashboard";
import { testClockDay } from "~/test/clock";
import { loadActiveSupervisionsSeed } from "./active-supervisions-seed.server";
import { loadHomeSeed } from "./home-seed.server";
import { loadRequestInboxSeed } from "./request-inbox-seed.server";
import { loadStudentSearchSeed } from "./student-search-seed.server";
import { initialStudentSearch } from "./student-search-url";
import type { TenantInfo } from "./tenant-api";
import {
  homeKeys,
  homeLayoutKeys,
  studentKeys,
  timeTrackingKeys,
} from "./swr/portal-keys";
import { dashboardKeys, ownSupervisionKeys } from "./swr/shell-keys";
import { tenantListKeys } from "./swr/tenant-list-keys";

const { source } = vi.hoisted(() => ({
  source: {
    host: "school-a.localhost",
    snapshot: null as {
      session: Session;
      accessToken: string;
      notBooked: boolean;
    } | null,
    tenant: {} as Partial<TenantInfo>,
    response: vi.fn<(url: URL) => Response>(),
    send: vi.fn<(path: string, token: string) => Promise<Response>>(),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: source.host }),
}));
vi.mock("~/lib/portal-session-snapshot.server", () => ({
  readPortalSessionSnapshot: async (portal: string) =>
    portal === "tenant" ? source.snapshot : null,
}));
vi.mock("~/lib/tenant-resolve.server", () => ({
  resolveTenantCached: async () => ({ settings: null }),
}));
vi.mock("~/lib/tenant-api", async (original) => ({
  ...(await original<typeof import("~/lib/tenant-api")>()),
  projectTenantResolve: () => source.tenant,
}));
vi.mock("~/lib/backend-client.server", async (original) => ({
  ...(await original<typeof import("~/lib/backend-client.server")>()),
  sendBackend: source.send,
}));

function success(data: unknown) {
  return Response.json({ status: "success", data });
}

function entries(paths: readonly [path: string, token: string][]) {
  return paths.map(([path]) => new URL(path, "http://localhost"));
}

function authenticate(permissions: string[], tenantId = "7", scope = "") {
  source.snapshot = {
    session: {
      user: { id: "42", tenantId, scope, roles: ["teacher"], permissions },
      expires: "2099-01-01",
    },
    accessToken: "tenant-a-token",
    notBooked: false,
  };
}

beforeEach(() => {
  vi.stubEnv("TENANT_DOMAIN", "localhost");
  source.host = "school-a.localhost";
  source.tenant = {
    tenantId: "7",
    subdomain: "school-a",
    bookedModules: [],
    presenceMode: "detailed",
  };
  source.send
    .mockReset()
    .mockImplementation(async (path) =>
      source.response(new URL(path, "http://localhost")),
    );
  source.response.mockReset().mockImplementation(() => success([]));
  authenticate(["users:read", "groups:read", "rooms:read"]);
});

describe("first tenant page reads", () => {
  it("loads the three current time-tracking views independently, under their date keys", async () => {
    authenticate(["time_tracking:own"]);
    source.tenant = { ...source.tenant, bookedModules: ["zeiterfassung"] };
    source.response.mockImplementation((url) => {
      if (!url.pathname.endsWith("/period"))
        return new Response(null, { status: 503 });
      const start = url.searchParams.get("start");
      return success({
        staff_id: "12",
        view: "week",
        start,
        end: start,
        week_start: start,
        week_end: start,
        account_start: null,
        sessions: null,
        labor_days: null,
        rest_hints: null,
        weekly_summaries: null,
        absences: null,
        shifts: { state: "not_booked", rows: null },
        holidays: null,
        closing_days: null,
        days: null,
      });
    });
    const seed = await loadTimeTrackingSeed("school-a");
    const today = testClockDay(0);
    const calls = entries(source.send.mock.calls);
    expect(calls.map(({ pathname }) => pathname)).toEqual([
      "/api/time-tracking/overview",
      "/api/time-tracking/period",
      "/api/time-tracking/leave-overview",
    ]);
    const query = calls[1]!.searchParams;
    expect(query.get("view")).toBe("week");
    const start = query.get("start")!;
    expect(seed?.entries.map(({ key }) => key)).toEqual([
      timeTrackingKeys.overview(today),
      timeTrackingKeys.period("week", start),
      timeTrackingKeys.leaveOverview(Number(today.slice(0, 4))),
    ]);
    await expect(seed?.entries[0]?.value).resolves.toBeUndefined();
    await expect(seed?.entries[1]?.value).resolves.toMatchObject({
      from: start,
      to: start,
    });
    await expect(seed?.entries[2]?.value).resolves.toBeUndefined();
  });

  it.each([
    ["another school", "9", ""],
    ["another portal", "7", "school"],
  ])("makes no reads for %s", async (_reason, id, scope) => {
    authenticate(["users:read", "groups:read"], id, scope);
    await expect(
      loadStudentSearchSeed("school-a", new URLSearchParams()),
    ).resolves.toBeNull();
    await expect(loadActiveSupervisionsSeed("school-a")).resolves.toBeNull();
    await expect(loadHomeSeed("school-a")).resolves.toBeNull();
    await expect(loadRequestInboxSeed("school-a")).resolves.toBeNull();
    expect(source.send).not.toHaveBeenCalled();
  });

  it("does not resolve a school's protected resource on the bare domain", async () => {
    source.host = "localhost";
    expect(
      await loadStudentSearchSeed("school-a", new URLSearchParams()),
    ).toBeNull();
    expect(source.send).not.toHaveBeenCalled();
  });

  it("uses the filtered slim key for the Berlin planning day and leaves only a failed option out", async () => {
    const date = testClockDay(1);
    const params = new URLSearchParams({
      date,
      group_id: "4,8",
      room_id: "2",
      bus: "yes",
    });
    params.append("school_class", "2a");
    params.append("school_class", "2b");
    source.response.mockImplementation((url) => {
      if (url.pathname === "/api/rooms/")
        return new Response(null, { status: 503 });
      if (url.pathname !== "/api/students/") return success([]);
      return Response.json({
        status: "success",
        data: [],
        pagination: {
          current_page: 1,
          page_size: 1000,
          total_pages: 1,
          total_records: 0,
        },
      });
    });
    const seed = await loadStudentSearchSeed("school-a", params);
    const key = studentKeys.search(
      initialStudentSearch(params, testClockDay(0), false),
    );
    await expect(
      seed?.entries.find((entry) => entry.key === key)?.value,
    ).resolves.toEqual({
      requestDate: date,
      requestIsToday: false,
      students: [],
      truncatedTotal: null,
    });
    await expect(
      seed?.entries.find((entry) => entry.key === studentKeys.schoolClasses())
        ?.value,
    ).resolves.toEqual([]);
    await expect(
      seed?.entries.find((entry) => entry.key.startsWith("rooms-"))?.value,
    ).resolves.toBeUndefined();
    const list = entries(source.send.mock.calls).find(
      (url) => url.pathname === "/api/students/",
    );
    expect(list?.searchParams.get("room_id")).toBeNull();
    expect(list?.searchParams.get("view")).toBe("slim");
    expect(list?.searchParams.get("date")).toBe(date);
    expect(list?.searchParams.get("group_id")).toBe("4,8");
    expect(list?.searchParams.get("school_class")).toBe("2a,2b");
    expect(
      source.send.mock.calls.every(([, token]) => token === "tenant-a-token"),
    ).toBe(true);
  });

  it("never asks for an unfiltered child list while enrollment-answer access is refused", async () => {
    source.response.mockImplementation((url) =>
      url.pathname.endsWith("/enrollment-answer-filters")
        ? new Response(null, { status: 403 })
        : success([]),
    );
    const seed = await loadStudentSearchSeed(
      "school-a",
      new URLSearchParams({ enrollment_answer: "q=a" }),
    );
    const options = seed?.entries.find(
      (entry) =>
        entry.key === tenantListKeys.enrollmentAnswerFilters(testClockDay(0)),
    );
    await expect(options?.value).resolves.toBeUndefined();
    expect(
      entries(source.send.mock.calls).some(
        (url) => url.pathname === "/api/students/",
      ),
    ).toBe(false);
  });

  it("offers only the default supervision aggregate under its stable key", async () => {
    source.response.mockReturnValue(
      success(buildSupervisionDashboardWire({ selected_group_id: "9" })),
    );
    const seed = await loadActiveSupervisionsSeed("school-a");
    expect(seed?.entries.map(({ key }) => key)).toEqual([
      dashboardKeys.supervision("42"),
    ]);
    await expect(seed?.entries[0]?.value).resolves.toMatchObject({
      selectedGroupId: "9",
    });
    const urls = entries(source.send.mock.calls);
    expect(urls.map(({ pathname, search }) => pathname + search)).toEqual([
      "/api/active/supervision-dashboard",
    ]);
  });

  it("keeps the own-supervision branch on the own reads", async () => {
    authenticate(["schedules:read"]);
    const seed = await loadActiveSupervisionsSeed("school-a");
    expect(seed?.entries.map(({ key }) => key)).toEqual([
      ownSupervisionKeys.day(),
      ownSupervisionKeys.plannedNow(),
    ]);
    await Promise.all(seed?.entries.map(({ value }) => value) ?? []);
    expect(
      entries(source.send.mock.calls).map(({ pathname }) => pathname),
    ).toEqual([
      "/api/timetable/operations/planned-now",
      "/api/timetable/operations/planned-now",
    ]);
  });

  it("keeps the saved home layout when a NowStrip resource fails and does not load disabled cards", async () => {
    source.response.mockImplementation((url) => {
      if (url.pathname === "/api/settings/home-layout") {
        return success({
          overrides: { "section.birthdays": false },
          blocks: [],
          policies: {},
          can_manage_policies: false,
          policies_version: "layout-1",
        });
      }
      return new Response(null, { status: 503 });
    });
    const seed = await loadHomeSeed("school-a");
    await expect(
      seed?.entries.find(({ key }) => key === homeLayoutKeys.key())?.value,
    ).resolves.toMatchObject({ policiesVersion: "layout-1" });
    await expect(
      seed?.entries.find(({ key }) => key === dashboardKeys.analytics())?.value,
    ).resolves.toBeUndefined();
    expect(
      seed?.entries.some(({ key }) => key === homeKeys.birthdayOverview()),
    ).toBe(false);
  });

  it("checks the live review boundary before loading the parent queue, with no invisible staff tab seed", async () => {
    authenticate(["users:read", "users:update", "vacation:approve"]);
    source.response.mockImplementation((url) => {
      if (url.pathname.endsWith("/access"))
        return success({ review_access: "group_leader" });
      if (url.pathname.endsWith("/change-requests"))
        return success({ items: [], review_access: "group_leader" });
      return success([]);
    });
    const seed = await loadRequestInboxSeed("school-a");
    await expect(
      seed?.entries.find(({ key }) => key.startsWith("request-feed"))?.value,
    ).resolves.toMatchObject({
      items: [],
      reviewAccess: "group_leader",
      pages: 1,
    });
    expect(
      entries(source.send.mock.calls).map(({ pathname }) => pathname),
    ).toEqual([
      "/api/students/change-requests/access",
      "/api/students/change-requests",
      "/api/students/offering-change-requests/course-waitlists",
    ]);
  });
});
