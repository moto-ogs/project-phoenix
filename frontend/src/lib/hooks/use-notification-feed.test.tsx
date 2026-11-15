import { act, renderHook } from "@testing-library/react";
import type { Session } from "next-auth";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationFeedPage } from "~/lib/notification-feed-helpers";
import {
  LIVE_FALLBACK_INTERVAL_MS,
  LIVE_RECONCILE_INTERVAL_MS,
  SWRScopeBoundary,
  useLiveEventScope,
  usePublishLiveChannel,
} from "~/lib/swr";
import { resetSWRScope } from "~/lib/swr/scope";
import { SWRConfig } from "~/lib/swr/testing";
import { useNotificationFeed } from "./use-notification-feed";

vi.unmock("swr");
const state = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: state.session, status: "authenticated" }),
}));
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => "school-a",
}));
const api = vi.hoisted(() => ({
  fetchNotificationFeed: vi.fn(),
  markNotificationFeedEntryRead: vi.fn(),
  markAllNotificationFeedRead: vi.fn(),
}));
vi.mock("~/lib/notification-feed-api", () => ({
  ...api,
  NOTIFICATION_FEED_REFRESH_EVENT: "notification-feed-refresh",
}));

function page(
  id: string,
  nextCursor: string | null = null,
): NotificationFeedPage {
  return {
    entries: [
      {
        id,
        type: "instance_cancelled",
        title: "Termin abgesagt",
        body: "Schach fällt aus.",
        deepLink: "/mein-dienstplan",
        createdAt: "2026-09-09T09:00:00Z",
        updatedAt: "2026-09-09T09:00:00Z",
        readAt: null,
      },
    ],
    nextCursor,
    unreadCount: 1,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <SWRScopeBoundary />
      {children}
    </SWRConfig>
  );
}

function renderFeed(connected = false) {
  const onUnreadCount = vi.fn();
  return {
    ...renderHook(
      () => {
        const { scope } = useLiveEventScope();
        usePublishLiveChannel(scope, connected);
        return useNotificationFeed(onUnreadCount);
      },
      { wrapper },
    ),
    onUnreadCount,
  };
}

async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function changePermissions() {
  state.session = {
    user: { id: "account-7", tenantId: 42, permissions: ["groups:read"] },
    expires: "2099-01-01",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetSWRScope({ revalidate: false });
  state.session = {
    user: { id: "account-7", tenantId: 42 },
    expires: "2099-01-01",
  };
  api.fetchNotificationFeed.mockImplementation((cursor?: string) =>
    Promise.resolve(cursor ? page("older") : page("first", "c2")),
  );
  api.markNotificationFeedEntryRead.mockResolvedValue(0);
  api.markAllNotificationFeedRead.mockResolvedValue(0);
});

describe("notification feed reconciliation", () => {
  it("clears loaded pages and optimistic read state after a same-account permissions change", async () => {
    const feed = renderFeed();
    await advance();
    await act(() => feed.result.current.loadMore());
    expect(feed.result.current.items.map(({ entry }) => entry.id)).toEqual([
      "first",
      "older",
    ]);
    await act(() =>
      feed.result.current.markRead(feed.result.current.items[0]!),
    );
    await act(() => feed.result.current.markAllRead());
    expect(feed.result.current.items.every(({ unread }) => !unread)).toBe(true);

    changePermissions();
    feed.rerender();
    await advance();

    expect(feed.result.current.items.map(({ entry }) => entry.id)).toEqual([
      "first",
    ]);
    expect(feed.result.current.items[0]?.unread).toBe(true);
    expect(feed.result.current.hasMore).toBe(true);
  });

  it.each([false, true])(
    "discards a pending page after a scope reset (failure: %s)",
    async (fails) => {
      const feed = renderFeed();
      await advance();
      let settle!: () => void;
      api.fetchNotificationFeed.mockImplementationOnce(
        () =>
          new Promise<NotificationFeedPage>((resolve, reject) => {
            settle = () =>
              fails ? reject(new Error("old request")) : resolve(page("late"));
          }),
      );
      let pending!: Promise<void>;
      act(() => {
        pending = feed.result.current.loadMore();
      });
      expect(feed.result.current.loadingMore).toBe(true);

      changePermissions();
      feed.rerender();
      await advance();
      expect(feed.result.current.items[0]?.entry.id).toBe("first");
      expect(feed.result.current.loadingMore).toBe(false);
      await act(async () => {
        settle();
        await pending;
      });

      expect(feed.result.current.items.map(({ entry }) => entry.id)).toEqual([
        "first",
      ]);
      expect(feed.result.current.error).toBeNull();
      expect(feed.result.current.hasMore).toBe(true);
    },
  );

  it.each([false, true])(
    "recovers a missed event and drops old pagination (SSE connected: %s)",
    async (connected) => {
      const feed = renderFeed(connected);
      await advance();
      await act(() => feed.result.current.loadMore());
      expect(feed.result.current.items.map(({ entry }) => entry.id)).toEqual([
        "first",
        "older",
      ]);
      api.fetchNotificationFeed.mockResolvedValue({
        ...page("new", "new-cursor"),
        unreadCount: 2,
      });

      const interval = connected
        ? LIVE_RECONCILE_INTERVAL_MS
        : LIVE_FALLBACK_INTERVAL_MS;
      await advance(interval - 1);
      expect(feed.result.current.items[0]?.entry.id).toBe("first");
      await advance(1);

      expect(feed.result.current.items.map(({ entry }) => entry.id)).toEqual([
        "new",
      ]);
      expect(feed.onUnreadCount).toHaveBeenLastCalledWith(2);
      await act(() => feed.result.current.loadMore());
      expect(api.fetchNotificationFeed).toHaveBeenLastCalledWith(
        "new-cursor",
        "/api/notifications/feed",
      );
    },
  );

  it("discards a page that finishes after periodic reconciliation", async () => {
    const feed = renderFeed();
    await advance();
    let resolvePage!: (value: NotificationFeedPage) => void;
    api.fetchNotificationFeed.mockImplementationOnce(
      () =>
        new Promise<NotificationFeedPage>((resolve) => {
          resolvePage = resolve;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = feed.result.current.loadMore();
    });
    api.fetchNotificationFeed.mockResolvedValue(page("new", "new-cursor"));

    await advance(LIVE_FALLBACK_INTERVAL_MS);
    expect(feed.result.current.items[0]?.entry.id).toBe("new");
    await act(async () => {
      resolvePage(page("late"));
      await pending;
    });

    expect(feed.result.current.items.map(({ entry }) => entry.id)).toEqual([
      "new",
    ]);
    expect(feed.result.current.loadingMore).toBe(false);
    expect(feed.result.current.hasMore).toBe(true);
  });

  it.each(["entry", "all"])(
    "ignores a late %s read response from the previous session",
    async (kind) => {
      const feed = renderFeed();
      await advance();
      let resolveRead!: (value: number) => void;
      const response = new Promise<number>((resolve) => {
        resolveRead = resolve;
      });
      api.markNotificationFeedEntryRead.mockReturnValue(response);
      api.markAllNotificationFeedRead.mockReturnValue(response);
      let pending!: Promise<void>;
      act(() => {
        pending =
          kind === "entry"
            ? feed.result.current.markRead(feed.result.current.items[0]!)
            : feed.result.current.markAllRead();
      });

      changePermissions();
      feed.rerender();
      await advance();
      expect(feed.result.current.items[0]?.unread).toBe(true);
      feed.onUnreadCount.mockClear();
      await act(async () => {
        resolveRead(0);
        await pending;
      });

      expect(feed.result.current.items[0]?.unread).toBe(true);
      expect(feed.onUnreadCount).not.toHaveBeenCalled();
    },
  );
});
