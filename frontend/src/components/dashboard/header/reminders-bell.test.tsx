import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";

import { ToastProvider } from "~/contexts/ToastContext";
import type { NotificationFeedPage } from "~/lib/notification-feed-helpers";
import type { Reminder } from "~/lib/reminders-api";
import { useTenantSafe } from "~/lib/tenant-context";

const state = vi.hoisted(() => ({
  phone: false,
  feedPages: new Map<string, NotificationFeedPage>(),
  unreadCount: 0,
}));

const mockUseReminders = vi.fn();
vi.mock("~/lib/hooks/use-reminders", () => ({
  useReminders: () => mockUseReminders(),
}));

const api = vi.hoisted(() => ({
  fetchNotificationFeed: vi.fn(),
  fetchNotificationFeedUnreadCount: vi.fn(),
  markNotificationFeedEntryRead: vi.fn(),
  markAllNotificationFeedRead: vi.fn(),
}));
vi.mock("~/lib/notification-feed-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/notification-feed-api")>()),
  ...api,
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

vi.mock("~/lib/hooks/use-media-query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/hooks/use-media-query")>();
  return {
    ...actual,
    useMediaQuery: (query: string) =>
      query === actual.BELOW_SM ? state.phone : false,
  };
});

const mockPush = vi.fn();
vi.mock("~/lib/tenant-router", () => ({
  useTenantRouter: () => ({ push: mockPush }),
}));

const mockTrack = vi.fn();
vi.mock("~/lib/analytics", () => ({
  trackTenantEvent: (...args: unknown[]) => mockTrack(...args),
}));

// moto schule (#7139): the session names the school; on the school host
// schoolPath drops the /school prefix.
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { tenantId: "5", id: "11" } },
    status: "authenticated",
  }),
}));
vi.mock("~/lib/school-url", () => ({
  schoolPath: (path: string) => path.replace(/^\/school/, "") || "/",
}));

import { SchoolNotificationFeedProvider } from "~/components/school/shell/school-notification-feed";
import { NotificationsSheet } from "./notifications-panel";
import { closeNotificationsSheet } from "./notifications-sheet-state";
import { NotificationFeedBell, RemindersBell } from "./reminders-bell";

function reminder(over: Partial<Reminder> = {}): Reminder {
  return {
    type: "pickup_upcoming",
    student_id: "1",
    title: "Kind",
    due_time: "10:00",
    minutes_away: 10,
    ...over,
  };
}

function setReminders(value: {
  reminders?: Reminder[];
  count?: number;
  enabled?: boolean;
}) {
  mockUseReminders.mockReturnValue({
    reminders: value.reminders ?? [],
    count: value.count ?? value.reminders?.length ?? 0,
    enabled: value.enabled ?? true,
  });
}

let entryCounter = 0;
function entry(over: Partial<NotificationFeedPage["entries"][number]> = {}) {
  entryCounter += 1;
  return {
    id: String(entryCounter),
    type: "instance_cancelled",
    title: "Termin abgesagt",
    body: `Schach am Freitag, 20.11., fällt aus. (${entryCounter})`,
    deepLink: "/mein-dienstplan?d=2026-11-20",
    createdAt: "2026-09-09T09:00:00Z",
    updatedAt: "2026-09-09T09:00:00Z",
    readAt: null,
    ...over,
  };
}

function setFeed(
  entries: NotificationFeedPage["entries"],
  nextCursor: string | null = null,
  cursor = "",
) {
  state.feedPages.set(cursor, {
    entries,
    nextCursor,
    unreadCount: entries.filter((e) => e.readAt === null).length,
  });
}

function setUnread(count: number) {
  state.unreadCount = count;
}

function renderBell() {
  // The phone sheet lives once in the bottom nav; render it beside the bell.
  return render(
    <>
      <RemindersBell />
      <NotificationsSheet />
    </>,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ToastProvider>{children}</ToastProvider>
      ),
    },
  );
}

async function openBell(name: string | RegExp = /Benachrichtigungen/) {
  const bell = await screen.findByRole("button", { name });
  fireEvent.click(bell);
  return bell;
}

beforeEach(() => {
  vi.clearAllMocks();
  closeNotificationsSheet();
  swrCache.entries.clear();
  entryCounter = 0;
  state.phone = false;
  state.feedPages.clear();
  setFeed([]);
  setUnread(0);
  vi.mocked(useTenantSafe).mockReturnValue({
    tenantSlug: "test-tenant",
    tenant: { tenantId: 7 },
  } as unknown as ReturnType<typeof useTenantSafe>);
  api.fetchNotificationFeed.mockImplementation(
    (_base: string, cursor?: string | null) =>
      Promise.resolve(
        state.feedPages.get(cursor ?? "") ?? {
          entries: [],
          nextCursor: null,
          unreadCount: 0,
        },
      ),
  );
  api.fetchNotificationFeedUnreadCount.mockImplementation(() =>
    Promise.resolve(state.unreadCount),
  );
  api.markNotificationFeedEntryRead.mockResolvedValue(0);
  api.markAllNotificationFeedRead.mockResolvedValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RemindersBell — Erinnerungen", () => {
  it("shows only the Hinweise while the school has no reminder type on", async () => {
    setReminders({ enabled: false, reminders: [reminder()], count: 1 });
    setFeed([entry({ title: "Termin abgesagt" })]);
    renderBell();

    await openBell("Benachrichtigungen");
    // Anker: der Feed-Abschnitt ist geladen.
    expect(await screen.findByText("Termin abgesagt")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Erinnerungen" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Alle ansehen")).not.toBeInTheDocument();
  });

  it("shows both sections, Erinnerungen above the Hinweise", async () => {
    setReminders({
      enabled: true,
      count: 2,
      reminders: [
        reminder({
          type: "pickup_overdue",
          title: "Hannah Klein",
          subtitle: "Klasse 1b",
          minutes_away: -26,
          due_time: "10:44",
        }),
        reminder({
          type: "activity_start",
          student_id: undefined,
          activity_instance_id: "81",
          title: "Schach",
          minutes_away: 10,
          due_time: "11:10",
        }),
      ],
    });
    setFeed([entry({ title: "Termin abgesagt" })]);
    renderBell();

    await openBell();
    expect(await screen.findByText("Termin abgesagt")).toBeInTheDocument();
    const reminders = screen.getByRole("region", { name: "Erinnerungen" });
    const feed = screen.getByRole("region", { name: "Hinweise" });
    expect(within(reminders).getByText("Hannah Klein")).toBeInTheDocument();
    expect(within(reminders).getByText("Klasse 1b")).toBeInTheDocument();
    expect(within(reminders).getByText("Schach")).toBeInTheDocument();
    expect(
      reminders.compareDocumentPosition(feed) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("colors only the overdue label red", async () => {
    setReminders({
      enabled: true,
      count: 2,
      reminders: [
        reminder({ title: "Hannah", type: "pickup_overdue", minutes_away: -5 }),
        reminder({
          title: "Schach",
          type: "activity_start",
          student_id: undefined,
          activity_instance_id: "81",
          minutes_away: 10,
        }),
      ],
    });
    renderBell();
    await openBell("2 Benachrichtigungen");

    expect(screen.getByText("5 Min überfällig").className).toContain(
      "text-moto-red",
    );
    expect(screen.getByText("in 10 Min").className).toContain("text-gray-500");
  });

  it("previews at most five reminders and notes the overflow", async () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      reminder({
        student_id: String(i + 1),
        title: `Kind ${i}`,
        minutes_away: i + 1,
      }),
    );
    setReminders({ enabled: true, count: 7, reminders: many });
    renderBell();
    await openBell("7 Benachrichtigungen");

    expect(screen.getByText("Kind 0")).toBeInTheDocument();
    expect(screen.getByText("Kind 4")).toBeInTheDocument();
    expect(screen.queryByText("Kind 5")).not.toBeInTheDocument();
    expect(screen.getByText("+2 weitere")).toBeInTheDocument();
  });

  it("links to the full reminders page and closes after navigating", async () => {
    setReminders({ enabled: true, count: 1, reminders: [reminder()] });
    renderBell();

    const button = await screen.findByRole("button", {
      name: "1 Benachrichtigung",
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");

    // Tenant-aware href: in path mode the link keeps the tenant segment.
    const link = screen.getByRole("link", { name: "Alle ansehen" });
    expect(link).toHaveAttribute("href", "/test-tenant/reminders");
    fireEvent.click(link);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape and on an outside click, not on an inside click", async () => {
    setReminders({ enabled: true, count: 1, reminders: [reminder()] });
    renderBell();
    const button = await openBell("1 Benachrichtigung");

    fireEvent.mouseDown(screen.getByText("Alle ansehen"));
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.mouseDown(document.body);
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});

describe("RemindersBell — Zähler", () => {
  it("shows the bell without a badge when nothing is new", async () => {
    setReminders({ enabled: true, reminders: [], count: 0 });
    renderBell();

    await openBell("Benachrichtigungen");
    expect(screen.getByText("Keine aktiven Erinnerungen.")).toBeInTheDocument();
    expect(await screen.findByText("Keine Hinweise.")).toBeInTheDocument();
  });

  it("counts unread Hinweise plus active Erinnerungen", async () => {
    setReminders({ enabled: true, count: 2, reminders: [reminder()] });
    setUnread(3);
    renderBell();

    const bell = await screen.findByRole("button", {
      name: "5 Benachrichtigungen",
    });
    expect(bell).toBeInTheDocument();
    expect(
      within(bell).getByLabelText("5 Benachrichtigungen"),
    ).toHaveTextContent("5");
  });

  it("does not count reminders while the school has them switched off", async () => {
    setReminders({ enabled: false, count: 4, reminders: [reminder()] });
    setUnread(2);
    renderBell();

    expect(
      await screen.findByRole("button", { name: "2 Benachrichtigungen" }),
    ).toBeInTheDocument();
  });

  it("shows 9 and caps at 9+ from 10", async () => {
    setReminders({ enabled: false });
    setUnread(9);
    const view = renderBell();
    expect(await screen.findByText("9")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "9 Benachrichtigungen" }),
    ).toBeInTheDocument();
    view.unmount();
    swrCache.entries.clear();

    setUnread(10);
    renderBell();
    expect(await screen.findByText("9+")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "9+ Benachrichtigungen, insgesamt 10",
      }),
    ).toBeInTheDocument();
  });

  it("updates live when the feed changes, also from another device", async () => {
    setReminders({ enabled: false });
    setUnread(1);
    setFeed([entry({ title: "Erster Hinweis" })]);
    renderBell();
    await openBell("1 Benachrichtigung");
    expect(await screen.findByText("Erster Hinweis")).toBeInTheDocument();

    setUnread(2);
    setFeed([
      entry({ title: "Neuer Hinweis", updatedAt: "2026-09-09T09:30:00Z" }),
      entry({ title: "Erster Hinweis" }),
    ]);
    act(() => {
      window.dispatchEvent(new CustomEvent("notification-feed-refresh"));
    });

    expect(await screen.findByText("Neuer Hinweis")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "2 Benachrichtigungen" }),
    ).toBeInTheDocument();
  });
});

describe("RemindersBell — Hinweise", () => {
  it("opening the bell marks nothing as read", async () => {
    setReminders({ enabled: false });
    setUnread(1);
    setFeed([entry({ title: "Termin abgesagt" })]);
    renderBell();
    await openBell("1 Benachrichtigung");

    expect(await screen.findByText("Termin abgesagt")).toBeInTheDocument();
    expect(screen.getByText("Neu")).toBeInTheDocument();
    expect(api.markNotificationFeedEntryRead).not.toHaveBeenCalled();
    expect(api.markAllNotificationFeedRead).not.toHaveBeenCalled();
  });

  it("a click marks the entry read, navigates to its day and closes", async () => {
    setReminders({ enabled: false });
    setUnread(1);
    setFeed([entry({ id: "41", title: "Termin abgesagt" })]);
    renderBell();
    const bell = await openBell("1 Benachrichtigung");

    fireEvent.click(
      await screen.findByRole("button", { name: /Termin abgesagt/ }),
    );

    expect(api.markNotificationFeedEntryRead).toHaveBeenCalledWith(
      "/api/notifications/feed",
      "41",
    );
    expect(mockPush).toHaveBeenCalledWith("/mein-dienstplan?d=2026-11-20");
    expect(bell).toHaveAttribute("aria-expanded", "false");
    expect(
      await screen.findByRole("button", { name: "Benachrichtigungen" }),
    ).toBeInTheDocument();
    expect(mockTrack).toHaveBeenCalledWith(
      "notification_feed_entry_clicked",
      "7",
      { notification_type: "instance_cancelled" },
    );
  });

  it("does not navigate to a link that leaves moto, but still marks it read", async () => {
    setReminders({ enabled: false });
    setUnread(1);
    setFeed([
      entry({ id: "42", title: "Fremder Link", deepLink: "//evil.example/x" }),
    ]);
    renderBell();
    const bell = await openBell("1 Benachrichtigung");

    fireEvent.click(
      await screen.findByRole("button", { name: /Fremder Link/ }),
    );

    expect(api.markNotificationFeedEntryRead).toHaveBeenCalledWith(
      "/api/notifications/feed",
      "42",
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(bell).toHaveAttribute("aria-expanded", "true");
  });

  it("does not post again for an entry that is already read", async () => {
    setReminders({ enabled: false });
    setFeed([
      entry({ title: "Schon gelesen", readAt: "2026-09-09T10:00:00Z" }),
    ]);
    renderBell();
    await openBell("Benachrichtigungen");

    fireEvent.click(
      await screen.findByRole("button", { name: /Schon gelesen/ }),
    );
    expect(mockPush).toHaveBeenCalled();
    expect(api.markNotificationFeedEntryRead).not.toHaveBeenCalled();
  });

  it("marks all as read with one click and hides the button", async () => {
    setReminders({ enabled: false });
    setUnread(2);
    setFeed([entry({ title: "Eins" }), entry({ title: "Zwei" })]);
    renderBell();
    await openBell("2 Benachrichtigungen");
    expect(await screen.findByText("Eins")).toBeInTheDocument();
    expect(screen.getAllByText("Neu")).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("button", { name: "Alle als gelesen markieren" }),
    );

    expect(
      await screen.findByRole("button", { name: "Benachrichtigungen" }),
    ).toBeInTheDocument();
    expect(api.markAllNotificationFeedRead).toHaveBeenCalledTimes(1);
    // Anker: die Liste steht noch da, nur ohne „Neu“.
    expect(screen.getByText("Zwei")).toBeInTheDocument();
    expect(screen.queryByText("Neu")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Alle als gelesen markieren" }),
    ).not.toBeInTheDocument();
    expect(mockTrack).toHaveBeenCalledWith("notification_feed_all_read", "7");
  });

  it("shows a failed „Alle als gelesen“ as a message and keeps the entries unread", async () => {
    setReminders({ enabled: false });
    setUnread(1);
    setFeed([entry({ title: "Eins" })]);
    api.markAllNotificationFeedRead.mockRejectedValue(new Error("offline"));
    renderBell();
    await openBell("1 Benachrichtigung");
    expect(await screen.findByText("Eins")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Alle als gelesen markieren" }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Neu")).toBeInTheDocument();
    expect(mockTrack).not.toHaveBeenCalledWith(
      "notification_feed_all_read",
      "7",
    );
  });

  it("loads older entries with „Weitere laden“", async () => {
    setReminders({ enabled: false });
    setFeed([entry({ title: "Seite eins" })], "c2");
    setFeed([entry({ title: "Seite zwei" })], null, "c2");
    renderBell();
    await openBell("Benachrichtigungen");
    expect(await screen.findByText("Seite eins")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Weitere laden" }));

    expect(await screen.findByText("Seite zwei")).toBeInTheDocument();
    expect(api.fetchNotificationFeed).toHaveBeenCalledWith(
      "/api/notifications/feed",
      "c2",
    );
    expect(
      screen.queryByRole("button", { name: "Weitere laden" }),
    ).not.toBeInTheDocument();
  });

  it("loads the next page when the end of the list scrolls into view", async () => {
    const callbacks: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (entries: { isIntersecting: boolean }[]) => void,
        ) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    setReminders({ enabled: false });
    setFeed([entry({ title: "Seite eins" })], "c2");
    setFeed([entry({ title: "Seite zwei" })], null, "c2");
    renderBell();
    await openBell("Benachrichtigungen");
    expect(await screen.findByText("Seite eins")).toBeInTheDocument();

    act(() => callbacks.at(-1)?.([{ isIntersecting: true }]));

    expect(await screen.findByText("Seite zwei")).toBeInTheDocument();
  });

  it("records opening the bell without contents", async () => {
    setReminders({ enabled: false });
    renderBell();
    const bell = await openBell("Benachrichtigungen");
    expect(bell).toHaveAttribute("aria-expanded", "true");

    // The analytics library loads on demand, so the event follows the click.
    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith("notification_bell_opened", "7"),
    );
    fireEvent.click(bell);
    await Promise.resolve();
    expect(mockTrack).toHaveBeenCalledTimes(1);
  });
});

describe("RemindersBell — Telefon", () => {
  it("opens a full-screen sheet with both sections", async () => {
    state.phone = true;
    setReminders({ enabled: true, count: 1, reminders: [reminder()] });
    setFeed([entry({ title: "Termin abgesagt" })]);
    setUnread(1);
    renderBell();

    await openBell("2 Benachrichtigungen");

    const sheet = await screen.findByTestId("notification-sheet");
    expect(sheet).toHaveClass("h-dvh");
    expect(
      await within(sheet).findByText("Termin abgesagt"),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("Kind")).toBeInTheDocument();

    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith("notification_bell_opened", "7"),
    );

    fireEvent.click(within(sheet).getByRole("button", { name: "Schließen" }));
    // The sheet animates out; until then Radix hides the page behind it.
    expect(
      screen.getByRole("button", {
        name: "2 Benachrichtigungen",
        hidden: true,
      }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});

const SCHOOL_FEED = "/api/school/notifications/feed";

function renderSchoolBell() {
  // The school shell renders the bell in its header and the phone sheet once,
  // both under the school's feed context.
  return render(
    <SchoolNotificationFeedProvider>
      <NotificationFeedBell />
      <NotificationsSheet feedOnly />
    </SchoolNotificationFeedProvider>,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ToastProvider>{children}</ToastProvider>
      ),
    },
  );
}

describe("NotificationFeedBell — moto schule", () => {
  beforeEach(() => {
    // moto schule has no tenant context; the session names the school.
    vi.mocked(useTenantSafe).mockReturnValue(
      null as unknown as ReturnType<typeof useTenantSafe>,
    );
    setReminders({ enabled: true, count: 3, reminders: [reminder()] });
  });

  it("counts only the Hinweise, caps at 9+ and reads the school route", async () => {
    setUnread(12);
    renderSchoolBell();

    expect(await screen.findByText("9+")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "9+ Benachrichtigungen, insgesamt 12",
      }),
    ).toBeInTheDocument();
    expect(api.fetchNotificationFeedUnreadCount).toHaveBeenCalledWith(
      SCHOOL_FEED,
    );
    expect(mockUseReminders).not.toHaveBeenCalled();
  });

  it("shows the Hinweise without Erinnerungen", async () => {
    setUnread(1);
    setFeed([entry({ title: "Termin abgesagt" })]);
    renderSchoolBell();
    await openBell("1 Benachrichtigung");

    const feed = await screen.findByRole("region", { name: "Hinweise" });
    expect(within(feed).getByText("Termin abgesagt")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Erinnerungen" }),
    ).not.toBeInTheDocument();
    expect(api.fetchNotificationFeed).toHaveBeenCalledWith(SCHOOL_FEED);
    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith("notification_bell_opened", "5"),
    );
  });

  it("a click marks the entry read in moto schule and opens its page there", async () => {
    setUnread(1);
    setFeed([
      entry({
        id: "41",
        title: "Termin abgesagt",
        deepLink: "/school/aufsichten",
      }),
    ]);
    renderSchoolBell();
    const bell = await openBell("1 Benachrichtigung");

    fireEvent.click(
      await screen.findByRole("button", { name: /Termin abgesagt/ }),
    );

    expect(api.markNotificationFeedEntryRead).toHaveBeenCalledWith(
      SCHOOL_FEED,
      "41",
    );
    expect(mockPush).toHaveBeenCalledWith("/aufsichten");
    expect(bell).toHaveAttribute("aria-expanded", "false");
    expect(mockTrack).toHaveBeenCalledWith(
      "notification_feed_entry_clicked",
      "5",
      { notification_type: "instance_cancelled" },
    );
  });

  it("marks all as read through the school route", async () => {
    setUnread(2);
    setFeed([entry({ title: "Erster" }), entry({ title: "Zweiter" })]);
    renderSchoolBell();
    await openBell("2 Benachrichtigungen");

    fireEvent.click(
      await screen.findByRole("button", { name: "Alle als gelesen markieren" }),
    );

    await waitFor(() =>
      expect(api.markAllNotificationFeedRead).toHaveBeenCalledWith(SCHOOL_FEED),
    );
    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith("notification_feed_all_read", "5"),
    );
  });

  it("updates live when the feed changes", async () => {
    setUnread(1);
    setFeed([entry({ title: "Erster Hinweis" })]);
    renderSchoolBell();
    await openBell("1 Benachrichtigung");
    expect(await screen.findByText("Erster Hinweis")).toBeInTheDocument();

    setUnread(2);
    setFeed([
      entry({ title: "Neuer Hinweis", updatedAt: "2026-09-09T09:30:00Z" }),
      entry({ title: "Erster Hinweis" }),
    ]);
    act(() => {
      window.dispatchEvent(new CustomEvent("notification-feed-refresh"));
    });

    expect(await screen.findByText("Neuer Hinweis")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "2 Benachrichtigungen" }),
    ).toBeInTheDocument();
  });

  it("opens the full-screen sheet with the Hinweise only on a phone", async () => {
    state.phone = true;
    setUnread(1);
    setFeed([entry({ title: "Termin abgesagt" })]);
    renderSchoolBell();
    await openBell("1 Benachrichtigung");

    const sheet = await screen.findByTestId("notification-sheet");
    expect(
      await within(sheet).findByText("Termin abgesagt"),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("Hinweise für Sie.")).toBeInTheDocument();
    expect(
      within(sheet).queryByRole("region", { name: "Erinnerungen" }),
    ).not.toBeInTheDocument();
  });
});
