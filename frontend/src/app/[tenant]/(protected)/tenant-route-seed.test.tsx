import type { Session } from "next-auth";
import { isValidElement, type ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PhaseResponse } from "~/lib/contract/enrollment.generated";
import type { ModuleKey } from "~/lib/modules";
import type { PortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { messageKeys, weekProtocolKeys } from "~/lib/swr/portal-keys";
import { groupKeys } from "~/lib/swr/groups-keys";
import { roomKeys } from "~/lib/swr/rooms-keys";
import type { ServerSeed, ServerSeedInput } from "~/lib/swr/server-seed";
import { TEST_CLOCK_TODAY, testClockDay } from "~/test/clock-instant";
import { buildRoomResponse } from "~/test/fixtures/rooms";
import { buildBackendStudent } from "~/test/fixtures/students";

const state = vi.hoisted(() => ({
  snapshot: null as PortalSessionSnapshot | null,
  modules: [] as ModuleKey[],
  host: "",
  schoolId: "",
  send: vi.fn(),
  openCare: false,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: state.host }),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("~/lib/portal-session-snapshot.server", () => ({
  readPortalSessionSnapshot: async () => state.snapshot,
}));
vi.mock("~/lib/tenant-resolve.server", () => ({
  resolveTenantCached: async () => ({ settings: null }),
}));
vi.mock("~/lib/tenant-api", async (original) => ({
  ...(await original<typeof import("~/lib/tenant-api")>()),
  projectTenantResolve: () => ({
    tenantId: state.schoolId,
    subdomain: "school-a",
    bookedModules: state.modules,
    groupMode: state.openCare ? "open_care" : "fixed_groups",
  }),
}));
vi.mock("~/lib/backend-client.server", async (original) => ({
  ...(await original<typeof import("~/lib/backend-client.server")>()),
  sendBackend: state.send,
}));
vi.mock("./care-offerings/page-content", () => ({ default: () => null }));
vi.mock("./messages/groups/page-content", () => ({ default: () => null }));
vi.mock("./wochenprotokolle/page-content", () => ({ default: () => null }));
vi.mock("./ogs-groups/page-content", () => ({ default: () => null }));
vi.mock("./rooms/[id]/page-content", () => ({ default: () => null }));

import CareOfferingsPage from "./care-offerings/page";
import GroupMessagesPage from "./messages/groups/page";
import OGSGroupPage from "./ogs-groups/page";
import RoomDetailPage from "./rooms/[id]/page";
import { TenantRouteSeed } from "./tenant-route-seed";
import WeekProtocolsPage from "./wochenprotokolle/page";

const params = Promise.resolve({ tenant: "school-a" });

async function readSeed(
  page: ReturnType<typeof GroupMessagesPage>,
): Promise<ServerSeed | undefined> {
  const route = await page;
  const result = await TenantRouteSeed(
    route.props as ComponentProps<typeof TenantRouteSeed>,
  );
  return isValidElement<{ seed?: ServerSeed | Promise<ServerSeed | null> }>(
    result,
  )
    ? ((await result.props.seed) ?? undefined)
    : undefined;
}

function setSession(
  permissions: string[],
  scope?: Session["user"]["scope"],
): void {
  state.snapshot = {
    session: {
      expires: "2099-01-01",
      user: { id: "7", tenantId: "1", roles: ["staff"], permissions, scope },
    },
    notBooked: false,
    accessToken: "test",
  };
}

beforeEach(() => {
  vi.stubEnv("TENANT_DOMAIN", "localhost");
  setSession(["users:read"]);
  state.modules = ["eltern_app"];
  state.host = "school-a.localhost:3000";
  state.schoolId = "1";
  state.openCare = false;
  state.send.mockReset();
  state.send.mockImplementation(async () =>
    Response.json({ status: "success", data: [] }),
  );
});

describe("tenant route seeds", () => {
  it("loads the room's slim student roster after room confirmation and only sends card fields", async () => {
    setSession(["rooms:read", "users:read"]);
    state.send.mockImplementation(async (path: string) => {
      if (path === "/api/rooms/7") {
        return Response.json({
          status: "success",
          data: buildRoomResponse({ id: "7" }),
        });
      }
      if (path === "/api/rooms/7/history") {
        return Response.json({ status: "success", data: [] });
      }
      const url = new URL(path, "http://localhost");
      expect(url.pathname).toBe("/api/students/");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        room_id: "7",
        view: "slim",
        page_size: "200",
      });
      return Response.json({
        status: "success",
        data: [buildBackendStudent({ id: "4", sick: true })],
        pagination: {
          current_page: 1,
          page_size: 200,
          total_pages: 1,
          total_records: 1,
        },
      });
    });
    const page = RoomDetailPage({
      params: Promise.resolve({ tenant: "school-a", id: "7" }),
      searchParams: Promise.resolve({}),
    });
    const seed = isValidElement<{ seed: ServerSeedInput }>(page)
      ? await page.props.seed
      : null;
    const roster = seed?.entries.find(
      ({ key }) => key === roomKeys.students("7"),
    );
    const value = await roster?.value;
    expect(value).toMatchObject({
      students: [
        {
          id: "4",
          first_name: "Max",
          second_name: "Mustermann",
          school_class: "3a",
        },
      ],
      pagination: { total_records: 1 },
    });
    expect(JSON.stringify(value)).not.toContain("sick");
    expect(state.send).toHaveBeenCalledTimes(3);
  });

  it("starts only the requested group and leaves a refusal to the browser", async () => {
    setSession(["users:read", "groups:read"]);
    state.send.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const seed = await readSeed(
      OGSGroupPage({
        params,
        searchParams: Promise.resolve({ group: ["11", "22"] }),
      }),
    );
    expect(seed?.entries.map((entry) => entry.key)).toEqual([
      groupKeys.live("11"),
    ]);
    expect(await seed?.entries[0]?.value).toBeUndefined();
    expect(state.send).toHaveBeenCalledExactlyOnceWith(
      "/api/students/ogs-group-live?group_id=11",
      "test",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("does not guess the stored group or seed when an open-care school redirects", async () => {
    setSession(["users:read", "groups:read"]);
    expect(
      await readSeed(
        OGSGroupPage({ params, searchParams: Promise.resolve({}) }),
      ),
    ).toBeUndefined();
    state.openCare = true;
    expect(
      await readSeed(
        OGSGroupPage({
          params,
          searchParams: Promise.resolve({ group: "11" }),
        }),
      ),
    ).toBeUndefined();
    expect(state.send).not.toHaveBeenCalled();
  });

  it("starts the group inbox read under the exact reader key", async () => {
    const seed = await readSeed(GroupMessagesPage({ params }));
    expect(seed?.entries.map((entry) => entry.key)).toEqual([
      messageKeys.groupMessages(),
    ]);
    expect(await seed?.entries[0]?.value).toEqual([]);
    expect(state.send).toHaveBeenCalledExactlyOnceWith(
      "/api/messages/group-threads",
      "test",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it.each(["host", "school", "scope", "module", "permission"] as const)(
    "starts no protected read on a %s mismatch",
    async (kind) => {
      if (kind === "host") state.host = "school-b.localhost:3000";
      if (kind === "school") state.schoolId = "2";
      if (kind === "scope") setSession(["users:read"], "school");
      if (kind === "module") state.modules = [];
      if (kind === "permission") setSession([]);
      expect(await readSeed(GroupMessagesPage({ params }))).toBeUndefined();
      expect(state.send).not.toHaveBeenCalled();
    },
  );

  it("claims only the visible group filter and leaves a failed list to its browser retry", async () => {
    setSession(["groups:update"]);
    state.send.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const seed = await readSeed(
      WeekProtocolsPage({
        params,
        searchParams: Promise.resolve({ group: ["11", "22"] }),
      }),
    );
    expect(seed?.entries.map((entry) => entry.key)).toEqual([
      weekProtocolKeys.list("11"),
    ]);
    expect(await seed?.entries[0]?.value).toBeUndefined();
    expect(state.send).toHaveBeenCalledExactlyOnceWith(
      "/api/week-protocols/?group_id=11",
      "test",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

function phase(id: string, active: boolean): PhaseResponse {
  return {
    id,
    name: id,
    kind: "school_year",
    service_start_date: TEST_CLOCK_TODAY,
    service_end_date: testClockDay(30),
    care_overflow_mode: "waitlist",
    care_offering_selection_mode: "optional",
    is_active: active,
    eligible_school_classes: [],
    eligible_grade_levels: [],
    available_school_classes: [],
    audience: "open",
    require_school_class: false,
    rollover_auto_approve: false,
    rollover_bumps_grade: false,
    show_status_reason_to_parent: false,
    created_at: "",
    updated_at: "",
    version: "version",
  };
}

describe("care-offering seed dependencies", () => {
  it("starts only the first active phase's offering and booking reads, with independent fallback", async () => {
    state.modules = ["online_anmeldung"];
    setSession(["config:manage", "config:read"]);
    state.send.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/enrollment/care-offerings/booking-stats")) {
        return new Response(null, { status: 503 });
      }
      return Response.json({
        status: "success",
        data:
          path === "/api/enrollment/phases/"
            ? [phase("12", false), phase("42", true), phase("43", true)]
            : [],
      });
    });

    const page = await CareOfferingsPage({ params });
    const seed: ServerSeed = await page.props.seed;
    expect(seed.entries.map((entry) => entry.key)).toEqual([
      enrollmentKeys.phases(),
      enrollmentKeys.careOfferings("42"),
      enrollmentKeys.bookingStats("42"),
    ]);
    expect(await seed.entries[1]?.value).toEqual([]);
    expect(await seed.entries[2]?.value).toBeUndefined();
    expect(state.send.mock.calls.map(([path]) => path)).toEqual([
      "/api/enrollment/phases/",
      "/api/enrollment/care-offerings/?phase_id=42",
      "/api/enrollment/care-offerings/booking-stats?phase_id=42",
    ]);
  });

  it("leaves every phase-dependent key to the browser when phases cannot be loaded", async () => {
    state.modules = ["online_anmeldung"];
    setSession(["config:manage", "config:read"]);
    state.send.mockResolvedValue(new Response(null, { status: 503 }));

    const page = await CareOfferingsPage({ params });
    const seed: ServerSeed = await page.props.seed;
    expect(seed.entries.map((entry) => entry.key)).toEqual([
      enrollmentKeys.phases(),
    ]);
    expect(await seed.entries[0]?.value).toBeUndefined();
    expect(state.send.mock.calls.map(([path]) => path)).toEqual([
      "/api/enrollment/phases/",
    ]);
  });
});
