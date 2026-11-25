import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ShellBootstrap } from "~/lib/shell-seed";
import type { TenantInfo } from "~/lib/tenant-api";
import { mockSessionData } from "~/test/mocks/next-auth";

// Exercise the real fallback, cacheData, seeder and boundary together.
vi.unmock("swr");
const { mockUseSession, mockAnnounce } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockAnnounce: vi.fn(),
}));
vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: mockUseSession,
  // The server's answer after another tab cleared the owner: no session.
  getSession: async () => null,
}));
vi.mock("~/lib/session-cache", () => ({
  confirmSessionSnapshot: vi.fn(),
  primeSessionCache: vi.fn(),
  announceSessionChange: mockAnnounce,
}));
vi.mock("~/components/auth/personal-storage-guard", () => ({
  PersonalStorageGuard: () => null,
}));
vi.mock("~/components/auth/sentry-session-context", () => ({
  SentrySessionContext: () => null,
}));
vi.mock("~/components/notifications/push-subscription-sync", () => ({
  PushSubscriptionSync: () => null,
}));
vi.mock("~/components/auth/tenant-auth-wrapper", () => ({
  TenantAuthWrapper: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/lib/profile-context", () => ({
  ProfileProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/lib/supervision-context", () => ({
  SupervisionProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/lib/tenant-context", () => ({
  TenantProvider: ({ children }: { children: ReactNode }) => children,
  useTenantSlugSafe: () => "school-a",
}));

import useSWR from "swr";
import { useImmutableSWR } from "~/lib/swr";
import { resetSWRScope, resumeSWRSession } from "~/lib/swr/scope";
import { _resetSessionTreeForTests } from "~/lib/session-tree";
import { TenantProviders } from "~/app/[tenant]/providers";

const session = mockSessionData({ user: { tenantId: "1" } });
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
  reminders: { enabled: true, reminders: [], count: 7 },
  staffNoticesToday: [],
  counts: {},
};

function ShellReader() {
  // Keep the old keys deliberately, so disabling wrapper keys alone cannot
  // hide a fallback that should have been withdrawn.
  const context = useSWR("school-a:1:user-context", null);
  const reminders = useSWR("school-a:1:reminders", null);
  const notices = useSWR("school-a:1:staff-notices-today:1", null);
  const count = [context.data, reminders.data, notices.data].filter(
    (data) => data !== undefined,
  ).length;
  return <p data-testid="shell">{count} seeds</p>;
}

function Page() {
  return (
    <TenantProviders
      sessionMark=""
      tenantSlug="school-a"
      tenant={{ tenantId: "1" } as TenantInfo}
      routingMode="subdomain"
      session={session}
      shell={shell}
    >
      <ShellReader />
    </TenantProviders>
  );
}

afterEach(() => {
  resumeSWRSession();
  resetSWRScope({ revalidate: false });
  // Every test is a new document: no tree of the one before leaves.
  _resetSessionTreeForTests();
});

it.each([
  // Another tab cleared the owner and the server answers no session: for a
  // page without a mark that may be a failed request, so the person loads.
  [null, "moto kann gerade nicht prüfen"],
  // Another tab's session: the person loads again.
  ["1:2", "Seite neu laden"],
])(
  "withdraws the real shell fallback immediately on owner change to %s",
  async (owner, ended) => {
    mockUseSession.mockReturnValue({ data: session, status: "authenticated" });
    const view = render(<Page />);
    // Anker: alle drei echten Shell-Seeds sind sichtbar.
    expect(screen.getByTestId("shell")).toHaveTextContent("3 seeds");
    await act(async () => {
      globalThis.dispatchEvent(
        new StorageEvent("storage", {
          key: "moto:personal-storage-owner",
          newValue: owner,
        }),
      );
    });
    // This document's tree ended for good (#8082), so no reader can see a
    // seed, also not once a lookup answers.
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
    expect(screen.getByText(ended, { exact: false })).toBeVisible();
    expect(mockAnnounce).toHaveBeenCalled();
    mockUseSession.mockReturnValue({
      data: { ...session },
      status: "authenticated",
    });
    view.rerender(<Page />);
    expect(screen.queryByTestId("shell")).not.toBeInTheDocument();
  },
);

it("ends the tree with its seed on a rights change under the same key", async () => {
  // SWR 2.5.1 keeps a hook's cacheData in its revalidate closure ([key,
  // cache]). A seed the seeder wrote into the cache is never consumed, so a
  // revalidation after the reset answered with the seed (#5006 review).
  mockUseSession.mockReturnValue({ data: session, status: "authenticated" });
  const fetcher = vi.fn(() =>
    Promise.resolve({
      ...shell.userContext!,
      currentStaff: { id: "neu", personId: "1" },
    }),
  );
  function ContextReader() {
    const { data } = useImmutableSWR("user-context", fetcher);
    return <p data-testid="context">{data?.currentStaff?.id}</p>;
  }
  function RightsPage() {
    return (
      <TenantProviders
        sessionMark=""
        tenantSlug="school-a"
        tenant={{ tenantId: "1" } as TenantInfo}
        routingMode="subdomain"
        session={session}
        shell={{
          ...shell,
          userContext: {
            ...shell.userContext!,
            currentStaff: { id: "alt", personId: "1" },
          },
        }}
      >
        <ContextReader />
      </TenantProviders>
    );
  }
  const view = render(<RightsPage />);
  // Anker: der Seed steht da, ohne Abruf.
  expect(screen.getByTestId("context")).toHaveTextContent("alt");
  expect(fetcher).not.toHaveBeenCalled();

  mockUseSession.mockReturnValue({
    data: { ...session, user: { ...session.user, permissions: ["x"] } },
    status: "authenticated",
  });
  view.rerender(<RightsPage />);

  // Other rights end the document's tree (#8082): nothing of it, the seed
  // neither, renders again; the next document reads from the server.
  expect(screen.queryByTestId("context")).not.toBeInTheDocument();
  expect(screen.getByText("Seite wird neu geladen...")).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});
