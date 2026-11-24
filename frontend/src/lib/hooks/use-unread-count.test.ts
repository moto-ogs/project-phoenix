import { createElement, type ReactNode } from "react";
import type { Session } from "next-auth";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor as waitForDOM, act } from "@testing-library/react";

// The badge reads through the real shared cache: key scope, generation lock,
// seed and revalidation are what this hook relies on.
vi.unmock("swr");

const { identity } = vi.hoisted(() => ({
  identity: {
    session: null as Session | null,
    slug: "school-a" as string | null,
  },
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: identity.session,
    status: identity.session ? "authenticated" : "unauthenticated",
  }),
}));
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => identity.slug,
  useTenantRoutingModeSafe: () => null,
}));
vi.mock("~/lib/session-cache", () => ({ announceSessionChange: vi.fn() }));

import { scopedSWRKey, tenantSWRScope, writeSWRSeeds } from "~/lib/swr";
import { resetSWRScope, resumeSWRSession } from "~/lib/swr/scope";
import { SWRScopeBoundary } from "~/lib/swr/scope-boundary";
import { useUnreadCount, type UseUnreadCountOptions } from "./use-unread-count";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

// renderHook updates result.current without a DOM mutation, so waitFor only
// rechecks on its interval. Poll the same assertions more promptly; keep
// Testing Library's timeout.
const waitFor: typeof waitForDOM = (callback, options) =>
  waitForDOM(callback, { interval: 5, ...options });

const KEY = "badge-test-unread";

function signIn(id = "7", tenantId = "1") {
  identity.session = {
    user: { id, tenantId },
    expires: "2099-01-01",
  } as Session;
}

/** The cache key useSWRAuth builds for KEY in this session. */
function scoped(slug = "school-a", account = "7") {
  return scopedSWRKey(tenantSWRScope(slug, account), KEY);
}

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return createElement("div", null, createElement(SWRScopeBoundary), children);
}

type Props = Partial<UseUnreadCountOptions> & { key?: string | null };

function render(options: Props = {}) {
  const { key = KEY, ...rest } = options;
  const props = {
    enabled: true,
    fetcher: vi.fn().mockResolvedValue(0),
    ...rest,
  } as UseUnreadCountOptions;
  return renderHook(
    (next: Partial<UseUnreadCountOptions>) =>
      useUnreadCount(key, { ...props, ...next } as UseUnreadCountOptions),
    { wrapper, initialProps: {} },
  );
}

/** Lets the pending mount revalidation (if any) start and settle. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  identity.slug = "school-a";
  signIn();
});

afterEach(() => {
  vi.useRealTimers();
  resumeSWRSession();
  resetSWRScope({ revalidate: false });
});

// ---------------------------------------------------------------------------
// enabled gate
// ---------------------------------------------------------------------------

describe("useUnreadCount — enabled gate", () => {
  it("issues no request and shows no count while disabled", async () => {
    const fetcher = vi.fn();
    const { result } = render({ enabled: false, fetcher });

    await settle();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.unreadCount).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("issues no request without a key", async () => {
    const fetcher = vi.fn();
    const { result } = render({ key: null, fetcher });

    await settle();

    expect(result.current.unreadCount).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("shows no count once the gate closes, also not the cached one", async () => {
    const fetcher = vi.fn().mockResolvedValue(6);
    const { result, rerender } = render({ fetcher });
    await waitFor(() => expect(result.current.unreadCount).toBe(6));

    rerender({ enabled: false });

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Basic fetch
// ---------------------------------------------------------------------------

describe("useUnreadCount — basic fetch", () => {
  it("sets unreadCount after a successful fetch", async () => {
    const fetcher = vi.fn().mockResolvedValue(7);
    const { result } = render({ fetcher });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.unreadCount).toBe(7));
    expect(result.current.isLoading).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the badge at 0 when the fetch fails", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network fail"));
    const onError = vi.fn();
    const { result } = render({ fetcher, onError });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.unreadCount).toBe(0);
  });

  it("calls onError with the error when fetch fails", async () => {
    const error = new Error("boom");
    const onError = vi.fn();
    render({ fetcher: vi.fn().mockRejectedValue(error), onError });

    await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  });

  it("derives the count from a resource that is not itself a number", async () => {
    const { result } = renderHook(
      () =>
        useUnreadCount<string[]>(KEY, {
          enabled: true,
          fetcher: () => Promise.resolve(["a", "b", "c"]),
          count: (items) => items.length,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.unreadCount).toBe(3));
  });
});

// ---------------------------------------------------------------------------
// Shared cache: one answer for every reader (replaces the localStorage cache)
// ---------------------------------------------------------------------------

describe("useUnreadCount — shared cache", () => {
  it("shares one request between two readers of the same key", async () => {
    const fetcher = vi.fn().mockResolvedValue(4);
    const sidebar = render({ fetcher });
    const homeBlock = render({ fetcher });

    await waitFor(() => expect(sidebar.result.current.unreadCount).toBe(4));
    await waitFor(() => expect(homeBlock.result.current.unreadCount).toBe(4));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shows the cached answer to a reader mounted later, without a request", async () => {
    const fetcher = vi.fn().mockResolvedValue(4);
    const sidebar = render({ fetcher });
    await waitFor(() => expect(sidebar.result.current.unreadCount).toBe(4));

    const later = render({ fetcher });

    expect(later.result.current.unreadCount).toBe(4);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// refresh
// ---------------------------------------------------------------------------

describe("useUnreadCount — refresh", () => {
  it("refresh() fetches a fresh count and updates state", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(8);
    const { result } = render({ fetcher });

    await waitFor(() => expect(result.current.unreadCount).toBe(1));
    await act(() => result.current.refresh());

    expect(result.current.unreadCount).toBe(8);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("the newest answer wins over one that was already in flight", async () => {
    const first = deferred<number>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(9);
    const { result } = render({ fetcher });

    await act(() => result.current.refresh());
    expect(result.current.unreadCount).toBe(9);

    await act(async () => first.resolve(3));
    expect(result.current.unreadCount).toBe(9);
  });

  it("does not fetch when enabled=false and refresh() is called", async () => {
    const fetcher = vi.fn();
    const { result } = render({ enabled: false, fetcher });

    await act(() => result.current.refresh());

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.unreadCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

describe("useUnreadCount — event listeners", () => {
  it("refetches when a registered event fires", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(9);
    const { result } = render({ fetcher, eventNames: ["my-refresh-event"] });

    await waitFor(() => expect(result.current.unreadCount).toBe(2));

    act(() => {
      window.dispatchEvent(new Event("my-refresh-event"));
    });

    await waitFor(() => expect(result.current.unreadCount).toBe(9));
  });

  it("answers one event with one request for all readers of a key", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(2).mockResolvedValue(9);
    const sidebar = render({ fetcher, eventNames: ["shared-refresh-event"] });
    const homeBlock = render({ fetcher, eventNames: ["shared-refresh-event"] });
    await waitFor(() => expect(sidebar.result.current.unreadCount).toBe(2));

    act(() => {
      window.dispatchEvent(new Event("shared-refresh-event"));
    });

    await waitFor(() => expect(sidebar.result.current.unreadCount).toBe(9));
    await waitFor(() => expect(homeBlock.result.current.unreadCount).toBe(9));
    expect(fetcher).toHaveBeenCalledTimes(2);

    // The guard is released: the next event loads again.
    act(() => {
      window.dispatchEvent(new Event("shared-refresh-event"));
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  });

  it("coalesces events during a shared refresh into one trailing request", async () => {
    const pending = deferred<number>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(2)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(9);
    const sidebar = render({ fetcher, eventNames: ["shared-refresh-event"] });
    const home = render({ fetcher, eventNames: ["shared-refresh-event"] });
    await waitFor(() => expect(home.result.current.unreadCount).toBe(2));
    act(() => window.dispatchEvent(new Event("shared-refresh-event")));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    act(() => {
      window.dispatchEvent(new Event("shared-refresh-event"));
      window.dispatchEvent(new Event("shared-refresh-event"));
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(4));
    await waitFor(() => expect(sidebar.result.current.unreadCount).toBe(9));
    expect(home.result.current.unreadCount).toBe(9);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("listens to multiple event names", async () => {
    const fetcher = vi.fn().mockResolvedValue(0);
    render({ fetcher, eventNames: ["event-a", "event-b"] });

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    act(() => window.dispatchEvent(new Event("event-a")));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    act(() => window.dispatchEvent(new Event("event-b")));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  });

  it("debounces rapid event bursts into a single refetch", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetcher = vi.fn().mockResolvedValue(5);
    render({ fetcher, eventNames: ["burst-event"], eventDebounceMs: 300 });

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new Event("burst-event"));
      window.dispatchEvent(new Event("burst-event"));
      window.dispatchEvent(new Event("burst-event"));
    });

    // Before the debounce window closes, only the mount fetch ran
    expect(fetcher).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(300));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it("ignores events while disabled", async () => {
    const fetcher = vi.fn();
    render({ enabled: false, fetcher, eventNames: ["my-refresh-event"] });

    act(() => window.dispatchEvent(new Event("my-refresh-event")));
    await settle();

    expect(fetcher).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// refetchOnFocus
// ---------------------------------------------------------------------------

describe("useUnreadCount — refetchOnFocus", () => {
  it("refetches when window gains focus and refetchOnFocus is true", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(4);
    const { result } = render({ fetcher, refetchOnFocus: true });

    await waitFor(() => expect(result.current.unreadCount).toBe(1));
    // Past the shared reader's dedupe window of the mount request.
    act(() => vi.advanceTimersByTime(10_000));

    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(result.current.unreadCount).toBe(4));
  });

  it("does NOT refetch on focus when refetchOnFocus is false (default)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetcher = vi.fn().mockResolvedValue(2);
    render({ fetcher });

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    act(() => vi.advanceTimersByTime(10_000));

    act(() => window.dispatchEvent(new Event("focus")));
    await settle();

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Server seed (replaces initialCount)
// ---------------------------------------------------------------------------

describe("useUnreadCount — server seed", () => {
  it("shows the seed as the first answer without a mount request", async () => {
    writeSWRSeeds({ [scoped()]: 4 });
    const fetcher = vi.fn().mockResolvedValue(9);
    const { result } = render({ fetcher });

    expect(result.current.unreadCount).toBe(4);
    expect(result.current.isLoading).toBe(false);
    await settle();
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.unreadCount).toBe(4);
  });

  it("still refetches on a refresh event after being seeded", async () => {
    writeSWRSeeds({ [scoped()]: 4 });
    const fetcher = vi.fn().mockResolvedValue(11);
    const { result } = render({ fetcher, eventNames: ["seed-refresh"] });
    expect(result.current.unreadCount).toBe(4);

    act(() => window.dispatchEvent(new Event("seed-refresh")));

    await waitFor(() => expect(result.current.unreadCount).toBe(11));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("ignores the seed while disabled and fetches once enabled", async () => {
    writeSWRSeeds({ [scoped()]: 4 });
    const fetcher = vi.fn().mockResolvedValue(6);
    const { result, rerender } = render({ enabled: false, fetcher });

    expect(result.current.unreadCount).toBe(0);
    await settle();
    expect(fetcher).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.unreadCount).toBe(6));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("loads anew when a closed gate opens again", async () => {
    writeSWRSeeds({ [scoped()]: 4 });
    const fetcher = vi.fn().mockResolvedValue(6);
    const { result, rerender } = render({ fetcher });
    expect(result.current.unreadCount).toBe(4);

    rerender({ enabled: false });
    expect(result.current.unreadCount).toBe(0);
    rerender({ enabled: true });

    await waitFor(() => expect(result.current.unreadCount).toBe(6));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tenant/session isolation (replaces the cacheKey/owner guards)
// ---------------------------------------------------------------------------

describe("useUnreadCount — tenant/session isolation", () => {
  it("never shows the old school's count after a tenant switch", async () => {
    const oldSchool = deferred<number>();
    const newSchool = deferred<number>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(oldSchool.promise)
      .mockReturnValueOnce(newSchool.promise);
    const { result, rerender } = render({ fetcher });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    // Same account, other school: the slug and the session's school change.
    identity.slug = "school-b";
    signIn("7", "2");
    rerender({});
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    // The old school answers late: its count must not appear.
    await act(async () => oldSchool.resolve(9));
    expect(result.current.unreadCount).toBe(0);

    await act(async () => newSchool.resolve(2));
    expect(result.current.unreadCount).toBe(2);
  });

  it("drops a seeded count of the old school at once on a tenant switch", async () => {
    writeSWRSeeds({ [scoped()]: 5 });
    const next = deferred<number>();
    const fetcher = vi.fn().mockReturnValue(next.promise);
    const { result, rerender } = render({ fetcher });
    expect(result.current.unreadCount).toBe(5);

    identity.slug = "school-b";
    signIn("7", "2");
    rerender({});

    // Not even until the new school's first answer.
    expect(result.current.unreadCount).toBe(0);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await act(async () => next.resolve(1));
    expect(result.current.unreadCount).toBe(1);
  });

  it("never shows another account's count after an account switch", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(8);
    const { result, rerender } = render({ fetcher });
    await waitFor(() => expect(result.current.unreadCount).toBe(8));

    const next = deferred<number>();
    fetcher.mockReturnValueOnce(next.promise);
    signIn("8");
    rerender({});

    expect(result.current.unreadCount).toBe(0);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await act(async () => next.resolve(3));
    expect(result.current.unreadCount).toBe(3);
  });

  it("does not publish an in-flight result after logout", async () => {
    const pending = deferred<number>();
    const fetcher = vi.fn().mockReturnValue(pending.promise);
    const { result, rerender } = render({ fetcher });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    identity.session = null;
    rerender({ enabled: false });
    await act(async () => pending.resolve(9));

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });
});
