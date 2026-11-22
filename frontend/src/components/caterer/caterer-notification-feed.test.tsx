import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { ToastProvider } from "~/contexts/ToastContext";
import type { NotificationFeedPage } from "~/lib/notification-feed-helpers";

// Die Glocke des Caterer-Portals (#7147): dieselbe Glocke wie im
// Träger-Portal, über die Routen des Caterer-Portals, mit dem Namen der
// Schule am Eintrag, ohne Nutzungsanalyse und mit neuem Zähler bei jedem
// Seitenwechsel.

const state = vi.hoisted(() => ({ pathname: "/" }));

const api = vi.hoisted(() => ({
  fetchNotificationFeed: vi.fn(),
  fetchNotificationFeedUnreadCount: vi.fn(),
  markNotificationFeedEntryRead: vi.fn(),
  markAllNotificationFeedRead: vi.fn(),
}));
vi.mock("~/lib/notification-feed-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/notification-feed-api")>()),
  ...(await import("~/test/mocks/notification-feed-api")).portalFeedApis(api),
}));

// A small stand-in for the scoped SWR hook: readers of one key share one
// entry (like the SWR cache), the first reader runs the real fetcher, and
// mutate() refetches or writes, so the real feed hooks run against the mocked
// API. The global test setup stubs SWR itself.
const swrCache = vi.hoisted(() => ({
  entries: new Map<string, { data?: unknown; error?: unknown }>(),
  listeners: new Set<() => void>(),
}));
vi.mock("~/lib/swr", async () => {
  const React = await import("react");
  const { onSWRScopeReset } = await import("~/lib/swr/scope");
  const write = (key: string, next: { data?: unknown; error?: unknown }) => {
    swrCache.entries.set(key, next);
    for (const listener of swrCache.listeners) listener();
  };
  return {
    onSWRScopeReset,
    useLiveRefreshInterval: (fallback: number) => fallback,
    useSWRAuth: <T,>(key: string | null, fetcher: () => Promise<T>) => {
      const entry = React.useSyncExternalStore(
        (listener) => {
          swrCache.listeners.add(listener);
          return () => swrCache.listeners.delete(listener);
        },
        () => (key === null ? undefined : swrCache.entries.get(key)),
      );
      const fetcherRef = React.useRef(fetcher);
      fetcherRef.current = fetcher;
      const load = React.useCallback(async () => {
        if (key === null) return undefined;
        try {
          const value = await fetcherRef.current();
          write(key, { data: value });
          return value;
        } catch (failure) {
          write(key, { data: swrCache.entries.get(key)?.data, error: failure });
          return undefined;
        }
      }, [key]);
      React.useEffect(() => {
        if (key !== null && !swrCache.entries.has(key)) {
          swrCache.entries.set(key, {});
          void load();
        }
      }, [key, load]);
      const mutate = React.useCallback(
        (next?: T, options?: { revalidate?: boolean }) => {
          if (next !== undefined && key !== null) write(key, { data: next });
          if (next === undefined || options?.revalidate !== false) {
            return load();
          }
          return Promise.resolve(next);
        },
        [key, load],
      );
      const data = entry?.data as T | undefined;
      return {
        data,
        error: entry?.error,
        isLoading: data === undefined,
        mutate,
      };
    },
  };
});

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => state.pathname,
}));

const mockPush = vi.fn();
vi.mock("~/lib/tenant-router", () => ({
  useTenantRouter: () => ({ push: mockPush }),
}));

const mockTrack = vi.fn();
vi.mock("~/lib/analytics", () => ({
  trackTenantEvent: (...args: unknown[]) => mockTrack(...args),
}));

// Auf dem Caterer-Host fällt das Präfix /caterer weg.
vi.mock("~/lib/caterer-url", () => ({
  catererPath: (path: string) => path.replace(/^\/caterer/, "") || "/",
}));

import { NotificationFeedBell } from "~/components/dashboard/header/reminders-bell";
import { closeNotificationsSheet } from "~/components/dashboard/header/notifications-sheet-state";
import { CatererNotificationFeedProvider } from "./caterer-notification-feed";

const PAGE: NotificationFeedPage = {
  entries: [
    {
      id: "1",
      type: "caterer_meal_plan_changed",
      title: "Speiseplan geändert",
      body: "Die Schule hat den Speiseplan für die Woche vom 10.06. bis 14.06.2030 geändert. Bitte prüfe deine Planung.",
      deepLink: "/caterer",
      createdAt: "2026-09-09T09:00:00Z",
      updatedAt: "2026-09-09T09:00:00Z",
      readAt: null,
      schoolName: "Grundschule Am Bach",
    },
  ],
  nextCursor: null,
  unreadCount: 1,
};

function renderBell() {
  return render(
    <CatererNotificationFeedProvider>
      <NotificationFeedBell />
    </CatererNotificationFeedProvider>,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ToastProvider>{children}</ToastProvider>
      ),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  closeNotificationsSheet();
  swrCache.entries.clear();
  state.pathname = "/";
  api.fetchNotificationFeed.mockResolvedValue(PAGE);
  api.fetchNotificationFeedUnreadCount.mockResolvedValue(1);
  api.markNotificationFeedEntryRead.mockResolvedValue(0);
  api.markAllNotificationFeedRead.mockResolvedValue(0);
});

describe("Glocke im Caterer-Portal", () => {
  it("liest über die Route des Caterer-Portals und nennt die Schule am Eintrag", async () => {
    renderBell();

    const bell = await screen.findByRole("button", {
      name: /Benachrichtigung/,
    });
    await waitFor(() =>
      expect(api.fetchNotificationFeedUnreadCount).toHaveBeenCalledWith(
        "/api/caterer/notifications/feed",
      ),
    );
    fireEvent.click(bell);

    expect(
      await screen.findByText("Neu · Grundschule Am Bach"),
    ).toBeInTheDocument();
    expect(api.fetchNotificationFeed).toHaveBeenCalledWith(
      "/api/caterer/notifications/feed",
    );

    fireEvent.click(screen.getByText("Speiseplan geändert"));
    expect(api.markNotificationFeedEntryRead).toHaveBeenCalledWith(
      "/api/caterer/notifications/feed",
      "1",
    );
    expect(mockPush).toHaveBeenCalledWith("/");
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("markiert alle Hinweise über die Route des Caterer-Portals als gelesen", async () => {
    renderBell();

    fireEvent.click(
      await screen.findByRole("button", { name: /Benachrichtigung/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Alle als gelesen markieren/ }),
    );

    await waitFor(() =>
      expect(api.markAllNotificationFeedRead).toHaveBeenCalledWith(
        "/api/caterer/notifications/feed",
      ),
    );
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("lädt den Zähler nach einem Seitenwechsel neu", async () => {
    const view = renderBell();
    await waitFor(() =>
      expect(api.fetchNotificationFeedUnreadCount).toHaveBeenCalledTimes(1),
    );

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(api.fetchNotificationFeedUnreadCount).toHaveBeenCalledTimes(1);

    state.pathname = "/konto";
    view.rerender(
      <CatererNotificationFeedProvider>
        <NotificationFeedBell />
      </CatererNotificationFeedProvider>,
    );

    await waitFor(() =>
      expect(api.fetchNotificationFeedUnreadCount).toHaveBeenCalledTimes(2),
    );
  });
});
