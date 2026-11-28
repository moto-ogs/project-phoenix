import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { ApiError } from "~/lib/api-error";
import type { UseUnreadCountOptions } from "./use-unread-count";

/** The key and options the hook handed useUnreadCount. */
type Captured = UseUnreadCountOptions & { key: string | null };

const {
  mockUseSession,
  mockUseShellAuth,
  mockUseChangeRequestAccess,
  mockUseUnreadCount,
  mockFetchPendingChangeRequestCount,
} = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockUseShellAuth: vi.fn(),
  mockUseChangeRequestAccess: vi.fn(),
  mockUseUnreadCount: vi.fn(),
  mockFetchPendingChangeRequestCount: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: (): ReturnType<typeof mockUseSession> => mockUseSession(),
}));

vi.mock("~/lib/shell-auth-context", () => ({
  useShellAuth: (): ReturnType<typeof mockUseShellAuth> => mockUseShellAuth(),
}));

vi.mock("./use-change-request-access", () => ({
  useChangeRequestAccess: () => mockUseChangeRequestAccess(),
}));

vi.mock("~/lib/change-requests-api", () => ({
  fetchPendingChangeRequestCount: mockFetchPendingChangeRequestCount,
}));

vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: (): string => "testschool",
}));

vi.mock("./use-unread-count", () => ({
  useUnreadCount: (key: string | null, opts: UseUnreadCountOptions): unknown =>
    mockUseUnreadCount({ key, ...opts }) as unknown,
}));

import { useChangeRequestsPending } from "./use-change-requests-pending";

/** Renders the hook and returns the options it passed to useUnreadCount. */
function capturedOptions(): Captured {
  renderHook(() => useChangeRequestsPending());
  expect(mockUseUnreadCount).toHaveBeenCalledTimes(1);
  return mockUseUnreadCount.mock.calls[0]![0] as Captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUnreadCount.mockReturnValue({ unreadCount: 0, isLoading: false });
  mockUseChangeRequestAccess.mockReturnValue({
    canReviewParentRequests: false,
  });
  mockUseShellAuth.mockReturnValue({ mode: "teacher" });
  mockUseSession.mockReturnValue({
    data: {
      user: {
        id: "7",
        roles: ["user"],
        permissions: ["users:read", "users:update"],
      },
    },
    status: "authenticated",
  });
});

describe("useChangeRequestsPending", () => {
  it("enables the badge for an effective parent-request reviewer", () => {
    mockUseChangeRequestAccess.mockReturnValue({
      canReviewParentRequests: true,
    });
    expect(capturedOptions().enabled).toBe(true);
  });

  it("disables the badge without a current effective review scope", () => {
    expect(capturedOptions().enabled).toBe(false);
  });

  it("disables the badge outside the teacher shell even with review access", () => {
    mockUseChangeRequestAccess.mockReturnValue({
      canReviewParentRequests: true,
    });
    mockUseShellAuth.mockReturnValue({ mode: "operator" });
    expect(capturedOptions().enabled).toBe(false);
  });

  it("disables the badge until the session is authenticated", () => {
    mockUseChangeRequestAccess.mockReturnValue({
      canReviewParentRequests: true,
    });
    mockUseSession.mockReturnValue({ data: null, status: "loading" });
    expect(capturedOptions().enabled).toBe(false);
  });

  it("wires the pending-count fetcher and the queue's own refresh event", () => {
    mockUseChangeRequestAccess.mockReturnValue({
      canReviewParentRequests: true,
    });
    const opts = capturedOptions();
    expect(opts.fetcher).toBe(mockFetchPendingChangeRequestCount);
    expect(opts.eventNames).toEqual([
      "messages-unread-refresh",
      "change-requests-refresh",
    ]);
  });

  // useSWRAuth prefixes school and account (no cross-tenant leak); the key
  // carries the account.
  it("binds the key to the account", () => {
    mockUseChangeRequestAccess.mockReturnValue({
      canReviewParentRequests: true,
    });
    expect(capturedOptions().key).toBe("badge-change-requests-pending:7");
  });

  // Für Gruppenleitungen entscheidet erst der Server, ob die Quelle gilt
  // (#8268): bis dahin ist sie offen, nicht „nichts offen“.
  describe("state while the server settles the review area", () => {
    const inactive = { unreadCount: 0, isLoading: false, state: "inactive" };

    function stateWith(access: Record<string, unknown>) {
      mockUseUnreadCount.mockReturnValue(inactive);
      mockUseChangeRequestAccess.mockReturnValue({
        canReviewParentRequests: false,
        isLoading: false,
        error: undefined,
        refresh: vi.fn(),
        ...access,
      });
      return renderHook(() => useChangeRequestsPending()).result.current;
    }

    it("is loading while the access check runs", () => {
      expect(stateWith({ isLoading: true }).state).toBe("loading");
    });

    it("is failed with the failure when the access check fails", () => {
      const error = new ApiError("down", 503);
      const result = stateWith({ error });
      expect(result.state).toBe("failed");
      expect(result.error).toBe(error);
    });

    it("stays inactive when the server refuses the access check", () => {
      const error = new ApiError("no", 403, { code: "general.permission" });
      expect(stateWith({ error }).state).toBe("inactive");
    });

    it("stays inactive once the server granted no review area", () => {
      expect(stateWith({}).state).toBe("inactive");
    });

    it("stays inactive outside the teacher shell", () => {
      mockUseShellAuth.mockReturnValue({ mode: "operator" });
      expect(stateWith({ isLoading: true }).state).toBe("inactive");
    });
  });
});
