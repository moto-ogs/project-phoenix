import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { ToastProvider } from "~/contexts/ToastContext";
import type { NotificationFeedPage } from "~/lib/notification-feed-helpers";

// Die Glocke des Träger-Portals (#7146): dieselbe Glocke wie in moto schule,
// über die Routen des Träger-Portals, mit dem Namen der Schule am Eintrag,
// ohne Nutzungsanalyse und mit neuem Zähler bei jedem Seitenwechsel.

const state = vi.hoisted(() => ({ pathname: "/traeger/uebersicht" }));

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

// Auf dem Träger-Host fällt das Präfix /traeger weg.
vi.mock("~/lib/traeger-url", () => ({
  traegerPath: (path: string) => path.replace(/^\/traeger/, "") || "/",
}));

import { NotificationFeedBell } from "~/components/dashboard/header/reminders-bell";
import { closeNotificationsSheet } from "~/components/dashboard/header/notifications-sheet-state";
import { TraegerNotificationFeedProvider } from "./traeger-notification-feed";

const PAGE: NotificationFeedPage = {
  entries: [
    {
      id: "1",
      type: "traeger_school_closing_day_changed",
      title: "Neuer Schließtag",
      body: "Am 12.06.2030 ist ein Schließtag: Pädagogischer Tag.",
      deepLink: "/traeger/schulen/42",
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
    <TraegerNotificationFeedProvider>
      <NotificationFeedBell />
    </TraegerNotificationFeedProvider>,
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
  state.pathname = "/traeger/uebersicht";
  api.fetchNotificationFeed.mockResolvedValue(PAGE);
  api.fetchNotificationFeedUnreadCount.mockResolvedValue(1);
  api.markNotificationFeedEntryRead.mockResolvedValue(0);
  api.markAllNotificationFeedRead.mockResolvedValue(0);
});

describe("Glocke im Träger-Portal", () => {
  it("liest über die Route des Träger-Portals und nennt die Schule am Eintrag", async () => {
    renderBell();

    const bell = await screen.findByRole("button", {
      name: /Benachrichtigung/,
    });
    await waitFor(() =>
      expect(api.fetchNotificationFeedUnreadCount).toHaveBeenCalledWith(
        "/api/traeger/notifications/feed",
      ),
    );
    fireEvent.click(bell);

    expect(
      await screen.findByText("Neu · Grundschule Am Bach"),
    ).toBeInTheDocument();
    expect(api.fetchNotificationFeed).toHaveBeenCalledWith(
      "/api/traeger/notifications/feed",
    );

    fireEvent.click(screen.getByText("Neuer Schließtag"));
    expect(api.markNotificationFeedEntryRead).toHaveBeenCalledWith(
      "/api/traeger/notifications/feed",
      "1",
    );
    expect(mockPush).toHaveBeenCalledWith("/schulen/42");
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("lädt den Zähler nach einem Seitenwechsel neu", async () => {
    const view = renderBell();
    await waitFor(() =>
      expect(api.fetchNotificationFeedUnreadCount).toHaveBeenCalledTimes(1),
    );

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(api.fetchNotificationFeedUnreadCount).toHaveBeenCalledTimes(1);

    state.pathname = "/traeger/schliesstage";
    view.rerender(
      <TraegerNotificationFeedProvider>
        <NotificationFeedBell />
      </TraegerNotificationFeedProvider>,
    );

    await waitFor(() =>
      expect(api.fetchNotificationFeedUnreadCount).toHaveBeenCalledTimes(2),
    );
  });
});
