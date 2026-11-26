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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectAllControl } from "~/components/students/school-checkin-select-all";

vi.unmock("swr");

const {
  mockGetStudents,
  mockUseSWRAuth,
  mockUseImmutableSWR,
  mockPush,
  mockMutateStudents,
  mockRefreshSearch,
  mockUpdateSession,
  sessionState,
} = vi.hoisted(() => ({
  mockGetStudents: vi.fn(),
  mockUseSWRAuth: vi.fn(),
  mockUseImmutableSWR: vi.fn(),
  mockPush: vi.fn(),
  mockMutateStudents: vi.fn(),
  mockRefreshSearch: vi.fn(),
  mockUpdateSession: vi.fn(),
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
  useSWRAuth: (...args: unknown[]) => mockUseSWRAuth(...args),
  mutate: vi.fn(),
  useTenantMutate: () => vi.fn(),
}));

vi.mock("~/lib/swr/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/swr/hooks")>();
  return {
    ...actual,
    useInvalidateMatching() {
      const invalidate = actual.useInvalidateMatching();
      return realStudentReads ? invalidate : mockRefreshSearch;
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
  PickupTimeRow: () => <div />,
  ArrivalTimeRow: () => <div />,
}));

import { ApiError } from "~/lib/api-error";
import { liftAllRefusals, refusalFor } from "~/lib/access-refusal";
import type { StudentFilters } from "~/lib/student-api";
import { initialStudentSearch } from "~/lib/student-search-url";
import { IsolatedSWRCache } from "~/lib/swr/config-boundaries";
import {
  useSWRAuth as useRealSWRAuth,
  type ReaderOptions,
} from "~/lib/swr/hooks";
import { studentKeys as studentKey } from "~/lib/swr/portal-keys";
import { scopedSWRKey, tenantSWRScope } from "~/lib/swr/scope";
import { useSWRSeedFrom } from "~/lib/swr/seed";
import { releaseFakeTimers, testClockDay } from "~/test/clock";
import { deferred } from "~/test/helpers/form-modal-pending";
import StudentSearchPage from "./page-content";

const STORAGE_KEY = "student-search:last-filters:tenant-2:3";
const STALL_MESSAGE =
  "Die Kinder laden gerade sehr lange. Bitte lade die Liste noch einmal.";
const rosterKey = studentKey.search(
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

function renderOnSearchPage(search: string, wrapper?: typeof IsolatedSWRCache) {
  window.history.replaceState(null, "", `/students/search${search}`);
  currentSearch = new URLSearchParams(search);
  const navLink = document.createElement("a");
  navLink.href = "/students/search";
  navLink.textContent = "Alle Kinder (Navigation)";
  document.body.appendChild(navLink);
  const view = render(<StudentSearchPage />, { wrapper });
  return { ...view, navLink };
}

function renderWithRealStudentReads(search: string) {
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
        {children}
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
    ...renderOnSearchPage(search, CacheWithPreview),
    reload,
    preview: (id: string) => preview(id),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
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
  mockUseSWRAuth.mockImplementation((key: string | null) => {
    if (key?.startsWith("search-students-")) {
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
      expect(studentKeys).toContain(rosterKey);
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

      // Anker: the same selection control now has no children to act on.
      expect(screen.getByTestId("select-all-count")).toHaveTextContent("0");
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
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("0");

    mockGetStudents.mockRejectedValueOnce(new ApiError("Unavailable", 503));
    await act(async () => {
      await reload.get(rosterKey)!();
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

  it("ignores a named refusal from the request replaced by retry", async () => {
    const oldMila = deferred<{ students: (typeof mockStudent)[] }>();
    const roster = deferred<{ students: (typeof mockStudent)[] }>();
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    let milaReads = 0;
    mockGetStudents.mockImplementation(({ search }: StudentFilters) => {
      if (!search) return roster.promise;
      if (search === "Max") return Promise.resolve({ students: [mockStudent] });
      return ++milaReads === 1
        ? oldMila.promise
        : Promise.resolve({ students: [mila] });
    });
    vi.useFakeTimers();
    try {
      renderWithRealStudentReads("?search=Mila");
      act(() => vi.advanceTimersByTime(10_000));
      fireEvent.click(screen.getByRole("button", { name: "Erneut laden" }));
    } finally {
      releaseFakeTimers();
    }
    expect(await screen.findByTestId("student-card-8")).toBeVisible();

    const [search] = screen.getAllByPlaceholderText("Name suchen…");
    fireEvent.change(search!, { target: { value: "Max" } });
    expect(await screen.findByTestId("student-card-7")).toBeVisible();

    await act(async () => oldMila.reject(new ApiError("Old refusal", 403)));
    expect(screen.getByTestId("student-card-7")).toBeVisible();
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("1");
  });

  it("uses saved name results until a current roster is confirmed", async () => {
    const freshRoster = deferred<{ students: (typeof mockStudent)[] }>();
    const mila = { ...mockStudent, id: "8", first_name: "Mila" };
    const { rerender, reload } = renderWithRealStudentReads("");
    expect(await screen.findByTestId("student-card-7")).toBeVisible();

    mockGetStudents.mockImplementation(({ search }: StudentFilters) =>
      search ? Promise.resolve({ students: [mila] }) : freshRoster.promise,
    );
    currentSearch = new URLSearchParams({ search: "Mila" });
    window.history.replaceState(null, "", "/students/search?search=Mila");
    rerender(<StudentSearchPage key="saved-search" />);
    expect(await screen.findByTestId("student-card-8")).toBeVisible();

    await act(async () => {
      const pending = reload.get(rosterKey)!();
      freshRoster.resolve({ students: [mila, mockStudent] });
      await pending;
    });
    const recordedCalls = mockGetStudents.mock.calls.length;
    const [search] = screen.getAllByPlaceholderText("Name suchen…");
    fireEvent.change(search!, { target: { value: "Max" } });
    expect(await screen.findByTestId("student-card-7")).toBeVisible();
    expect(mockGetStudents).toHaveBeenCalledTimes(recordedCalls);
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
    const { reload } = renderWithRealStudentReads("");
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
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("1");

    await act(async () => expansion.resolve({ students: [mila] }));
    // Anker: the retained rows were replaced by the new roster.
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
    expect(screen.queryByTestId("student-card-7")).toBeNull();
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
      await reload.get(rosterKey)!();
    });
    expect(await screen.findByTestId("student-card-8")).toBeVisible();
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("1");
  });

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
      expect(screen.getByTestId("select-all-count")).toHaveTextContent(
        clearGroup ? "1" : "0",
      );
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
    mockGetStudents.mockResolvedValue({
      students: [mockStudent],
      pagination: { total_pages: 25, total_records: 25000 },
    });
    let readRoster: (() => Promise<unknown>) | undefined;
    const rosterReader = mockUseSWRAuth.getMockImplementation()!;
    mockUseSWRAuth.mockImplementation((key, fetcher, options) => {
      if (key === rosterKey) readRoster = fetcher;
      return rosterReader(key, fetcher, options);
    });
    const { rerender } = renderOnSearchPage("?search=Max");

    studentsResponse = {
      data: await readRoster!(),
      isLoading: false,
      error: undefined,
    };
    expect(mockGetStudents).toHaveBeenCalledTimes(1);
    rerender(<StudentSearchPage />);

    fireEvent.click(
      screen.getAllByRole("button", { name: "Suche löschen" })[0]!,
    );
    await waitFor(() => expect(mockMutateStudents).toHaveBeenCalledTimes(1));
    expect(await readRoster!()).toMatchObject({ truncatedTotal: 25000 });
    expect(mockGetStudents).toHaveBeenCalledTimes(21);
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
