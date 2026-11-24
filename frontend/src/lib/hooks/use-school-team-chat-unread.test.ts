import { createElement, type ReactNode } from "react";
import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// The probe reads through the real shared cache of the school session.
vi.unmock("swr");

const { identity, fetchUnreadCount } = vi.hoisted(() => ({
  identity: { session: null as Session | null },
  fetchUnreadCount: vi.fn(),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: identity.session,
    status: identity.session ? "authenticated" : "unauthenticated",
  }),
}));
vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: () => null,
  useTenantRoutingModeSafe: () => null,
}));
vi.mock("~/lib/session-cache", () => ({ announceSessionChange: vi.fn() }));
vi.mock("~/lib/school-staff-messages-api", () => ({
  schoolStaffMessagesApi: { fetchUnreadCount },
}));

import { ApiError } from "~/lib/api-error";
import { resetSWRScope, resumeSWRSession } from "~/lib/swr/scope";
import { SWRScopeBoundary } from "~/lib/swr/scope-boundary";
import { useSchoolTeamChatUnread } from "./use-school-team-chat-unread";

function signIn(id = "7", tenantId = "3") {
  identity.session = {
    user: { id, tenantId, scope: "school" },
    expires: "2099-01-01",
  } as Session;
}

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return createElement("div", null, createElement(SWRScopeBoundary), children);
}

const disabled = () =>
  new ApiError("off", 403, { code: "communication.staff_messaging_disabled" });

beforeEach(() => {
  fetchUnreadCount.mockReset();
  signIn();
});

afterEach(() => {
  vi.useRealTimers();
  resumeSWRSession();
  resetSWRScope({ revalidate: false });
});

describe("useSchoolTeamChatUnread", () => {
  it("knows nothing until the probe answered", () => {
    fetchUnreadCount.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useSchoolTeamChatUnread(), {
      wrapper,
    });

    expect(result.current).toEqual({ unreadCount: 0, available: null });
  });

  it("shows the entry and the count once the backend answered", async () => {
    fetchUnreadCount.mockResolvedValue(4);
    const { result } = renderHook(() => useSchoolTeamChatUnread(), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current).toEqual({ unreadCount: 4, available: true }),
    );
  });

  it("hides the entry when the school switched the Team-Chat off", async () => {
    fetchUnreadCount.mockRejectedValue(disabled());
    const { result } = renderHook(() => useSchoolTeamChatUnread(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.available).toBe(false));
    expect(result.current.unreadCount).toBe(0);
  });

  it("asks again after a transient failure until the backend answers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchUnreadCount
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(2);
    const { result } = renderHook(() => useSchoolTeamChatUnread(), {
      wrapper,
    });
    await waitFor(() => expect(fetchUnreadCount).toHaveBeenCalledTimes(1));
    // A failure is no answer: the entry stays unknown, not hidden.
    expect(result.current.available).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    await waitFor(() =>
      expect(result.current).toEqual({ unreadCount: 2, available: true }),
    );
  });

  it("starts the next session without the previous probe and count", async () => {
    fetchUnreadCount.mockResolvedValueOnce(5);
    const { result, rerender } = renderHook(() => useSchoolTeamChatUnread(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.unreadCount).toBe(5));

    fetchUnreadCount.mockReturnValue(new Promise(() => undefined));
    signIn("8");
    rerender();

    expect(result.current).toEqual({ unreadCount: 0, available: null });
  });
});
