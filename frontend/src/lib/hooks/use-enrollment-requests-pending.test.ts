import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { UseUnreadCountOptions } from "./use-unread-count";

/** The key and options the hook handed useUnreadCount. */
type Captured = UseUnreadCountOptions & { key: string | null };

const {
  mockUseSession,
  mockUseShellAuth,
  mockCanReview,
  mockUseUnreadCount,
  mockFetchPendingEnrollmentChangeRequestCount,
} = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockUseShellAuth: vi.fn(),
  mockCanReview: vi.fn(),
  mockUseUnreadCount: vi.fn(),
  mockFetchPendingEnrollmentChangeRequestCount: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: (): ReturnType<typeof mockUseSession> => mockUseSession(),
}));

vi.mock("~/lib/shell-auth-context", () => ({
  useShellAuth: (): ReturnType<typeof mockUseShellAuth> => mockUseShellAuth(),
}));

vi.mock("~/lib/change-request-access", () => ({
  canReviewEnrollmentChangeRequests: (...args: unknown[]): boolean =>
    mockCanReview(...args) as boolean,
}));

vi.mock("~/lib/change-request-list-api", () => ({
  fetchPendingEnrollmentChangeRequestCount:
    mockFetchPendingEnrollmentChangeRequestCount,
}));

vi.mock("~/lib/tenant-context", () => ({
  useTenantSlugSafe: (): string | null => mockTenantSlug,
  useModuleBooked: (): boolean => mockModuleBooked,
}));

vi.mock("./use-unread-count", () => ({
  useUnreadCount: (key: string | null, opts: UseUnreadCountOptions): unknown =>
    mockUseUnreadCount({ key, ...opts }) as unknown,
}));

let mockTenantSlug: string | null = "testschool";
let mockModuleBooked = true;

import { useEnrollmentRequestsPending } from "./use-enrollment-requests-pending";

/** Rendert den Hook und gibt die an useUnreadCount übergebenen Optionen zurück. */
function capturedOptions(): Captured {
  renderHook(() => useEnrollmentRequestsPending());
  expect(mockUseUnreadCount).toHaveBeenCalledTimes(1);
  return mockUseUnreadCount.mock.calls[0]![0] as Captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTenantSlug = "testschool";
  mockModuleBooked = true;
  mockUseUnreadCount.mockReturnValue({ unreadCount: 0, isLoading: false });
  mockCanReview.mockReturnValue(true);
  mockUseShellAuth.mockReturnValue({ mode: "teacher" });
  mockUseSession.mockReturnValue({
    data: { user: { id: "7" } },
    status: "authenticated",
  });
});

describe("useEnrollmentRequestsPending", () => {
  it("zählt für eine Person mit config:manage im Lehrkraft-Bereich", () => {
    const opts = capturedOptions();
    expect(opts.enabled).toBe(true);
    expect(mockCanReview).toHaveBeenCalledWith({ user: { id: "7" } });
  });

  it("zählt nicht, wer Anmeldungsänderungen nicht entscheiden darf", () => {
    mockCanReview.mockReturnValue(false);
    expect(capturedOptions().enabled).toBe(false);
  });

  it("zählt nicht außerhalb des Lehrkraft-Bereichs", () => {
    mockUseShellAuth.mockReturnValue({ mode: "operator" });
    expect(capturedOptions().enabled).toBe(false);
  });

  it("zählt nicht, solange die Sitzung nicht angemeldet ist", () => {
    mockUseSession.mockReturnValue({ data: null, status: "loading" });
    expect(capturedOptions().enabled).toBe(false);
  });

  it("verdrahtet den Zähl-Abruf und das Auffrisch-Ereignis der Warteschlange", () => {
    const opts = capturedOptions();
    expect(opts.fetcher).toBe(mockFetchPendingEnrollmentChangeRequestCount);
    expect(opts.eventNames).toEqual(["change-requests-refresh"]);
    expect(opts.eventDebounceMs).toBe(500);
    expect(opts.refetchOnFocus).toBe(true);
  });

  // Die Schule stellt useSWRAuth davor; der Schlüssel trägt das Konto.
  it("bindet den Schlüssel an das Konto", () => {
    expect(capturedOptions().key).toBe("badge-enrollment-requests-pending:7");
  });

  it("liest nichts ohne Konto-ID", () => {
    mockTenantSlug = null;
    mockUseSession.mockReturnValue({ data: {}, status: "authenticated" });
    const opts = capturedOptions();
    expect(opts.key).toBeNull();
    expect(opts.enabled).toBe(false);
  });

  // Ohne Online-Anmeldung gibt es keine Anmeldungsänderungen (#4894).
  it("zählt nicht ohne gebuchte Online-Anmeldung", () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: "7" } },
      status: "authenticated",
    });
    mockUseShellAuth.mockReturnValue({ mode: "teacher" });
    mockCanReview.mockReturnValue(true);
    mockModuleBooked = false;

    expect(capturedOptions().enabled).toBe(false);
  });
});
