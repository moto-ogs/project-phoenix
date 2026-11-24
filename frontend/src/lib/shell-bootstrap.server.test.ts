import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { releaseFakeTimers } from "~/test/clock";
import type { TenantInfo } from "~/lib/tenant-api";

const { mockBackendAnswer } = vi.hoisted(() => ({
  mockBackendAnswer: vi.fn(),
}));

vi.mock("~/lib/backend-client.server", async (original) => ({
  ...(await original<typeof import("~/lib/backend-client.server")>()),
  sendBackend: async (
    endpoint: string,
    token: string,
    options: { signal?: AbortSignal },
  ) =>
    Response.json(
      await mockBackendAnswer(endpoint, token, { signal: options.signal }),
    ),
}));

vi.mock("~/lib/user-context.server", () => ({
  loadUserContext: vi.fn(async () => ({
    educationalGroups: [],
    supervisedGroups: [],
    currentStaff: null,
    educationalGroupIds: [],
    educationalGroupRoomNames: [],
    supervisedRoomNames: [],
    incomplete: false,
    unavailableSections: [],
  })),
}));

import { loadShellBootstrap } from "./shell-bootstrap.server";
import { loadUserContext } from "~/lib/user-context.server";

function session(overrides: Partial<Session["user"]> = {}): Session {
  return {
    user: {
      id: "7",
      name: "Admin",
      email: "admin@example.com",
      roles: ["admin"],
      permissions: ["admin:*"],
      tenantId: "1",
      ...overrides,
    },
    expires: "2099-01-01",
  };
}

// The browser session carries no token (#5005); the layout hands the
// session's access token to the preload separately.
const ACCESS_TOKEN = "access-token";

const tenant = {
  tenantId: "1",
  slug: "school-a",
  subdomain: "school-a",
  messagingEnabled: true,
  staffMessagingEnabled: false,
  operationalOverviewScope: "own",
} as TenantInfo;

const calledEndpoints = () =>
  mockBackendAnswer.mock.calls.map((call) => call[0] as string).sort();

function routeBackend(responses: Record<string, unknown | Error>): void {
  mockBackendAnswer.mockImplementation(async (endpoint: string) => {
    const response = responses[endpoint];
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error(`unrouted ${endpoint}`);
    return { status: "success", ...(response as object) };
  });
}

const instant = "2026-01-01T00:00:00Z";
const room = {
  id: "8",
  name: "Kreativraum",
  is_occupied: false,
  student_count: 0,
  is_system: false,
  is_open_room: true,
  created_at: instant,
  updated_at: instant,
  version: instant,
};
const page = {
  current_page: 1,
  page_size: 20,
  total_pages: 1,
  total_records: 1,
};
const overviewGroup = {
  id: "1",
  group_id: "1",
  room_id: "5",
  room: { id: "5", name: "Aula" },
  start_time: instant,
  is_active: true,
  created_at: instant,
  updated_at: instant,
};
const ownGroup = {
  id: overviewGroup.id,
  group_id: overviewGroup.group_id,
  room_id: overviewGroup.room_id,
  start_time: instant,
  created_at: instant,
  updated_at: instant,
  tenant_id: "1",
  last_activity: instant,
  timeout_minutes: 30,
  room: {
    ...overviewGroup.room,
    tenant_id: "1",
    created_at: instant,
    updated_at: instant,
    is_system: false,
    is_open_room: true,
  },
};
const absence = {
  id: "1",
  tenant_id: "1",
  staff_id: "1",
  absence_type: "vacation",
  date_start: "2026-01-01",
  date_end: "2026-01-01",
  half_day: false,
  start_half_day: false,
  end_half_day: false,
  status: "pending",
  created_by: "1",
  requested_at: instant,
  created_at: instant,
  updated_at: instant,
  duration_days: 1,
};
const notice = {
  id: "1",
  title: "Hinweis",
  body: "Text",
  priority: "info",
  audience: "all",
  valid_from: "2026-01-01",
  weekdays: null,
  week_pattern: 0,
  active: true,
  version: instant,
};
const notices = [
  { ...notice, requires_acknowledgement: true },
  {
    ...notice,
    id: "2",
    requires_acknowledgement: true,
    acknowledged_at: instant,
  },
  { ...notice, id: "3", requires_acknowledgement: false },
];
const announcement = {
  id: "1",
  title: "Update",
  content: "Text",
  type: "info",
  severity: "info",
  published_at: instant,
};
const navigationGroup = {
  id: "2",
  name: "Zebra",
  via_substitution: false,
  is_personal: false,
};

beforeEach(() => {
  mockBackendAnswer.mockReset();
  vi.mocked(loadUserContext).mockClear();
});

describe("loadShellBootstrap", () => {
  it("loads every shell field an admin's sidebar renders, in one pass", async () => {
    routeBackend({
      "/api/me/profile": {
        status: "success",
        data: {
          id: "7",
          first_name: "Ada",
          last_name: "L",
          email: "a@b",
          username: null,
          last_login: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          version: "2026-01-01T00:00:00Z",
        },
      },
      "/auth/account/tenants": {
        data: [
          {
            tenant_id: "1",
            slug: "school-a",
            name: "School A",
            subdomain: "school-a",
            organization_id: "3",
            organization_name: "Org",
          },
        ],
      },
      "/api/students/ogs-group-navigation": {
        data: [navigationGroup],
      },
      "/api/active/supervisors/all": {
        data: [overviewGroup],
      },
      "/api/me/groups/supervised": {
        data: [ownGroup],
      },
      "/api/rooms/?is_open_room=true": {
        data: [room],
        pagination: page,
      },
      "/api/staff/absences/pending": {
        data: [absence, { ...absence, id: "2" }],
      },
      "/api/messages/unread-count": { data: { unread_count: 4 } },
      "/api/staff-notices/today": {
        data: notices,
      },
      "/api/students/change-requests/pending-count": {
        data: { pending_count: 3 },
      },
      "/api/enrollment/admin/change-requests/pending-count": {
        data: { pending_count: 1 },
      },
      "/api/students/care-withdrawals?page_size=1": {
        data: { total: 5, items: [], page: 1, page_size: 1 },
      },
      "/api/reminders/": { data: { enabled: true, reminders: [], count: 0 } },
      "/api/platform/announcements/unread": { data: [announcement] },
    });

    const shell = await loadShellBootstrap(session(), tenant, ACCESS_TOKEN);

    expect(shell.accountId).toBe("7");
    expect(shell.reminders).toEqual({
      enabled: true,
      reminders: [],
      count: 0,
    });
    expect(shell.announcements).toEqual([announcement]);
    expect(loadUserContext).toHaveBeenCalledWith(
      "access-token",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(shell.userContext?.incomplete).toBe(false);
    // The settings schema stays out of the shell (#4996): the navigation
    // reads its switches from the tenant resolve.
    expect(calledEndpoints()).not.toContain("/api/settings/schema");
    expect(shell.profile?.firstName).toBe("Ada");
    expect(shell.accountTenants?.[0]?.organizationName).toBe("Org");
    expect(shell.supervision).toEqual({
      groups: [navigationGroup],
      supervised: [overviewGroup],
      ownSupervised: [ownGroup],
      openRooms: [room],
      overviewOk: true,
    });
    // The list itself, not only its count (#4989): badge, home block and
    // /tagesinformationen read it from one SWR entry.
    expect(shell.staffNoticesToday).toEqual(
      notices.map((notice) => ({ ...notice, weekdays: [] })),
    );
    expect(shell.counts).toEqual({
      staffAbsencesPending: 2,
      messagesUnread: 4,
      teamChatUnread: undefined,
      changeRequestsPending: 3,
      enrollmentRequestsPending: 1,
      careWithdrawalsPending: 5,
    });
    // Team chat is off for this tenant: not even requested.
    expect(calledEndpoints()).not.toContain("/api/staff-messages/unread-count");
  });

  it("skips the calls a caregiver's hooks would not make, and keeps the rest", async () => {
    routeBackend({
      "/api/me/profile": {
        status: "success",
        data: {
          id: "8",
          first_name: "Bo",
          last_name: "K",
          email: "b@k",
          username: null,
          last_login: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      },
      "/auth/account/tenants": { data: [] },
      "/api/students/ogs-group-navigation": { data: [] },
      "/api/me/groups/supervised": { data: [] },
      "/api/rooms/?is_open_room=true": { data: [], pagination: page },
      "/api/staff-notices/today": { data: [] },
      "/api/messages/unread-count": { data: { unread_count: 2 } },
      "/api/reminders/": { data: { enabled: false, reminders: [], count: 0 } },
      "/api/platform/announcements/unread": { data: [] },
    });

    const shell = await loadShellBootstrap(
      session({
        roles: ["teacher"],
        permissions: ["groups:read", "users:read"],
      }),
      tenant,
      ACCESS_TOKEN,
    );

    expect(shell.supervision?.overviewOk).toBe(false);
    // A caregiver holds users:read, so today's notices are loaded.
    expect(shell.staffNoticesToday).toEqual([]);
    expect(shell.counts).toEqual({
      staffAbsencesPending: undefined,
      // The messages badge needs the tenant flag and users:read (the inbox
      // route's permission); a caregiver holds it, so the count is loaded.
      messagesUnread: 2,
      teamChatUnread: undefined,
      changeRequestsPending: undefined,
      enrollmentRequestsPending: undefined,
      careWithdrawalsPending: undefined,
    });
    const endpoints = calledEndpoints();
    expect(endpoints).not.toContain("/api/settings/schema");
    expect(endpoints).not.toContain("/api/active/supervisors/all");
    expect(endpoints).not.toContain("/api/staff/absences/pending");
  });

  it("leaves the messages badge out for staff without users:read (role Extern, #4573)", async () => {
    routeBackend({
      "/api/me/profile": {
        status: "success",
        data: { id: "9", first_name: "Jo", last_name: "B", email: "j@b" },
      },
      "/auth/account/tenants": { data: [] },
      "/api/students/ogs-group-navigation": { data: [] },
      "/api/me/groups/supervised": { data: [] },
      "/api/rooms/?is_open_room=true": { data: [], pagination: page },
      "/api/staff-notices/today": { data: [] },
      "/api/messages/unread-count": { data: { unread_count: 3 } },
      "/api/platform/announcements/unread": { data: [] },
    });

    const shell = await loadShellBootstrap(
      session({ roles: ["extern"], permissions: ["schedules:read"] }),
      tenant,
      ACCESS_TOKEN,
    );

    expect(shell.counts?.messagesUnread).toBeUndefined();
    // Today's notices need users:read as well; the browser asks no one.
    expect(shell.staffNoticesToday).toBeUndefined();
    const endpoints = calledEndpoints();
    expect(endpoints).toContain("/api/me/groups/supervised");
    expect(endpoints).not.toContain("/api/messages/unread-count");
    expect(endpoints).not.toContain("/api/staff-notices/today");
  });

  it("falls back to the own-supervision endpoint when the overview is refused", async () => {
    routeBackend({
      "/api/me/profile": new Error("500"),
      "/auth/account/tenants": new Error("500"),
      "/api/students/ogs-group-navigation": new Error("500"),
      "/api/active/supervisors/all": new Error("API error (403)"),
      "/api/me/groups/supervised": {
        data: [{ id: 3, group_id: 3, room_id: 2, room: { id: 2, name: "B" } }],
      },
      "/api/rooms/?is_open_room=true": new Error("500"),
      "/api/staff/absences/pending": new Error("500"),
      "/api/messages/unread-count": new Error("500"),
      "/api/staff-notices/today": new Error("500"),
      "/api/students/change-requests/pending-count": new Error("500"),
      "/api/enrollment/admin/change-requests/pending-count": new Error("500"),
      "/api/students/care-withdrawals?page_size=1": new Error("500"),
      "/api/reminders/": new Error("500"),
      "/api/platform/announcements/unread": new Error("500"),
    });
    vi.mocked(loadUserContext).mockRejectedValueOnce(new Error("500"));

    const shell = await loadShellBootstrap(session(), tenant, ACCESS_TOKEN);

    expect(shell.userContext).toBeUndefined();
    expect(shell.profile).toBeUndefined();
    expect(shell.accountTenants).toBeUndefined();
    expect(shell.reminders).toBeUndefined();
    expect(shell.staffNoticesToday).toBeUndefined();
    expect(shell.announcements).toBeUndefined();
    expect(shell.supervision).toBeUndefined();
    expect(Object.values(shell.counts).every((v) => v === undefined)).toBe(
      true,
    );
  });

  it("keeps a successful overview when the ownership request fails", async () => {
    routeBackend({
      "/api/students/ogs-group-navigation": { data: [] },
      "/api/active/supervisors/all": {
        data: [overviewGroup],
      },
      "/api/me/groups/supervised": new Error("500"),
      "/api/rooms/?is_open_room=true": { data: [], pagination: page },
    });

    const shell = await loadShellBootstrap(session(), tenant, ACCESS_TOKEN);

    expect(shell.supervision).toEqual({
      groups: [],
      supervised: [overviewGroup],
      ownSupervised: null,
      openRooms: [],
      overviewOk: true,
    });
  });

  it("does not seed a complete supervision snapshot from a malformed answer", async () => {
    routeBackend({
      "/api/students/ogs-group-navigation": { data: [] },
      "/api/me/groups/supervised": { data: [{ ...ownGroup, id: 1 }] },
      "/api/rooms/?is_open_room=true": { data: [], pagination: page },
    });

    const shell = await loadShellBootstrap(
      session({ roles: ["teacher"], permissions: ["groups:read"] }),
      tenant,
      ACCESS_TOKEN,
    );

    expect(calledEndpoints()).toContain("/api/me/groups/supervised");
    expect(shell.supervision).toBeUndefined();
  });

  it("leaves an incomplete navigation projection to the browser", async () => {
    routeBackend({});
    vi.mocked(loadUserContext).mockResolvedValueOnce({
      educationalGroups: [],
      supervisedGroups: [],
      currentStaff: null,
      educationalGroupIds: [],
      educationalGroupRoomNames: [],
      supervisedRoomNames: [],
      incomplete: true,
      unavailableSections: ["supervised_groups"],
      schoolSwitches: null,
    });

    const shell = await loadShellBootstrap(session(), tenant, ACCESS_TOKEN);

    expect(shell.userContext).toBeUndefined();
  });

  it("aborts timed-out backend preloads", async () => {
    vi.useFakeTimers();
    let profileSignal: AbortSignal | undefined;
    mockBackendAnswer.mockImplementation(
      (
        endpoint: string,
        _token: string,
        options?: { signal?: AbortSignal },
      ) => {
        if (endpoint !== "/api/me/profile") {
          throw new Error(`unrouted ${endpoint}`);
        }
        profileSignal = options?.signal;
        return new Promise((_, reject) => {
          profileSignal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        });
      },
    );

    try {
      const shellPromise = loadShellBootstrap(session(), tenant, ACCESS_TOKEN);
      await vi.advanceTimersByTimeAsync(1500);
      const shell = await shellPromise;

      expect(profileSignal?.aborted).toBe(true);
      expect(shell.profile).toBeUndefined();
    } finally {
      releaseFakeTimers();
    }
  });
});
