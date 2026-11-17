import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import type { StaffNotice } from "~/lib/staff-notices-api";
import type { UseUnreadCountOptions } from "./use-unread-count";

/** The key and options the hook handed useUnreadCount. */
type Captured = UseUnreadCountOptions & { key: string | null };

const { mockUseSession, mockUseUnreadCount, mockFetchTodaysNotices } =
  vi.hoisted(() => ({
    mockUseSession: vi.fn(),
    mockUseUnreadCount: vi.fn(),
    mockFetchTodaysNotices: vi.fn(),
  }));

vi.mock("next-auth/react", () => ({
  useSession: (): ReturnType<typeof mockUseSession> => mockUseSession(),
}));

vi.mock("~/lib/school-staff-notices-api", () => ({
  schoolStaffNoticesApi: {
    fetchTodaysNotices: (): unknown => mockFetchTodaysNotices(),
    acknowledgeStaffNotice: vi.fn(),
  },
}));

vi.mock("./use-unread-count", () => ({
  useUnreadCount: (key: string | null, opts: UseUnreadCountOptions): unknown =>
    mockUseUnreadCount({ key, ...opts }) as unknown,
}));

import { useSchoolStaffNoticesPending } from "./use-school-staff-notices-pending";

function capturedOptions(): Captured {
  renderHook(() => useSchoolStaffNoticesPending());
  expect(mockUseUnreadCount).toHaveBeenCalledTimes(1);
  return mockUseUnreadCount.mock.calls[0]![0] as Captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUnreadCount.mockReturnValue({ unreadCount: 0, isLoading: false });
  mockUseSession.mockReturnValue({
    data: { user: { id: "7", tenantId: 3 } },
    status: "authenticated",
  });
});

describe("useSchoolStaffNoticesPending", () => {
  it("zählt nur Hinweise, deren Kenntnisnahme noch aussteht", async () => {
    mockFetchTodaysNotices.mockResolvedValue([
      { id: "1", requires_acknowledgement: true },
      {
        id: "2",
        requires_acknowledgement: true,
        acknowledged_at: "2026-09-09",
      },
      { id: "3", requires_acknowledgement: false },
    ]);

    const opts = capturedOptions() as unknown as UseUnreadCountOptions<
      StaffNotice[]
    >;
    const notices = await opts.fetcher();
    expect(opts.count(notices)).toBe(1);
  });

  it("bindet Zähler und Ereignis an die Schul-Sitzung", () => {
    const opts = capturedOptions();

    expect(opts.enabled).toBe(true);
    // Derselbe Eintrag wie Seite und Karte; die Sitzung (Schule + Konto)
    // stellt useSWRAuth davor.
    expect(opts.key).toBe("school-staff-notices-today");
    expect(opts.eventNames).toEqual(["staff-notices-refresh"]);
    expect(opts.refetchOnFocus).toBe(true);
  });

  it("holt nichts, solange niemand angemeldet ist", () => {
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    const opts = capturedOptions();
    expect(opts.enabled).toBe(false);
  });

  it("gibt den Zähler als pendingCount weiter", () => {
    mockUseUnreadCount.mockReturnValue({ unreadCount: 5, isLoading: false });
    const { result } = renderHook(() => useSchoolStaffNoticesPending());
    expect(result.current.pendingCount).toBe(5);
  });
});
