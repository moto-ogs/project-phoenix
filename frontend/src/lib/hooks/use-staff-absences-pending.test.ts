import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { UseUnreadCountOptions } from "./use-unread-count";

/** The key and options the hook handed useUnreadCount. */
type Captured = UseUnreadCountOptions & { key: string | null };

const {
  mockUseSession,
  mockUseShellAuth,
  mockIsAdmin,
  mockHasPermission,
  mockUseUnreadCount,
  mockListPending,
  mockUseTenantSlugSafe,
} = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockUseShellAuth: vi.fn(),
  mockIsAdmin: vi.fn(),
  mockHasPermission: vi.fn(),
  mockUseUnreadCount: vi.fn(),
  mockListPending: vi.fn(),
  mockUseTenantSlugSafe: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: (): ReturnType<typeof mockUseSession> => mockUseSession(),
}));

vi.mock("~/lib/shell-auth-context", () => ({
  useShellAuth: (): ReturnType<typeof mockUseShellAuth> => mockUseShellAuth(),
}));

vi.mock("~/lib/auth-utils", () => ({
  isAdmin: (...args: unknown[]): boolean => mockIsAdmin(...args) as boolean,
  hasPermission: (...args: unknown[]): boolean =>
    mockHasPermission(...args) as boolean,
}));

vi.mock("~/lib/staff-api", () => ({
  staffAbsenceService: {
    listPending: (): ReturnType<typeof mockListPending> => mockListPending(),
  },
}));

vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: (): ReturnType<typeof mockUseTenantSlugSafe> =>
    mockUseTenantSlugSafe(),
  useModuleBooked: (): boolean => moduleState.booked,
}));

const moduleState = vi.hoisted(() => ({ booked: true }));

vi.mock("./use-unread-count", () => ({
  useUnreadCount: (key: string | null, opts: UseUnreadCountOptions): unknown =>
    mockUseUnreadCount({ key, ...opts }) as unknown,
}));

import { useStaffAbsencesPending } from "./use-staff-absences-pending";

/** Renders the hook and returns the options it passed to useUnreadCount. */
function capturedOptions(): Captured {
  renderHook(() => useStaffAbsencesPending());
  expect(mockUseUnreadCount).toHaveBeenCalledTimes(1);
  return mockUseUnreadCount.mock.calls[0]![0] as Captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUnreadCount.mockReturnValue({ unreadCount: 0, isLoading: false });
  mockIsAdmin.mockReturnValue(false);
  mockHasPermission.mockReturnValue(false);
  mockUseShellAuth.mockReturnValue({ mode: "teacher" });
  mockUseTenantSlugSafe.mockReturnValue("testschool");
  moduleState.booked = true;
  mockUseSession.mockReturnValue({
    data: { user: { id: "7" } },
    status: "authenticated",
  });
});

describe("useStaffAbsencesPending", () => {
  it("enables the badge for an admin in the teacher shell", () => {
    mockIsAdmin.mockReturnValue(true);
    expect(capturedOptions().enabled).toBe(true);
  });

  it("enables the badge for a non-admin holding vacation:approve", () => {
    mockHasPermission.mockReturnValue(true);
    const opts = capturedOptions();
    expect(opts.enabled).toBe(true);
    expect(mockHasPermission).toHaveBeenCalledWith(
      { user: { id: "7" } },
      "vacation:approve",
    );
  });

  it("disables the badge for a staffer lacking both admin and vacation:approve", () => {
    expect(capturedOptions().enabled).toBe(false);
  });

  // Urlaub und Abwesenheiten gehören zur Zeiterfassung (#4894).
  it("disables the badge when the school did not book Zeiterfassung", () => {
    mockIsAdmin.mockReturnValue(true);
    moduleState.booked = false;
    expect(capturedOptions().enabled).toBe(false);
  });

  it("disables the badge outside the teacher shell even for an admin", () => {
    mockIsAdmin.mockReturnValue(true);
    mockUseShellAuth.mockReturnValue({ mode: "operator" });
    expect(capturedOptions().enabled).toBe(false);
  });

  // A failure is no confirmed 0 (#8268): it reaches the shared reader.
  it("counts the pending rows via the fetcher and passes failures on", async () => {
    mockIsAdmin.mockReturnValue(true);
    mockListPending.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const opts = capturedOptions();
    await expect(opts.fetcher()).resolves.toBe(2);
    const failure = new Error("403");
    mockListPending.mockRejectedValueOnce(failure);
    await expect(opts.fetcher()).rejects.toBe(failure);
  });

  it("wires the absence refresh event", () => {
    mockIsAdmin.mockReturnValue(true);
    const opts = capturedOptions();
    expect(opts.eventNames).toEqual(["staff-absences-refresh"]);
  });

  // useSWRAuth prefixes school and account; the key carries the account.
  it("binds the key to the account", () => {
    mockIsAdmin.mockReturnValue(true);
    expect(capturedOptions().key).toBe("badge-staff-absences-pending:7");
  });

  it("reads nothing before tenant and account resolution", () => {
    mockUseTenantSlugSafe.mockReturnValue(null);
    mockUseSession.mockReturnValue({
      data: null,
      status: "loading",
    });

    const opts = capturedOptions();

    expect(opts.enabled).toBe(false);
    expect(opts.key).toBeNull();
  });
});
