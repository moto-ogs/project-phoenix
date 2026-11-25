import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setTestClock } from "~/test/clock";
import type { TenantInfo } from "~/lib/tenant-api";

const { calls, snapshot, host, tenant } = vi.hoisted(() => ({
  calls: [] as string[],
  snapshot: {
    current: null as null | {
      session: Session;
      accessToken: string;
      notBooked: boolean;
    },
  },
  host: { current: "school-a.localhost:3000" },
  tenant: { current: {} as Partial<TenantInfo> },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: host.current }),
}));
vi.mock("~/lib/portal-session-snapshot.server", () => ({
  readPortalSessionSnapshot: async () => snapshot.current,
}));
vi.mock("~/lib/tenant-resolve.server", () => ({
  resolveTenantCached: async () => ({ settings: null }),
}));
vi.mock("~/lib/tenant-api", async (original) => ({
  ...(await original<typeof import("~/lib/tenant-api")>()),
  projectTenantResolve: () => tenant.current,
}));
vi.mock("~/lib/backend-client.server", async (original) => ({
  ...(await original<typeof import("~/lib/backend-client.server")>()),
  sendBackend: async (endpoint: string) => {
    calls.push(endpoint);
    const url = new URL(endpoint, "http://backend");
    const data = url.pathname.endsWith("/gaps")
      ? { from: "", to: "", gaps: [], acknowledged: [] }
      : url.pathname.endsWith("/periods/")
        ? []
        : { from: "", to: "", instances: [] };
    return Response.json({ status: "success", data });
  },
}));

import { loadBetreuungsplanSeed } from "./betreuungsplan-seed.server";
import { databaseKeys } from "~/lib/swr/portal-keys";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";

function staff(permissions: string[]): Session {
  return {
    user: { id: "7", tenantId: "1", roles: ["staff"], permissions },
    expires: "2099-01-01",
  };
}

const PLANNER = staff([
  "schedules:read",
  "schedules:manage",
  "groups:read",
  "rooms:read",
]);

beforeEach(() => {
  // A Wednesday in Berlin; the week runs Monday 7 to Friday 11 September.
  setTestClock("2026-09-09T10:00:00Z");
  vi.stubEnv("TENANT_DOMAIN", "localhost");
  calls.length = 0;
  host.current = "school-a.localhost:3000";
  tenant.current = { tenantId: "1", subdomain: "school-a" };
  snapshot.current = { session: PLANNER, accessToken: "t", notBooked: false };
});

describe("loadBetreuungsplanSeed", () => {
  it("starts the slim grid and the planner's gap check for the URL", async () => {
    // A Saturday anchor opens the following care week, as in the view.
    const seed = await loadBetreuungsplanSeed("school-a", {
      d: "2026-09-12",
      group: "4",
    });

    expect(seed?.entries.map((entry) => [entry.key, entry.render])).toEqual([
      [databaseKeys.calendarPeriods(), true],
      [
        tenantDailyKeys.planInstances("week", "2026-09-14", "2026-09-18", {
          groupId: "4",
          staffId: null,
          roomId: null,
        }),
        true,
      ],
      [tenantDailyKeys.planGaps("2026-09-14", "2026-09-18"), undefined],
    ]);
    await Promise.all(seed!.entries.map((entry) => entry.value));
    expect(calls.sort()).toEqual([
      "/api/timetable/gaps?date=2026-09-14&date_to=2026-09-18",
      "/api/timetable/instances/?from=2026-09-14&to=2026-09-18&group_id=4&view=slim",
      "/api/timetable/periods/",
    ]);
  });

  it("keeps the read view's gates: week only, no gaps, no hidden filter", async () => {
    snapshot.current = {
      session: staff(["schedules:read"]),
      accessToken: "t",
      notBooked: false,
    };

    const seed = await loadBetreuungsplanSeed("school-a", {
      view: "monat",
      group: "4",
      room: "2",
      staff: "9",
    });

    expect(seed?.entries.map((entry) => entry.key)).toEqual([
      databaseKeys.calendarPeriods(),
      tenantDailyKeys.planInstances("week", "2026-09-07", "2026-09-11", {
        groupId: null,
        staffId: "9",
        roomId: null,
      }),
    ]);
  });

  it("follows the Berlin day across midnight", async () => {
    // Sunday 23:30 in Berlin, already Monday 14 September: the next week.
    setTestClock("2026-09-13T22:30:00Z");

    const seed = await loadBetreuungsplanSeed("school-a", {});

    expect(seed?.entries[1]?.key).toBe(
      tenantDailyKeys.planInstances("week", "2026-09-14", "2026-09-18", {
        groupId: null,
        staffId: null,
        roomId: null,
      }),
    );
  });

  it.each<[string, () => void]>([
    ["no snapshot", () => (snapshot.current = null)],
    [
      "a module not booked",
      () => (snapshot.current = { ...snapshot.current!, notBooked: true }),
    ],
    [
      "another school's session",
      () =>
        (snapshot.current = {
          ...snapshot.current!,
          session: { ...PLANNER, user: { ...PLANNER.user, tenantId: "2" } },
        }),
    ],
    ["the bare domain", () => (host.current = "localhost:3000")],
    [
      "a switched-off plan",
      () => (tenant.current = { ...tenant.current, timetableEnabled: false }),
    ],
  ])("seeds nothing for %s", async (_, arrange) => {
    arrange();

    expect(await loadBetreuungsplanSeed("school-a", {})).toBeNull();
    expect(calls).toEqual([]);
  });
});
