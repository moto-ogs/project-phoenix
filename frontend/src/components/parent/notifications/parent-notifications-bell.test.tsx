import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

import { ToastProvider } from "~/contexts/ToastContext";
import deMessages from "~/i18n/messages/de.generated";
import { NOTIFICATION_FEED_REFRESH_EVENT } from "~/lib/notification-events";
import type { NotificationFeedPage } from "~/lib/notification-feed-helpers";

// The bell of the parents portal (#7140) against its own mocked routes: the
// real feed hooks, list and popover run; only the HTTP calls, SWR's cache,
// the router and the analytics are stand-ins.

const state = vi.hoisted(() => ({
  page: {
    entries: [],
    nextCursor: null,
    unreadCount: 0,
  } as NotificationFeedPage,
  unread: 0,
}));

const parentApi = vi.hoisted(() => ({
  fetchPage: vi.fn(),
  fetchUnreadCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));
const staffApi = vi.hoisted(() => ({
  fetchNotificationFeed: vi.fn(),
  fetchNotificationFeedUnreadCount: vi.fn(),
}));
vi.mock("~/lib/notification-feed-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/notification-feed-api")>()),
  ...staffApi,
  parentNotificationFeedApi: parentApi,
}));

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
        const value = await fetcherRef.current();
        write(key, { data: value });
        return value;
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
      return {
        data: entry?.data as T | undefined,
        error: entry?.error,
        mutate,
      };
    },
  };
});

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockTrack = vi.fn();
vi.mock("~/lib/analytics", () => ({
  trackEvent: (...args: unknown[]) => mockTrack(...args),
}));

import { ParentNotificationsBell } from "./parent-notifications-bell";

function entry(
  id: string,
  over: Partial<NotificationFeedPage["entries"][number]> = {},
) {
  return {
    id,
    type: "parent_care_cancelled",
    title: "Fußball-AG am Dienstag entfällt",
    body: "Die Fußball-AG fällt aus.",
    deepLink: "/news",
    createdAt: "2026-09-09T09:00:00Z",
    updatedAt: "2026-09-09T09:00:00Z",
    readAt: null,
    ...over,
  };
}

function renderBell() {
  return render(<ParentNotificationsBell />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="de" messages={deMessages}>
        <ToastProvider>{children}</ToastProvider>
      </NextIntlClientProvider>
    ),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  swrCache.entries.clear();
  state.page = { entries: [entry("1")], nextCursor: null, unreadCount: 1 };
  state.unread = 1;
  parentApi.fetchPage.mockImplementation(() => Promise.resolve(state.page));
  parentApi.fetchUnreadCount.mockImplementation(() =>
    Promise.resolve(state.unread),
  );
  parentApi.markRead.mockResolvedValue(0);
  parentApi.markAllRead.mockResolvedValue(0);
});

describe("ParentNotificationsBell", () => {
  it("shows 9+ from ten unread notices", async () => {
    state.unread = 12;
    renderBell();
    const bell = await screen.findByRole("button", {
      name: "9+ Hinweise, insgesamt 12",
    });
    expect(bell).toHaveTextContent("9+");
    expect(staffApi.fetchNotificationFeedUnreadCount).not.toHaveBeenCalled();
  });

  it("opens without reading, and a click reads the notice and opens its link", async () => {
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: "Hinweise: 1" }));

    const row = await screen.findByText("Fußball-AG am Dienstag entfällt");
    expect(
      screen.getByRole("region", { name: "Für deine Kinder" }),
    ).toBeInTheDocument();
    expect(parentApi.markRead).not.toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith("notification_bell_opened");

    fireEvent.click(row);
    await waitFor(() => expect(parentApi.markRead).toHaveBeenCalledWith("1"));
    expect(mockPush).toHaveBeenCalledWith("/news");
    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith(
        "notification_feed_entry_clicked",
        {
          notification_type: "parent_care_cancelled",
        },
      ),
    );
  });

  it("marks all as read and reloads on a live change", async () => {
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: "Hinweise: 1" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Alle als gelesen markieren" }),
    );
    await waitFor(() => expect(parentApi.markAllRead).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith("notification_feed_all_read"),
    );

    state.page = {
      entries: [entry("2", { title: "Schach fällt aus" }), entry("1")],
      nextCursor: null,
      unreadCount: 1,
    };
    const calls = parentApi.fetchPage.mock.calls.length;
    act(() => {
      window.dispatchEvent(new CustomEvent(NOTIFICATION_FEED_REFRESH_EVENT));
    });
    expect(
      await screen.findByText("Schach fällt aus", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(parentApi.fetchPage.mock.calls.length).toBeGreaterThan(calls);
  });
});
