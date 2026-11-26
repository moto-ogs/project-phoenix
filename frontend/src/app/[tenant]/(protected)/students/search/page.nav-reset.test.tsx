/**
 * Behavior tests for the search page when the person clicks "Alle Kinder" in
 * the navigation while already on it, and for a student list that never
 * finishes loading (#3374).
 *
 * The App Router does not remount the page for such a click, so the tests
 * render the page once and click a plain link to the current path, the way the
 * sidebar entry reaches the document.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectAllControl } from "~/components/students/school-checkin-select-all";

vi.unmock("swr");

const {
  mockGetStudents,
  mockCheckin,
  mockBatchCheckin,
  mockUseSWRAuth,
  mockUseImmutableSWR,
  mockPush,
  mockMutateStudents,
  mockRefreshSearch,
  mockUpdateSession,
  mockParentAnnouncementsAvailable,
  sessionState,
} = vi.hoisted(() => ({
  mockGetStudents: vi.fn(),
  mockCheckin: vi.fn(),
  mockBatchCheckin: vi.fn(),
  mockUseSWRAuth: vi.fn(),
  mockUseImmutableSWR: vi.fn(),
  mockPush: vi.fn(),
  mockMutateStudents: vi.fn(),
  mockRefreshSearch: vi.fn(),
  mockUpdateSession: vi.fn(),
  mockParentAnnouncementsAvailable: vi.fn(() => false),
  // The browser session carries no token (#5005); a session without one
  // carries an error.
  sessionState: {
    error: undefined as "RefreshTokenError" | undefined,
    status: "authenticated" as "authenticated" | "loading",
  },
}));

let currentSearch = new URLSearchParams();
let realStudentReads = false;

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { user: { id: "3", tenantId: "2" }, error: sessionState.error },
    status: sessionState.status,
    update: mockUpdateSession,
  })),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/students/search",
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => currentSearch,
}));

vi.mock("~/lib/tenant-router", () => ({
  useTenantRouter: () => ({ push: mockPush }),
}));

vi.mock("~/lib/hooks/use-parent-announcements-available", () => ({
  useParentAnnouncementsAvailable: mockParentAnnouncementsAvailable,
}));

vi.mock("~/lib/supervision-context", () => ({
  useOptionalSupervision: () => ({
    ownGroupIds: [],
    ownGroupRoomNames: [],
    ownSessionRoomNames: [],
    ownSupervisedRooms: [],
    hasGroups: false,
    isSupervising: false,
    isLoadingGroups: false,
    isLoadingSupervision: false,
    overviewEnabled: false,
    supervisedRooms: [],
    groups: [],
    refresh: () => undefined,
  }),
}));

vi.mock("~/lib/tenant-context", () => ({
  useTenantRoutingModeSafe: () => "subdomain",
  useChildSearchOnlyNavigation: () => false,
  useTenant: () => ({ tenantSlug: "t", tenant: null }),
  useTenantSafe: () => ({
    tenantSlug: "t",
    tenant: { studentPhotosEnabled: true },
  }),
  useTenantSlugSafe: () => "t",
  usePresenceMode: () => "detailed",
  useAttendanceWebEnabled: vi.fn(() => true),
  useNFCEnabled: () => true,
  useOpenCareGroupMode: () => false,
  TenantProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/lib/breadcrumb-context", () => ({
  useSetBreadcrumb: vi.fn(),
  useBreadcrumb: () => ({ breadcrumb: {}, setBreadcrumb: vi.fn() }),
}));

vi.mock("@/components/students/presence/location-badge", () => ({
  LocationBadge: () => <span />,
}));

vi.mock("@/components/students/presence/student-presence-badge", () => ({
  StudentPresenceBadge: () => <span />,
}));

vi.mock("~/components/students/tracking-indicators", () => ({
  TrackingIndicators: () => <span />,
}));

vi.mock("~/components/students/school-checkin-fab", () => ({
  SchoolCheckinFab: () => <span />,
}));

vi.mock("~/components/students/school-checkin-mode-mobile", () => ({
  SchoolCheckinModeMobile: ({ selectAll }: { selectAll: SelectAllControl }) => (
    <span data-testid="select-all-count">{selectAll.count}</span>
  ),
}));

vi.mock("~/lib/hooks/use-school-checkin-mode", () => ({
  useSchoolCheckinMode: () => ({
    isActive: false,
    toggleActive: vi.fn(),
    deactivate: vi.fn(),
    pendingIds: new Set<string>(),
    successCount: 0,
    toggle: vi.fn(),
    selectionActive: false,
    setSelectionActive: vi.fn(),
    selectedIds: new Set<string>(),
    toggleSelected: vi.fn(),
    clearSelection: vi.fn(),
    isBulkRunning: false,
    runBulk: vi.fn(),
  }),
  deriveCheckinState: () => "unknown",
  checkoutConfirmationRoom: () => null,
}));

vi.mock("~/lib/pickup-helpers", () => ({
  useMinuteClock: () => new Date(),
}));

vi.mock("~/lib/active-api", () => ({
  activeService: {
    getTrackingIndicators: vi.fn(() =>
      Promise.resolve({ labels: [], results: {} }),
    ),
  },
}));

vi.mock("~/lib/student-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/student-api")>()),
  fetchStudents: (...args: unknown[]) => mockGetStudents(...args),
  schoolCheckinStudent: mockCheckin,
  schoolCheckinStudentsBatch: mockBatchCheckin,
  fetchSchoolClasses: vi.fn(() => Promise.resolve([])),
}));

vi.mock("~/lib/api", () => ({
  groupService: {
    getGroups: vi.fn(() => Promise.resolve([])),
  },
  roomService: {
    getRooms: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock("~/lib/swr", () => ({
  useImmutableSWR: (...args: unknown[]) => mockUseImmutableSWR(...args),
  useLiveRefreshInterval,
  useSWRAuth: (...args: unknown[]) => mockUseSWRAuth(...args),
  mutate: vi.fn(),
  useTenantMutate: () => vi.fn(),
}));

vi.mock("~/lib/swr/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/swr/hooks")>();
  const recordReload: ReturnType<typeof actual.useInvalidateMatching> = (
    matches,
    options,
  ) => (options?.clear ? Promise.resolve([]) : mockRefreshSearch(matches));
  return {
    ...actual,
    useInvalidateMatching() {
      const invalidate = actual.useInvalidateMatching();
      return realStudentReads ? invalidate : recordReload;
    },
  };
});

vi.mock("~/components/students/student-card", () => ({
  StudentCard: ({ studentId }: { studentId: string }) => (
    <div data-testid={`student-card-${studentId}`}>card-{studentId}</div>
  ),
  SchoolClassIcon: () => <span />,
  GroupIcon: () => <span />,
  DepartureModeIcon: () => <span />,
  StudentInfoRow: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PlannedActivityRows: ({
    activities,
  }: {
    activities?: readonly { title: string }[];
  }) => (
    <div data-testid="planned-activity-rows">
      {(activities ?? []).map((activity) => activity.title).join(", ")}
    </div>
  ),
  PickupTimeRow: () => <div />,
  ArrivalTimeRow: () => <div />,
}));

import { ApiError } from "~/lib/api-error";
import { ToastProvider } from "~/contexts/ToastContext";
import { liftAllRefusals, refusalFor } from "~/lib/access-refusal";
import type { StudentFilters } from "~/lib/student-api";
import { initialStudentSearch } from "~/lib/student-search-url";
import { IsolatedSWRCache, SWRSeedBoundary } from "~/lib/swr/config-boundaries";
import {
  useSWRAuth as useRealSWRAuth,
  type ReaderOptions,
} from "~/lib/swr/hooks";
import {
  LIVE_FALLBACK_INTERVAL_MS,
  useLiveRefreshInterval,
} from "~/lib/swr/live-sync";
import { studentKeys as studentKey } from "~/lib/swr/portal-keys";
import { SEARCH_STUDENTS_REFRESH_OPTIONS } from "~/lib/swr/search-students-key";
import {
  authGeneration,
  resetSWRScope,
  scopedSWRKey,
  tenantSWRScope,
} from "~/lib/swr/scope";
import { useSWRSeedFrom } from "~/lib/swr/seed";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { releaseFakeTimers, testClockDay } from "~/test/clock";
import { deferred } from "~/test/helpers/form-modal-pending";
import StudentSearchPage from "./page-content";

const STORAGE_KEY = "student-search:last-filters:tenant-2:3";
const STALL_MESSAGE =
  "Die Kinder laden gerade sehr lange. Bitte lade die Liste noch einmal.";
const rosterKey = studentKey.search(
  initialStudentSearch(new URLSearchParams(), testClockDay(0), true),
);
const rosterProbeKey = studentKey.searchRosterProbe(
  initialStudentSearch(new URLSearchParams(), testClockDay(0), true),
);
const scopedRosterKey = scopedSWRKey(tenantSWRScope("t", "3"), rosterKey);
function nameKey(search: string) {
  return studentKey.search(
    initialStudentSearch(
      new URLSearchParams({ search }),
      testClockDay(0),
      true,
    ),
  );
}
const namedKey = nameKey("Mila");

const mockStudent = {
  id: "7",
  first_name: "Max",
  second_name: "Mustermann",
  school_class: "1a",
  current_location: "Anwesend",
  has_full_access: true,
  bus: true,
};

let studentsResponse: {
  data: unknown;
  isLoading: boolean;
  error: unknown;
};
let studentKeys: string[] = [];

function storedFilters() {
  return localStorage.getItem(STORAGE_KEY);
}

function renderOnSearchPage(
  search: string,
  wrapper?: typeof IsolatedSWRCache,
  content = <StudentSearchPage />,
) {
  window.history.replaceState(null, "", `/students/search${search}`);
  currentSearch = new URLSearchParams(search);
  const navLink = document.createElement("a");
  navLink.href = "/students/search";
  navLink.textContent = "Alle Kinder (Navigation)";
  document.body.appendChild(navLink);
  const view = render(content, { wrapper });
  return { ...view, navLink };
}

function renderWithRealStudentReads(
  search: string,
  {
    defaultCache = false,
    fallback = {} as Record<string, unknown>,
    content = <StudentSearchPage />,
  } = {},
) {
  realStudentReads = true;
  const reload = new Map<string, () => Promise<unknown>>();
  let preview: (id: string) => ReturnType<typeof studentKey.preview>;
  function PreviewProbe() {
    const seedFrom = useSWRSeedFrom();
    preview = (id) =>
      seedFrom(studentKey.previewSources, studentKey.detail(id), (data) =>
        studentKey.preview(data, id),
      );
    return null;
  }
  function CacheWithPreview({ children }: { children: React.ReactNode }) {
    return (
      <IsolatedSWRCache>
        <SWRSeedBoundary seed={{ fallback, cacheData: {} }}>
          {children}
        </SWRSeedBoundary>
        <PreviewProbe />
      </IsolatedSWRCache>
    );
  }
  function useStudentReads(
    key: string | null,
    fetcher: () => Promise<unknown>,
    options?: ReaderOptions<unknown, Error>,
  ) {
    const studentKey = key?.startsWith("search-students-") ? key : null;
    const read = useRealSWRAuth(studentKey, fetcher, {
      ...options,
      shouldRetryOnError: false,
    });
    if (studentKey) reload.set(studentKey, read.mutate);
    return read;
  }
  mockUseSWRAuth.mockImplementation(useStudentReads);
  return {
    ...renderOnSearchPage(
      search,
      defaultCache ? undefined : CacheWithPreview,
      content,
    ),
    reload,
    preview: (id: string) => preview(id),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockParentAnnouncementsAvailable.mockReturnValue(false);
  realStudentReads = false;
  localStorage.clear();
  // The stored filters belong to the signed-in account (#5000).
  localStorage.setItem("moto:personal-storage-owner", "2:3");
  sessionState.error = undefined;
  sessionState.status = "authenticated";
  studentKeys = [];
  studentsResponse = {
    data: { students: [mockStudent] },
    isLoading: false,
    error: undefined,
  };

  mockUseImmutableSWR.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  });
  mockUseSWRAuth.mockImplementation((key: string | null, _fetcher, options) => {
    if (key?.startsWith("search-students-") && !options?.isPaused?.()) {
      studentKeys.push(key);
      return { ...studentsResponse, mutate: mockMutateStudents };
    }
    return { data: undefined, isLoading: false, error: undefined };
  });
  mockGetStudents.mockResolvedValue({ students: [mockStudent] });
});

afterEach(() => {
  cleanup();
  liftAllRefusals();
  document.body.innerHTML = "";
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("StudentSearchPage: click on the navigation entry of this page (#3374)", () => {
  it("drops filters, URL parameters and stored filters", async () => {
    const { navLink } = renderOnSearchPage("?bus=yes&sort=class");

    await waitFor(() => {
      expect(storedFilters()).toContain("yes");
    });
    const filteredKey = studentKeys.at(-1);

    fireEvent.click(navLink);

    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    expect(storedFilters()).toBeNull();
    // The request key is what SWR fetches by: a changed key is the fresh,
    // unfiltered request, so no forced revalidation of the old one on top.
    expect(studentKeys.at(-1)).not.toBe(filteredKey);
    expect(mockRefreshSearch).not.toHaveBeenCalled();
  });

  it("clears a name search", async () => {
    const { navLink } = renderOnSearchPage("");
    const unfilteredKey = studentKeys.at(-1);

    const [searchInput] = screen.getAllByPlaceholderText("Name suchen…");
    fireEvent.change(searchInput!, { target: { value: "Mila" } });
    // The term narrows the loaded list in the browser: Max is no match.
    // Anker: the local search finished with no matching children.
    expect(await screen.findByText("Keine Kinder gefunden")).toBeVisible();
    expect(screen.queryByTestId("student-card-7")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("search")).toBe(
      "Mila",
    );

    fireEvent.click(navLink);

    expect(await screen.findByTestId("student-card-7")).toBeTruthy();
    expect(studentKeys.at(-1)).toBe(unfilteredKey);
    expect(
      (screen.getAllByPlaceholderText("Name suchen…")[0] as HTMLInputElement)
        .value,
    ).toBe("");
    expect(window.location.search).toBe("");
  });

  it("searches the loaded list without asking the server per term", async () => {
    renderOnSearchPage("");
    const unfilteredKey = studentKeys.at(-1);
    const [searchInput] = screen.getAllByPlaceholderText("Name suchen…");

    fireEvent.change(searchInput!, { target: { value: "must" } });
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("search")).toBe(
        "must",
      );
    });
    expect(screen.getByTestId("student-card-7")).toBeTruthy();

    fireEvent.change(searchInput!, { target: { value: "muster frau" } });
    // Anker: the second search finished, rather than showing a skeleton.
    expect(await screen.findByText("Keine Kinder gefunden")).toBeVisible();
    expect(screen.queryByTestId("student-card-7")).toBeNull();
    expect(new Set(studentKeys)).toEqual(new Set([unfilteredKey]));
  });

  it("does not open a parent letter until the typed search matches the list", async () => {
    mockParentAnnouncementsAvailable.mockReturnValue(true);
    renderOnSearchPage("");
    const [input] = screen.getAllByPlaceholderText("Name suchen…");
    fireEvent.change(input!, { target: { value: "Ma" } });
    const [menu] = screen.getAllByRole("button", { name: "Weitere Aktionen" });
    fireEvent.click(menu!);
    const letter = screen.getByRole("menuitem", {
      name: /Elternbrief schreiben/,
    });
    expect(letter).toBeDisabled();
    fireEvent.click(letter);
    expect(mockPush).not.toHaveBeenCalled();
    await waitFor(() => expect(letter).toBeEnabled());
    fireEvent.click(letter);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("excludes nonmatching children while a server search is loading", async () => {
    studentsResponse = {
      data: {
        students: [mockStudent],
        truncatedTotal: 30000,
      },
      isLoading: false,
      error: undefined,
    };
    const rosterReader = mockUseSWRAuth.getMockImplementation()!;
    let matches: (typeof mockStudent)[] | undefined;
    mockUseSWRAuth.mockImplementation((key, fetcher, options) =>
      key === namedKey
        ? {
            data: matches
              ? { students: matches }
              : options?.keepPreviousData
                ? studentsResponse.data
                : undefined,
            isLoading: !matches,
            error: undefined,
          }
        : rosterReader(key, fetcher, options),
    );
    const { rerender } = renderOnSearchPage("");
    const [searchInput] = screen.getAllByPlaceholderText("Name suchen…");
    expect(screen.getByTestId("student-card-7")).toBeTruthy();
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("1");

    fireEvent.change(searchInput!, { target: { value: "Mila" } });

    await screen.findByTestId("student-card-grid-skeleton");
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("0");

    matches = [{ ...mockStudent, id: "8", first_name: "Mila" }];
    rerender(<StudentSearchPage />);
    // Anker: the named response is on screen.
    expect(screen.getByTestId("student-card-8")).toBeTruthy();
    expect(screen.queryByTestId("student-card-7")).toBeNull();
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("1");
  });

  it.each([undefined, new Error("Roster page failed")])(
    "shows a saved name search independently of the roster (%s)",
    (error) => {
      studentsResponse = { data: undefined, isLoading: !error, error };
      const rosterReader = mockUseSWRAuth.getMockImplementation()!;
      mockUseSWRAuth.mockImplementation((key, fetcher, options) =>
        key === namedKey
          ? {
              data: {
                students: [{ ...mockStudent, id: "8", first_name: "Mila" }],
              },
              isLoading: false,
              error: undefined,
            }
          : rosterReader(key, fetcher, options),
      );

      renderOnSearchPage("?search=Mila");

      expect(screen.getByTestId("student-card-8")).toBeTruthy();
      expect(studentKeys).toContain(rosterProbeKey);
    },
  );

  it.each([401, 403])(
    "does not show cached name matches after the roster refuses access (%s)",
    (status) => {
      studentsResponse = { data: undefined, isLoading: true, error: undefined };
      const rosterReader = mockUseSWRAuth.getMockImplementation()!;
      mockUseSWRAuth.mockImplementation((key, fetcher, options) =>
        key === namedKey
          ? {
              data: {
                students: [{ ...mockStudent, id: "8", first_name: "Mila" }],
              },
              isLoading: false,
              error: undefined,
            }
          : rosterReader(key, fetcher, options),
      );
      const { rerender } = renderOnSearchPage("?search=Mila");
      expect(screen.getByTestId("student-card-8")).toBeVisible();
      expect(screen.getByTestId("select-all-count")).toHaveTextContent("1");

      studentsResponse = {
        data: undefined,
        isLoading: false,
        error: new ApiError("Access refused", status),
      };
      rerender(<StudentSearchPage />);

      // Anker: the search stays visible, but refused rows cannot be acted on.
      expect(screen.getAllByPlaceholderText("Name suchen…")[0]).toBeVisible();
      expect(screen.queryByTestId("select-all-count")).toBeNull();
      expect(screen.queryByTestId("student-card-8")).toBeNull();
    },
  );

  it("does not restore cached name matches after a refused roster retry fails", async () => {
    const roster = deferred<{
      students: (typeof mockStudent)[];
    }>();
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    mockGetStudents.mockImplementation(({ search }: StudentFilters) =>
      search ? Promise.resolve({ students: [mila] }) : roster.promise,
    );
    const { reload } = renderWithRealStudentReads("?search=Mila");
    expect(await screen.findByTestId("student-card-8")).toBeVisible();

    await act(async () => roster.reject(new ApiError("Access refused", 403)));
    expect(refusalFor(scopedRosterKey)).toMatchObject({ status: 403 });
    expect(screen.queryByTestId("select-all-count")).toBeNull();

    mockGetStudents.mockRejectedValueOnce(new ApiError("Unavailable", 503));
    await act(async () => {
      await reload.get(rosterProbeKey)!();
    });
    // Anker: the transient failure has its retry action instead of results.
    const retry = await screen.findByRole("button", { name: "Wiederholen" });
    expect(retry).toBeVisible();
    expect(screen.queryByTestId("student-card-8")).toBeNull();
    expect(screen.queryByTestId("select-all-count")).toBeNull();

    mockGetStudents.mockResolvedValueOnce({ students: [mila] });
    fireEvent.click(retry);
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("1");
  });

  it.each([false, true])(
    "ignores a named refusal from the replaced request (retry failed: %s)",
    async (retryFailed) => {
      const oldMila = deferred<{ students: (typeof mockStudent)[] }>();
      const retryMila = deferred<{ students: (typeof mockStudent)[] }>();
      const roster = deferred<{ students: (typeof mockStudent)[] }>();
      const mila = { ...mockStudent, id: "8", first_name: "Mila" };
      let milaReads = 0;
      mockGetStudents.mockImplementation(({ search }: StudentFilters) => {
        if (!search) return roster.promise;
        if (search === "Max")
          return Promise.resolve({ students: [mockStudent] });
        return ++milaReads === 1 ? oldMila.promise : retryMila.promise;
      });
      vi.useFakeTimers();
      try {
        renderWithRealStudentReads("?search=Mila");
        act(() => vi.advanceTimersByTime(10_000));
        fireEvent.click(screen.getByRole("button", { name: "Erneut laden" }));
      } finally {
        releaseFakeTimers();
      }
      await waitFor(() => expect(milaReads).toBe(2));
      if (retryFailed) {
        await act(async () =>
          retryMila.reject(new ApiError("Retry failed", 503)),
        );
        expect(
          await screen.findByRole("button", { name: "Wiederholen" }),
        ).toBeVisible();
      }
      await act(async () => oldMila.reject(new ApiError("Old refusal", 403)));
      expect(milaReads).toBe(2);
      if (retryFailed) {
        expect(
          screen.getByRole("button", { name: "Wiederholen" }),
        ).toBeVisible();
        return;
      }
      await act(async () => retryMila.resolve({ students: [mila] }));
      expect(await screen.findByTestId("student-card-8")).toBeVisible();

      const [search] = screen.getAllByPlaceholderText("Name suchen…");
      fireEvent.change(search!, { target: { value: "Max" } });
      expect(await screen.findByTestId("student-card-7")).toBeVisible();

      expect(screen.getByTestId("student-card-7")).toBeVisible();
      expect(screen.getByTestId("select-all-count")).toHaveTextContent("1");
    },
  );

  it("uses saved name results until a current roster is confirmed", async () => {
    const freshRoster = deferred<{ students: (typeof mockStudent)[] }>();
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    const { rerender, reload } = renderWithRealStudentReads("?search=Max");
    expect(await screen.findByTestId("student-card-7")).toBeVisible();
    await act(async () => {
      await reload.get(rosterProbeKey)!();
    });

    const refreshed = vi.fn(() => freshRoster.promise);
    mockGetStudents.mockImplementation(({ search }: StudentFilters) =>
      search
        ? Promise.resolve({
            students: search === "Max" ? [mockStudent] : [mila],
          })
        : refreshed(),
    );
    currentSearch = new URLSearchParams({ search: "Mila" });
    window.history.replaceState(null, "", "/students/search?search=Mila");
    rerender(<StudentSearchPage key="saved-search" />);
    expect(await screen.findByTestId("student-card-8")).toBeVisible();

    const [search] = screen.getAllByPlaceholderText("Name suchen…");
    fireEvent.change(search!, { target: { value: "Mil" } });
    await waitFor(() =>
      expect(mockGetStudents).toHaveBeenCalledWith(
        expect.objectContaining({ search: "Mil" }),
      ),
    );
    expect(await screen.findByTestId("student-card-8")).toBeVisible();

    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1));
    await act(async () =>
      freshRoster.resolve({ students: [mila, mockStudent] }),
    );
    const recordedCalls = mockGetStudents.mock.calls.length;
    fireEvent.change(search!, { target: { value: "Max" } });
    expect(await screen.findByTestId("student-card-7")).toBeVisible();
    expect(mockGetStudents).toHaveBeenCalledTimes(recordedCalls);
  });

  it("retires cached and pending name reads when a complete roster takes over", async () => {
    const roster = deferred<{ students: (typeof mockStudent)[] }>();
    const lateName = deferred<{ students: (typeof mockStudent)[] }>();
    const oldMila = { ...mockStudent, id: "8", first_name: "Mila" };
    const newMila = { ...oldMila, id: "9" };
    mockGetStudents.mockImplementation(({ search }: StudentFilters) =>
      search ? Promise.resolve({ students: [oldMila] }) : roster.promise,
    );
    const { preview, reload, rerender } =
      renderWithRealStudentReads("?search=Mila");
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
    expect(preview("8")?.name).toBe("Mila Mustermann");

    mockGetStudents.mockReturnValueOnce(lateName.promise);
    act(() => void reload.get(namedKey)!());
    await act(async () => roster.resolve({ students: [newMila] }));
    // Anker: the roster now supplies the result and the detail preview.
    expect(screen.getByTestId("student-card-9")).toBeVisible();
    expect(preview("9")?.name).toBe("Mila Mustermann");
    expect(preview("8")).toBeUndefined();

    await act(async () => lateName.reject(new ApiError("Old refusal", 403)));
    expect(screen.getByTestId("student-card-9")).toBeVisible();
    expect(preview("9")?.name).toBe("Mila Mustermann");

    const pending = deferred<{ students: (typeof mockStudent)[] }>();
    mockGetStudents.mockReturnValue(pending.promise);
    rerender(<StudentSearchPage key="saved-search-reopened" />);
    // Anker: the reopened search has no rows to select while loading.
    expect(screen.getByTestId("student-card-grid-skeleton")).toBeVisible();
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("0");
    expect(screen.queryByTestId("student-card-8")).toBeNull();
    await act(async () => pending.resolve({ students: [newMila] }));
    expect(screen.getByTestId("student-card-9")).toBeVisible();
  });

  it.each(["", "?search=Max"])(
    "keeps filtering a complete roster after a 503 (%s)",
    async (url) => {
      const { reload } = renderWithRealStudentReads(url);
      const key = url ? rosterProbeKey : rosterKey;
      await act(async () => {
        await reload.get(key)!();
      });
      expect(await screen.findByTestId("student-card-7")).toBeVisible();
      mockGetStudents.mockRejectedValue(new ApiError("Unavailable", 503));
      await act(async () => {
        await reload.get(key)!();
      });
      const reads = mockGetStudents.mock.calls.length;

      const [search] = screen.getAllByPlaceholderText("Name suchen…");
      fireEvent.change(search!, { target: { value: "Ma" } });
      await waitFor(() =>
        expect(new URLSearchParams(window.location.search).get("search")).toBe(
          "Ma",
        ),
      );
      expect(screen.getByTestId("student-card-7")).toBeVisible();
      expect(mockGetStudents).toHaveBeenCalledTimes(reads);
    },
  );

  it.each(["", "?search=Max"])(
    "refreshes the active roster without a live stream (%s)",
    async (url) => {
      vi.useFakeTimers();
      try {
        const { reload } = renderWithRealStudentReads(url);
        await act(async () => {
          await reload.get(url ? rosterProbeKey : rosterKey)!();
        });
        expect(screen.getByTestId("student-card-7")).toBeVisible();
        mockGetStudents.mockResolvedValue({ students: [] });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(LIVE_FALLBACK_INTERVAL_MS);
        });
        expect(screen.getByText("Keine Kinder gefunden")).toBeVisible();
      } finally {
        releaseFakeTimers();
      }
    },
  );

  it("refreshes a confirmed saved search when React shows it again", async () => {
    function view(mode: "hidden" | "visible") {
      return (
        <Activity mode={mode}>
          <StudentSearchPage />
        </Activity>
      );
    }
    const { rerender, reload } = renderWithRealStudentReads("?search=Max");
    rerender(view("visible"));
    await act(async () => {
      await reload.get(rosterProbeKey)!();
    });
    expect(screen.getByTestId("student-card-7")).toBeVisible();

    rerender(view("hidden"));
    mockGetStudents.mockResolvedValue({ students: [] });
    rerender(view("visible"));

    expect(await screen.findByText("Keine Kinder gefunden")).toBeVisible();
  });

  it.each([408, 503])(
    "continues polling after HTTP %s but does not poll a refusal",
    async (status) => {
      vi.useFakeTimers();
      try {
        const { reload } = renderWithRealStudentReads("?search=Max");
        await act(async () => {
          await reload.get(rosterProbeKey)!();
        });
        expect(screen.getByTestId("student-card-7")).toBeVisible();
        const advancePoll = () =>
          act(async () => {
            await vi.advanceTimersByTimeAsync(LIVE_FALLBACK_INTERVAL_MS);
          });
        const unavailable = vi
          .fn()
          .mockRejectedValue(new ApiError("Unavailable", status));
        mockGetStudents.mockImplementation(unavailable);
        await advancePoll();
        expect(unavailable).toHaveBeenCalledTimes(1);
        await advancePoll();
        expect(unavailable).toHaveBeenCalledTimes(2);

        mockGetStudents.mockResolvedValue({ students: [] });
        await advancePoll();
        expect(screen.getByText("Keine Kinder gefunden")).toBeVisible();

        mockGetStudents.mockRejectedValue(new ApiError("Access refused", 403));
        await advancePoll();
        expect(refusalFor(scopedRosterKey)).toMatchObject({ status: 403 });
        const reads = mockGetStudents.mock.calls.length;
        await advancePoll();
        expect(mockGetStudents).toHaveBeenCalledTimes(reads);
      } finally {
        releaseFakeTimers();
      }
    },
  );

  it("keeps exact name matches after a 503, but withdraws them on refusal", async () => {
    const firstPage = deferred<{ students: (typeof mockStudent)[] }>();
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    mockGetStudents.mockImplementation(({ search }: StudentFilters) =>
      search ? Promise.resolve({ students: [mila] }) : firstPage.promise,
    );
    const { reload } = renderWithRealStudentReads("?search=Mila");
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
    mockGetStudents.mockRejectedValueOnce(new ApiError("Unavailable", 503));
    await act(async () => {
      await reload.get(namedKey)!();
    });
    expect(
      await screen.findByRole("button", { name: "Wiederholen" }),
    ).toBeVisible();
    expect(screen.getByTestId("student-card-8")).toBeVisible();

    const refusal = new ApiError("Access refused", 403);
    mockGetStudents.mockRejectedValueOnce(refusal);
    await act(async () => {
      await reload.get(namedKey)!();
    });
    // Anker: the family is refused, not merely waiting on new results.
    expect(refusalFor(scopedRosterKey)).toBe(refusal);
    expect(screen.queryByTestId("student-card-8")).toBeNull();
    await act(async () => firstPage.resolve({ students: [mila] }));
  });

  it("retries a cached probe failure once on each saved-search opening", async () => {
    const { reload, rerender } = renderWithRealStudentReads("?search=Max");
    await act(async () => {
      await reload.get(rosterProbeKey)!();
    });
    const failProbe = vi.fn(async () => {
      throw new ApiError("Unavailable", 503);
    });
    mockGetStudents.mockImplementation(({ search }: StudentFilters) =>
      search ? Promise.resolve({ students: [mockStudent] }) : failProbe(),
    );
    await act(async () => {
      await reload.get(rosterProbeKey)!();
    });
    await act(async () =>
      rerender(<StudentSearchPage key="while-unavailable" />),
    );
    expect(failProbe).toHaveBeenCalledTimes(2);

    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    const liveRoster = vi.fn(async () => ({ students: [mockStudent, mila] }));
    mockGetStudents.mockImplementation(({ search }: StudentFilters) =>
      search ? Promise.resolve({ students: [mockStudent] }) : liveRoster(),
    );
    await act(async () => rerender(<StudentSearchPage key="recovered" />));
    expect(liveRoster).toHaveBeenCalledTimes(1);
    const reads = mockGetStudents.mock.calls.length;
    const [search] = screen.getAllByPlaceholderText("Name suchen…");
    fireEvent.change(search!, { target: { value: "Mil" } });
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
    expect(mockGetStudents).toHaveBeenCalledTimes(reads);
  });

  it("refreshes a saved search when its previous filter becomes active again", async () => {
    const { reload } = renderWithRealStudentReads("?search=Max");
    await act(async () => {
      await reload.get(rosterProbeKey)!();
    });
    const otherFilter = deferred<{ students: (typeof mockStudent)[] }>();
    const returning = vi.fn(async () => ({ students: [] }));
    mockGetStudents.mockImplementation(({ search, bus }: StudentFilters) =>
      search
        ? Promise.resolve({ students: [mockStudent] })
        : bus === "yes"
          ? otherFilter.promise
          : returning(),
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Filter(?:,|$)/ })[0]!,
    );
    fireEvent.click((await screen.findAllByTestId("filter-bus"))[0]!);
    fireEvent.click(
      (await screen.findAllByRole("option", { name: "Buskind" }))[0]!,
    );
    await waitFor(() =>
      expect(mockGetStudents).toHaveBeenCalledWith(
        expect.objectContaining({ search: "", bus: "yes" }),
      ),
    );
    fireEvent.click((await screen.findAllByTestId("filter-bus"))[0]!);
    fireEvent.click(
      (await screen.findAllByRole("option", { name: "Alle Kinder" }))[0]!,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter schließen" }));
    expect(await screen.findByText("Keine Kinder gefunden")).toBeVisible();
    expect(returning).toHaveBeenCalledTimes(1);
    await act(async () => otherFilter.resolve({ students: [mockStudent] }));
  });

  it("does not offer unconfirmed probe rows after clearing a reopened search", async () => {
    const { reload, rerender } = renderWithRealStudentReads("?search=Max");
    await act(async () => {
      await reload.get(rosterProbeKey)!();
    });
    const probe = deferred<{ students: (typeof mockStudent)[] }>();
    const full = deferred<{ students: (typeof mockStudent)[] }>();
    mockGetStudents
      .mockImplementationOnce(() => probe.promise)
      .mockImplementation(() => full.promise);
    rerender(<StudentSearchPage key="reopened" />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Suche löschen" })[0]!,
    );
    expect(
      await screen.findByTestId("student-card-grid-skeleton"),
    ).toBeVisible();
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("0");
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    await act(async () => {
      probe.resolve({ students: [mockStudent] });
      full.resolve({ students: [mila] });
    });
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
  });

  it("filters this opening's confirmed probe while the full roster is unavailable", async () => {
    const { reload } = renderWithRealStudentReads("?search=Max");
    await act(async () => {
      await reload.get(rosterProbeKey)!();
    });
    const full = deferred<{ students: (typeof mockStudent)[] }>();
    mockGetStudents.mockImplementation(() => full.promise);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Suche löschen" })[0]!,
    );
    expect(screen.getByTestId("student-card-7")).toBeVisible();
    await waitFor(() =>
      expect(mockGetStudents).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "" }),
      ),
    );
    const reads = mockGetStudents.mock.calls.length;
    const [search] = screen.getAllByPlaceholderText("Name suchen…");
    fireEvent.change(search!, { target: { value: "Ma" } });
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("search")).toBe(
        "Ma",
      ),
    );
    expect(mockGetStudents).toHaveBeenCalledTimes(reads);
    await act(async () => full.reject(new ApiError("Unavailable", 503)));
    expect(
      await screen.findByRole("button", { name: "Wiederholen" }),
    ).toBeVisible();
    expect(screen.getByTestId("student-card-7")).toBeVisible();
    fireEvent.change(search!, { target: { value: "Mila" } });
    await waitFor(() =>
      expect(screen.queryByTestId("student-card-7")).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Wiederholen" })).toBeVisible();
    mockGetStudents.mockResolvedValue({ students: [mockStudent] });
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() =>
      expect(mockGetStudents).toHaveBeenCalledTimes(reads + 1),
    );
    expect(mockGetStudents).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "" }),
    );
  });

  it("keeps newer probe rows while refreshing a cached full roster on clear", async () => {
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    const { rerender, reload } = renderWithRealStudentReads("");
    expect(await screen.findByTestId("student-card-7")).toBeVisible();
    mockGetStudents.mockResolvedValue({ students: [mila] });
    currentSearch = new URLSearchParams({ search: "Mila" });
    window.history.replaceState(null, "", "/students/search?search=Mila");
    rerender(<StudentSearchPage key="saved-search" />);
    await act(async () => {
      await reload.get(rosterProbeKey)!();
    });
    expect(screen.getByTestId("student-card-8")).toBeVisible();

    const full = deferred<{ students: (typeof mockStudent)[] }>();
    const refreshFull = vi.fn(() => full.promise);
    mockGetStudents.mockImplementation(refreshFull);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Suche löschen" })[0]!,
    );

    // Anker: the confirmed result remains available without reviving Max.
    expect(screen.getByTestId("student-card-8")).toBeVisible();
    expect(screen.queryByTestId("student-card-7")).toBeNull();
    await waitFor(() => expect(refreshFull).toHaveBeenCalledTimes(1));
    await act(async () => full.resolve({ students: [] }));
    expect(await screen.findByText("Keine Kinder gefunden")).toBeVisible();
  });

  it("expands an incomplete saved search instead of restoring a cached full list", async () => {
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    const { rerender, reload } = renderWithRealStudentReads("");
    expect(await screen.findByTestId("student-card-7")).toBeVisible();
    mockGetStudents.mockImplementation(({ search }: StudentFilters) =>
      Promise.resolve({
        students: [mila],
        ...(search
          ? {}
          : { pagination: { total_pages: 25, total_records: 25000 } }),
      }),
    );
    currentSearch = new URLSearchParams({ search: "Mila" });
    window.history.replaceState(null, "", "/students/search?search=Mila");
    rerender(<StudentSearchPage key="saved-search" />);
    await act(async () => {
      await reload.get(rosterProbeKey)!();
    });
    expect(await screen.findByTestId("student-card-8")).toBeVisible();

    const full = deferred<{ students: (typeof mockStudent)[] }>();
    const refreshFull = vi.fn(() => full.promise);
    mockGetStudents.mockImplementation(refreshFull);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Suche löschen" })[0]!,
    );

    await waitFor(() => expect(refreshFull).toHaveBeenCalledTimes(1));
    // Anker: the older roster is not selectable during the deferred read.
    expect(screen.getByTestId("student-card-grid-skeleton")).toBeVisible();
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("0");
    await act(async () => full.resolve({ students: [mila] }));
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
  });

  it("does not use a late probe for previews after the full roster took over", async () => {
    const probe = deferred<{ students: (typeof mockStudent)[] }>();
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    const lia = { ...mockStudent, id: "9", first_name: "Lia" };
    const readProbe = vi.fn(() => probe.promise);
    mockGetStudents.mockImplementation(({ search }: StudentFilters) =>
      search ? Promise.resolve({ students: [mila] }) : readProbe(),
    );
    const { preview } = renderWithRealStudentReads("?search=Mila");
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
    expect(readProbe).toHaveBeenCalledTimes(1);
    mockGetStudents.mockResolvedValue({ students: [lia] });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Suche löschen" })[0]!,
    );
    expect(await screen.findByTestId("student-card-9")).toBeVisible();
    await act(async () => probe.resolve({ students: [mockStudent] }));

    // Anker: the live full roster can seed a preview, the old probe cannot.
    expect(preview("9")?.name).toBe("Lia Mustermann");
    expect(preview("7")).toBeUndefined();
  });

  it("does not mistake visible server start data for a finished roster refresh", async () => {
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    const cached = { students: [mockStudent], truncatedTotal: null };
    const { reload } = renderWithRealStudentReads("", {
      fallback: { [scopedRosterKey]: cached },
    });
    expect(await screen.findByTestId("student-card-7")).toBeVisible();
    await act(async () => {
      await reload.get(rosterKey)!();
    });

    const [search] = screen.getAllByPlaceholderText("Name suchen…");
    fireEvent.change(search!, { target: { value: "Mil" } });
    expect(await screen.findByText("Keine Kinder gefunden")).toBeVisible();
    mockGetStudents.mockImplementation(({ search, page }: StudentFilters) =>
      Promise.resolve(
        search
          ? { students: [mila] }
          : {
              students: page ? [] : cached.students,
              pagination: { total_pages: 25, total_records: 25000 },
            },
      ),
    );
    await act(async () => {
      await reload.get(rosterKey)!();
    });
    expect(await screen.findByTestId("student-card-8")).toBeVisible();

    const resumedRoster = vi.fn(async (_filters: StudentFilters) => ({
      students: [mila],
    }));
    mockGetStudents.mockImplementation(resumedRoster);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Suche löschen" })[0]!,
    );
    await waitFor(() =>
      expect(resumedRoster).toHaveBeenCalledWith(
        expect.objectContaining({ search: "" }),
      ),
    );
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
    expect(screen.queryByTestId("student-card-7")).toBeNull();
  });

  it("keeps loaded roster pages visible when clearing a name after a deferred refresh", async () => {
    const expansion = deferred<{ students: (typeof mockStudent)[] }>();
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    const pagination = { total_pages: 25, total_records: 25000 };
    let holdFirstPage = false;
    mockGetStudents.mockImplementation(({ search, page }: StudentFilters) => {
      if (search) return Promise.resolve({ students: [mila] });
      if (!page && holdFirstPage) return expansion.promise;
      return Promise.resolve({
        students: page === 2 ? [mockStudent] : [],
        pagination,
      });
    });
    const { reload, preview } = renderWithRealStudentReads("", {
      fallback: {
        [scopedRosterKey]: { students: [mila], truncatedTotal: 25000 },
      },
    });
    expect(await screen.findByTestId("student-card-7")).toBeVisible();
    const [search] = screen.getAllByPlaceholderText("Name suchen…");
    fireEvent.change(search!, { target: { value: "Mila" } });
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
    await act(async () => {
      await reload.get(rosterKey)!();
    });

    holdFirstPage = true;
    fireEvent.click(
      screen.getAllByRole("button", { name: "Suche löschen" })[0]!,
    );

    expect(screen.getByTestId("student-card-7")).toBeVisible();
    expect(preview("7")?.name).toBe("Max Mustermann");
    // Anker: retained rows are visible for lookup, but not attendance writes.
    expect(screen.queryByTestId("select-all-count")).toBeNull();
    expect(
      screen.getByText(/nur die ersten 1 von 25000 Kindern/),
    ).toBeVisible();

    await act(async () => expansion.resolve({ students: [mila] }));
    // Anker: the retained rows were replaced by the new roster.
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
    expect(screen.queryByTestId("student-card-7")).toBeNull();
    expect(preview("7")).toBeUndefined();
  });

  it("stops walking roster pages after a replacement read starts", async () => {
    const pagination = { total_pages: 25, total_records: 25000 };
    const secondPage = deferred<{ students: (typeof mockStudent)[] }>();
    mockGetStudents
      .mockResolvedValueOnce({ students: [mockStudent], pagination })
      .mockReturnValueOnce(secondPage.promise);
    const { navLink } = renderWithRealStudentReads("");
    await waitFor(() => expect(mockGetStudents).toHaveBeenCalledTimes(2));
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    mockGetStudents.mockResolvedValue({ students: [mila] });
    fireEvent.click(navLink);
    expect(await screen.findByTestId("student-card-8")).toBeVisible();

    await act(async () => secondPage.resolve({ students: [mockStudent] }));
    expect(mockGetStudents).toHaveBeenCalledTimes(3);
  });

  it("rejects a roster answer from before the named search refused access", async () => {
    const roster = deferred<{ students: (typeof mockStudent)[] }>();
    const named = deferred<{ students: (typeof mockStudent)[] }>();
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    mockGetStudents.mockImplementation(({ search }: StudentFilters) =>
      search ? named.promise : roster.promise,
    );
    const { reload } = renderWithRealStudentReads("?search=Mila");
    await waitFor(() => expect(mockGetStudents).toHaveBeenCalledTimes(2));

    const refusal = new ApiError("Access refused", 403);
    await act(async () => named.reject(refusal));
    await act(async () => roster.resolve({ students: [mila] }));

    // Anker: the late success did not lift the refusal or trigger another read.
    expect(refusalFor(scopedRosterKey)).toBe(refusal);
    expect(mockGetStudents).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("student-card-8")).toBeNull();

    mockGetStudents.mockResolvedValueOnce({ students: [mila] });
    await act(async () => {
      await reload.get(rosterProbeKey)!();
    });
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("1");
  });

  it.each(["single", "bulk"] as const)(
    "keeps the roster after a late refusal superseded by %s check-in",
    async (kind) => {
      const { useSchoolCheckinMode } = await vi.importActual<
        typeof import("~/lib/hooks/use-school-checkin-mode")
      >("~/lib/hooks/use-school-checkin-mode");
      function CheckinAction() {
        const checkin = useSchoolCheckinMode();
        return (
          <button
            type="button"
            onClick={() =>
              void (kind === "single"
                ? checkin.toggle("7", "abwesend")
                : checkin.runBulk("in", ["7"]))
            }
          >
            Test check-in
          </button>
        );
      }
      resetSWRScope({ revalidate: false });
      mockCheckin.mockResolvedValue(undefined);
      mockBatchCheckin.mockResolvedValue({
        action: "in",
        succeeded: 1,
        failed: 0,
        results: [{ studentId: "7", ok: true, changed: true }],
      });
      const { reload } = renderWithRealStudentReads("", {
        defaultCache: true,
        content: (
          <ToastProvider>
            <StudentSearchPage />
            <CheckinAction />
          </ToastProvider>
        ),
      });
      expect(await screen.findByTestId("student-card-7")).toBeVisible();
      const oldRoster = deferred<{ students: (typeof mockStudent)[] }>();
      const mila = { ...mockStudent, id: "8", first_name: "Mila" };
      mockGetStudents
        .mockReturnValueOnce(oldRoster.promise)
        .mockResolvedValue({ students: [mila] });
      act(() => void reload.get(rosterKey)!());
      vi.useFakeTimers();
      try {
        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: "Test check-in" }),
          );
          await vi.advanceTimersByTimeAsync(
            SEARCH_STUDENTS_REFRESH_OPTIONS.coalesceMs,
          );
        });
      } finally {
        releaseFakeTimers();
      }
      expect(await screen.findByTestId("student-card-8")).toBeVisible();
      await act(async () => oldRoster.reject(new ApiError("Old refusal", 403)));
      // Anker: the replacement roster remains usable for selection.
      expect(screen.getByTestId("student-card-8")).toBeVisible();
      expect(screen.getByTestId("select-all-count")).toHaveTextContent("1");
      expect(refusalFor(scopedRosterKey)).toBeUndefined();
    },
  );

  it.each(["roster", "name"] as const)(
    "withdraws active and inactive name matches from record previews after a %s refusal",
    async (source) => {
      const roster = deferred<{ students: (typeof mockStudent)[] }>();
      const mila = { ...mockStudent, id: "8", first_name: "Mila" };
      mockGetStudents.mockImplementation(({ search }: StudentFilters) => {
        if (!search) return roster.promise;
        return Promise.resolve({
          students: [search === "Mila" ? mila : mockStudent],
        });
      });
      const { reload, preview } = renderWithRealStudentReads("?search=Mila");
      expect(await screen.findByTestId("student-card-8")).toBeVisible();
      expect(preview("8")?.name).toBe("Mila Mustermann");

      const [search] = screen.getAllByPlaceholderText("Name suchen…");
      fireEvent.change(search!, { target: { value: "Max" } });
      expect(await screen.findByTestId("student-card-7")).toBeVisible();
      expect(preview("7")?.name).toBe("Max Mustermann");
      expect(preview("8")?.name).toBe("Mila Mustermann");

      const refusal = new ApiError("Access refused", 403);
      if (source === "roster") {
        await act(async () => roster.reject(refusal));
      } else {
        mockGetStudents.mockRejectedValueOnce(refusal);
        await act(async () => {
          await reload.get(nameKey("Max"))!();
        });
      }
      expect(refusalFor(scopedRosterKey)).toBe(refusal);
      expect(preview("7")).toBeUndefined();
      expect(preview("8")).toBeUndefined();
    },
  );

  it.each([false, true])(
    "binds a late named refusal to its original keys (clear group: %s)",
    async (clearGroup) => {
      const groupId = "7";
      const groupRosterKey = studentKey.search(
        initialStudentSearch(
          new URLSearchParams({ group_id: groupId }),
          testClockDay(0),
          true,
        ),
      );
      const groupNamedKey = studentKey.search(
        initialStudentSearch(
          new URLSearchParams({ group_id: groupId, search: "Mila" }),
          testClockDay(0),
          true,
        ),
      );
      const scope = tenantSWRScope("t", "3");
      const refusal = new ApiError("Access refused", 403);
      const groupRoster = deferred<{
        students: (typeof mockStudent)[];
      }>();
      const namedRefresh = deferred<{
        students: (typeof mockStudent)[];
      }>();
      const mila = { ...mockStudent, id: "8", first_name: "Mila" };
      mockGetStudents.mockImplementation(
        ({ search, groupId }: StudentFilters) => {
          if (search === "Mila") return Promise.resolve({ students: [mila] });
          if (search === "Max" || !groupId?.length)
            return Promise.resolve({ students: [mockStudent] });
          return groupRoster.promise;
        },
      );
      const { navLink, reload } = renderWithRealStudentReads(
        "?group_id=7&search=Mila",
      );
      expect(await screen.findByTestId("student-card-8")).toBeVisible();

      mockGetStudents.mockReturnValueOnce(namedRefresh.promise);
      act(() => {
        void reload.get(groupNamedKey)!();
      });
      if (clearGroup) {
        fireEvent.click(navLink);
      } else {
        const [search] = screen.getAllByPlaceholderText("Name suchen…");
        fireEvent.change(search!, { target: { value: "Max" } });
      }
      expect(await screen.findByTestId("student-card-7")).toBeVisible();

      await act(async () => namedRefresh.reject(refusal));
      expect(refusalFor(scopedSWRKey(scope, groupNamedKey))).toBe(refusal);
      expect(refusalFor(scopedSWRKey(scope, groupRosterKey))).toBe(refusal);
      if (clearGroup) {
        expect(screen.getByTestId("select-all-count")).toHaveTextContent("1");
      } else {
        expect(screen.queryByTestId("select-all-count")).toBeNull();
      }
    },
  );

  it("does not restore the old group when clearing search and group", async () => {
    const rosterReader = mockUseSWRAuth.getMockImplementation()!;
    mockUseSWRAuth.mockImplementation((key, fetcher, options) => {
      if (key?.startsWith("search-students-gall-")) {
        return {
          isLoading: true,
          data: options?.keepPreviousData ? studentsResponse.data : undefined,
        };
      }
      return rosterReader(key, fetcher, options);
    });
    const { navLink } = renderOnSearchPage("?group_id=7&search=Max");
    expect(screen.getByTestId("student-card-7")).toBeVisible();
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("1");

    fireEvent.click(navLink);

    expect(
      await screen.findByTestId("student-card-grid-skeleton"),
    ).toBeVisible();
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("0");
  });

  it("defers excess roster pages during a name lookup and resumes them on clear", async () => {
    const rosterPage = {
      students: [],
      pagination: { total_pages: 25, total_records: 25000 },
    };
    const pageTwo = deferred<typeof rosterPage>();
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    mockGetStudents.mockImplementation(({ search, page }: StudentFilters) => {
      if (search) return Promise.resolve({ students: [mila] });
      if (page === 2) return pageTwo.promise;
      return Promise.resolve({
        ...rosterPage,
        students: page === 20 ? [mockStudent] : [],
      });
    });
    renderWithRealStudentReads("");
    await waitFor(() =>
      expect(mockGetStudents).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );

    const [search] = screen.getAllByPlaceholderText("Name suchen…");
    fireEvent.change(search!, { target: { value: "Mila" } });
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
    await act(async () => pageTwo.resolve(rosterPage));
    expect(mockGetStudents).toHaveBeenCalledTimes(3);

    fireEvent.click(
      screen.getAllByRole("button", { name: "Suche löschen" })[0]!,
    );
    expect(await screen.findByTestId("student-card-7")).toBeVisible();
    expect(mockGetStudents).toHaveBeenCalledTimes(23);
  });

  it("consumes the full roster seed on navigation after a page-one probe", async () => {
    resetSWRScope({ revalidate: false });
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    mockGetStudents.mockImplementation(({ search }: StudentFilters) =>
      Promise.resolve(
        search
          ? { students: [mila] }
          : {
              students: [],
              pagination: { total_pages: 25, total_records: 25000 },
            },
      ),
    );
    const { rerender } = renderWithRealStudentReads("?search=Mila", {
      defaultCache: true,
    });
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
    expect(mockGetStudents).toHaveBeenCalledTimes(2);

    currentSearch = new URLSearchParams();
    window.history.replaceState(null, "", "/students/search");
    const generation = authGeneration({
      user: { id: "3", tenantId: "2" },
      expires: "",
    })!;
    rerender(
      <SWRServerSeed
        claims={[rosterKey]}
        seed={{
          builtAt: Date.now(),
          generation,
          entries: [
            {
              key: rosterKey,
              value: Promise.resolve({
                students: [mockStudent],
                truncatedTotal: 25000,
              }),
            },
          ],
        }}
      >
        <StudentSearchPage />
      </SWRServerSeed>,
    );

    expect(await screen.findByTestId("student-card-7")).toBeVisible();
    expect(mockGetStudents).toHaveBeenCalledTimes(2);
  });

  it("removes a restored name search from the URL", async () => {
    const { navLink } = renderOnSearchPage("?search=Mila");

    expect(
      (screen.getAllByPlaceholderText("Name suchen…")[0] as HTMLInputElement)
        .value,
    ).toBe("Mila");

    fireEvent.click(navLink);

    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    expect(
      (screen.getAllByPlaceholderText("Name suchen…")[0] as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("does not add stored filters to a shared name-search URL", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bus: "yes" }));

    renderOnSearchPage("?search=Mila");

    await waitFor(() => {
      expect(storedFilters()).toBeNull();
    });
    expect(new URLSearchParams(window.location.search).get("bus")).toBeNull();
    expect(
      (screen.getAllByPlaceholderText("Name suchen…")[0] as HTMLInputElement)
        .value,
    ).toBe("Mila");
  });

  it("reloads the list when nothing was filtered", async () => {
    const { navLink } = renderOnSearchPage("");

    fireEvent.click(navLink);

    await waitFor(() => {
      expect(mockRefreshSearch).toHaveBeenCalledTimes(1);
    });
  });

  it("leaves the page alone for a link to another page", () => {
    renderOnSearchPage("?bus=yes");
    const otherLink = document.createElement("a");
    otherLink.href = "/rooms";
    document.body.appendChild(otherLink);

    const filteredKey = studentKeys.at(-1);

    fireEvent.click(otherLink);

    expect(storedFilters()).toContain("yes");
    expect(studentKeys.at(-1)).toBe(filteredKey);
    expect(mockRefreshSearch).not.toHaveBeenCalled();
  });
});

describe("StudentSearchPage: student list that does not finish loading (#3374)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replaces the endless skeleton with a hint and a reload", () => {
    studentsResponse = { data: undefined, isLoading: true, error: undefined };
    renderOnSearchPage("");

    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(screen.queryByText(STALL_MESSAGE)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText(STALL_MESSAGE)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Erneut laden" }));

    expect(mockRefreshSearch).toHaveBeenCalledTimes(1);
    // A session with a token needs no second look; only the list is asked for.
    expect(mockUpdateSession).not.toHaveBeenCalled();
    // The retry gets the full waiting time again before the hint returns.
    expect(screen.queryByText(STALL_MESSAGE)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText(STALL_MESSAGE)).toBeTruthy();
  });

  it("asks for the session again when the token is missing", () => {
    sessionState.error = "RefreshTokenError";
    studentsResponse = { data: undefined, isLoading: false, error: undefined };
    renderOnSearchPage("");

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Erneut laden" }));

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
  });

  it("starts the stall timer only after session initialization", () => {
    sessionState.status = "loading";
    studentsResponse = { data: undefined, isLoading: true, error: undefined };
    const { rerender } = renderOnSearchPage("");

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByText(STALL_MESSAGE)).toBeNull();

    sessionState.status = "authenticated";
    rerender(<StudentSearchPage />);

    act(() => {
      vi.advanceTimersByTime(9_999);
    });
    expect(screen.queryByText(STALL_MESSAGE)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText(STALL_MESSAGE)).toBeTruthy();
  });

  it("shows no hint once the list has loaded", () => {
    renderOnSearchPage("");

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.queryByText(STALL_MESSAGE)).toBeNull();
    expect(screen.getByTestId("student-card-7")).toBeTruthy();
  });

  it("offers the reload next to a load error", async () => {
    // The catalog text loads on demand; findBy needs real timers to wait.
    releaseFakeTimers();
    studentsResponse = {
      data: undefined,
      isLoading: false,
      error: new Error("Failed to fetch"),
    };
    renderOnSearchPage("");

    expect(
      await screen.findByText(
        "Die Liste der Kinder konnte nicht bearbeitet werden. Bitte versuche es später erneut.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Erneut laden" }));

    expect(mockRefreshSearch).toHaveBeenCalledTimes(1);
  });

  it("retries a server error from the error state", async () => {
    releaseFakeTimers();
    studentsResponse = {
      data: undefined,
      isLoading: false,
      error: new ApiError("boom", 503, { code: "general.unavailable" }),
    };
    renderOnSearchPage("");

    fireEvent.click(await screen.findByRole("button", { name: "Wiederholen" }));

    expect(mockRefreshSearch).toHaveBeenCalledTimes(1);
  });
});
