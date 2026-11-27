import type React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantInfo } from "~/lib/tenant-api";
import type { ShellBootstrap } from "~/lib/shell-seed";
import { mockSessionData } from "~/test/mocks/next-auth";

/**
 * TenantProviders with a server snapshot (#2973): the session primes the
 * getSession() cache before any child effect, the SWR entries land under the
 * tenant-scoped keys, and the providers receive their initial values.
 */

const {
  mockSessionProvider,
  mockUseSession,
  mockSWRConfig,
  mockProfileProvider,
  mockSupervisionProvider,
  mockPrimeSessionCache,
  mockSwrMutate,
  mockUnload,
  childEffectOrder,
} = vi.hoisted(() => ({
  mockUnload: vi.fn(),
  mockSessionProvider: vi.fn(),
  mockUseSession: vi.fn(),
  mockSWRConfig: vi.fn(),
  mockProfileProvider: vi.fn(),
  mockSupervisionProvider: vi.fn(),
  mockPrimeSessionCache: vi.fn(),
  mockSwrMutate: vi.fn(),
  childEffectOrder: [] as string[],
}));

vi.mock("next-auth/react", () => ({
  SessionProvider: (props: { children: React.ReactNode }) => {
    mockSessionProvider(props);
    return props.children;
  },
  useSession: mockUseSession,
}));

vi.mock("swr", () => ({
  SWRConfig: (props: { children: React.ReactNode; value: unknown }) => {
    mockSWRConfig(props.value);
    return props.children;
  },
  mutate: (...args: unknown[]) => {
    childEffectOrder.push(`seed ${String(args[0])}`);
    mockSwrMutate(...args);
  },
  unload: mockUnload,
}));

vi.mock("~/lib/session-cache", () => ({
  confirmSessionSnapshot: vi.fn(),
  primeSessionCache: (...args: unknown[]) => {
    childEffectOrder.push("prime");
    mockPrimeSessionCache(...args);
  },
}));

vi.mock("~/components/notifications/push-subscription-sync", () => ({
  PushSubscriptionSync: () => null,
}));

vi.mock("~/components/auth/tenant-auth-wrapper", () => ({
  TenantAuthWrapper: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/lib/profile-context", () => ({
  ProfileProvider: (props: { children: React.ReactNode }) => {
    mockProfileProvider(props);
    return props.children;
  },
}));

vi.mock("~/lib/supervision-context", () => ({
  SupervisionProvider: (props: { children: React.ReactNode }) => {
    mockSupervisionProvider(props);
    return props.children;
  },
}));

vi.mock("~/lib/tenant-context", () => ({
  TenantProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const { TenantProviders } = await import("./providers");
const { useLayoutEffect } = await import("react");
const { _resetSessionTreeForTests } = await import("~/lib/session-tree");

function ChildWithLayoutEffect() {
  useLayoutEffect(() => {
    childEffectOrder.push("child");
  }, []);
  return null;
}

const tenant = { tenantId: "1", subdomain: "school-a" } as TenantInfo;
const session = mockSessionData();

const shell: ShellBootstrap = {
  accountId: "1",
  userContext: {
    currentStaff: null,
    schoolSwitches: {
      parentNewsEnabled: true,
      parentInviteMode: "direct",
      timetableDayStartTime: "08:00",
      timetableDayEndTime: "16:00",
    },
  },
  profile: {
    firstName: "Ada",
    lastName: "L",
    email: "a@b",
    version: "v1",
  },
  reminders: { enabled: true, reminders: [], count: 0 },
  staffNoticesToday: [],
  announcements: [],
  supervision: {
    groups: {
      status: "ok",
      navigation: [],
      own_group_ids: [],
      own_room_names: [],
    },
    sessions: {
      status: "ok",
      own_status: "ok",
      overview_status: "forbidden",
      items: [],
    },
    released_rooms: { status: "ok", items: [] },
  },
  counts: { messagesUnread: 2 },
};

afterEach(() => {
  vi.clearAllMocks();
  childEffectOrder.length = 0;
});

beforeEach(() => {
  // Every test is a new document: no tree of the one before leaves.
  _resetSessionTreeForTests();
  mockUseSession.mockReturnValue({ data: session, status: "authenticated" });
});

describe("TenantProviders with a server snapshot", () => {
  it("hydrates SessionProvider with the read-only server session", () => {
    render(
      <TenantProviders
        sessionMark=""
        tenantSlug="school-a"
        tenant={tenant}
        routingMode="subdomain"
        session={session}
        shell={shell}
      >
        <div />
      </TenantProviders>,
    );

    expect(mockSessionProvider).toHaveBeenCalledWith(
      expect.objectContaining({ session }),
    );
  });

  it("leaves a missing server snapshot for Auth.js to resolve", () => {
    render(
      <TenantProviders
        sessionMark=""
        tenantSlug="school-a"
        tenant={tenant}
        routingMode="subdomain"
      >
        <div />
      </TenantProviders>,
    );

    expect(mockSessionProvider).toHaveBeenCalledWith(
      expect.objectContaining({ session: undefined }),
    );
  });

  it("primes the session cache before any child layout effect runs", () => {
    render(
      <TenantProviders
        sessionMark=""
        tenantSlug="school-a"
        tenant={tenant}
        routingMode="subdomain"
        session={session}
        shell={shell}
      >
        <ChildWithLayoutEffect />
      </TenantProviders>,
    );

    expect(mockPrimeSessionCache).toHaveBeenCalledWith(session);
    expect(childEffectOrder).toEqual([
      "prime",
      "seed school-a:1:user-context",
      "seed school-a:1:staff-supervision-context",
      "seed school-a:1:reminders",
      "seed school-a:1:user-announcements-unread",
      "seed school-a:1:staff-notices-today:1",
      "seed school-a:1:badge-messages-unread:1",
      "child",
    ]);
  });

  // Their readers never revalidate on mount; without the cache entry the
  // first poll or mutate answered with the seed instead of the server (#4989).
  it("writes the shell-owned entries into the cache without fetching", () => {
    render(
      <TenantProviders
        sessionMark=""
        tenantSlug="school-a"
        tenant={tenant}
        routingMode="subdomain"
        session={session}
        shell={shell}
      >
        <div />
      </TenantProviders>,
    );

    expect(mockSwrMutate).toHaveBeenCalledTimes(6);
    for (const [key, seed] of [
      ["school-a:1:user-context", shell.userContext],
      ["school-a:1:staff-supervision-context", shell.supervision],
      ["school-a:1:reminders", shell.reminders],
      ["school-a:1:user-announcements-unread", shell.announcements],
      ["school-a:1:staff-notices-today:1", shell.staffNoticesToday],
      // A badge count the server loaded; a count it left out seeds nothing.
      ["school-a:1:badge-messages-unread:1", shell.counts.messagesUnread],
    ] as const) {
      const call = mockSwrMutate.mock.calls.find(([k]) => k === key);
      expect(call?.[2]).toEqual(expect.objectContaining({ revalidate: false }));
      const write = call?.[1] as (current: unknown) => unknown;
      // An entry a reader already holds stays.
      expect(write(undefined)).toBe(seed);
      expect(write("held")).toBe("held");
    }
  });

  it("withdraws the server preload once the session is another one", () => {
    // Same account and keys, other rights: the snapshot of the session
    // before must not reach a reader any more (#5006).
    const view = render(
      <TenantProviders
        sessionMark=""
        tenantSlug="school-a"
        tenant={tenant}
        routingMode="subdomain"
        session={session}
        shell={shell}
      >
        <div />
      </TenantProviders>,
    );
    // Anker: die erste Darstellung bekommt den Seed.
    expect(mockSWRConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fallback: expect.objectContaining({
          "school-a:1:user-context": shell.userContext,
          "school-a:1:staff-supervision-context": shell.supervision,
        }),
      }),
    );

    const before = mockSWRConfig.mock.calls.length;
    mockUseSession.mockReturnValue({
      data: { ...session, user: { ...session.user, permissions: ["x"] } },
      status: "authenticated",
    });
    const page = (
      <TenantProviders
        sessionMark=""
        tenantSlug="school-a"
        tenant={tenant}
        routingMode="subdomain"
        session={session}
        shell={shell}
      >
        <div />
      </TenantProviders>
    );
    view.rerender(page);
    // Other rights end the document's tree (#8082): no reader of it, nor
    // the seed, renders again; the next document reads from the server.
    expect(screen.getByText("Seite wird neu geladen...")).toBeInTheDocument();
    // Back to the first session: nothing of the tree comes back.
    mockUseSession.mockReturnValue({ data: session, status: "authenticated" });
    view.rerender(page);
    expect(
      mockSWRConfig.mock.calls
        .slice(before)
        .some(([config]) =>
          Object.keys(
            (config as { fallback?: object }).fallback ?? {},
          ).includes("school-a:1:user-context"),
        ),
    ).toBe(false);
  });

  it("renders without SWRConfig and with empty seeds when there is no snapshot", () => {
    render(
      <TenantProviders
        sessionMark=""
        tenantSlug="school-a"
        tenant={tenant}
        routingMode="subdomain"
        session={session}
      >
        <div />
      </TenantProviders>,
    );

    expect(mockSWRConfig).not.toHaveBeenCalled();
    expect(mockPrimeSessionCache).toHaveBeenCalledWith(session);
    expect(mockProfileProvider).toHaveBeenCalledWith(
      expect.objectContaining({ initialProfile: null }),
    );
  });
});
