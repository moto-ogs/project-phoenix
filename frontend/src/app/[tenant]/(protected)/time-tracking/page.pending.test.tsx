// #6593: Speichern, Abwesenheit speichern und löschen sperren das Panel
// „Eintrag bearbeiten“; eine späte Antwort schließt nichts mehr.
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deferred,
  expectSlideOverSaveLocked,
  expectSlideOverUnlocked,
} from "~/test/helpers/form-modal-pending";

vi.mock("~/lib/hooks/use-own-time-refresh", () => ({
  useOwnTimeRefresh: () => async () => undefined,
}));

vi.mock("vaul", () => import("~/test/mocks/vaul"));

const { service, mockMutate, mockToastSuccess } = vi.hoisted(() => ({
  service: {
    checkIn: vi.fn(),
    checkOut: vi.fn(),

    startBreak: vi.fn(),
    endBreak: vi.fn(),

    getSessionEdits: vi.fn(),
    updateSession: vi.fn(),
    getAbsences: vi.fn(),
    createAbsence: vi.fn(),
    updateAbsence: vi.fn(),
    deleteAbsence: vi.fn(),
    requestVacation: vi.fn(),
    cancelAbsence: vi.fn(),

    exportSessions: vi.fn(),
  },
  mockMutate: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "1", token: "test-token" } },
    status: "authenticated",
    update: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));
// The breaks of the open session read through real SWR, so their reload
// count is the page's; every other reader is the per-key fake. The real hook
// runs on every call (with a null key for the fakes) to keep the hook order.
const { routedSWRAuth } = vi.hoisted(() => ({
  routedSWRAuth: (real: typeof import("~/lib/swr").useSWRAuth) =>
    new Proxy(vi.fn(), {
      apply(fake, thisArg, args: Parameters<typeof real>) {
        const [key, fetcher, options] = args;
        const breaks = key?.startsWith("time-tracking-session-breaks-");
        const response = real(breaks ? key : null, fetcher, options);
        return breaks ? response : Reflect.apply(fake, thisArg, args);
      },
    }),
}));
vi.mock("~/lib/swr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/swr")>();
  return {
    useLiveRefreshInterval: (fallbackMs = 60_000) => fallbackMs,
    useSWRAuth: routedSWRAuth(actual.useSWRAuth),
    useTenantMutate: () => vi.fn(),
    useSWRCacheKey: () => (key: string) => `scope:${key}`,
    useInvalidateMatching: () => vi.fn(async () => []),
  };
});
vi.mock("~/lib/hooks/use-user-context", () => ({
  useHasOwnStaff: () => true,
  useUserContext: () => ({
    userContext: { currentStaff: { id: "10", personId: "1" } },
    isLoading: false,
    error: undefined,
    isIncomplete: false,
    unavailableSections: [],
    isReady: true,
  }),
}));
vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => ({
    success: mockToastSuccess,
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    remove: vi.fn(),
  }),
}));
vi.mock("~/lib/time-tracking-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/time-tracking-api")>()),
  timeTrackingService: service,
}));
vi.mock("~/lib/tenant-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/tenant-context")>()),
  useModuleBooked: () => true,
}));
vi.mock("~/components/staff/staff-export-button", () => ({
  StaffExportButton: () => null,
}));
// Wie page.test.tsx: die Tabelle reicht nur den Stift „Eintrag bearbeiten“
// an die Seite durch; das Panel selbst ist echt.
vi.mock("~/components/staff/staff-session-table", () => ({
  StaffSessionTable: ({
    sessions = [],
    absences = [],
    onEditDay,
  }: {
    sessions?: Array<{ id?: number; date: string }>;
    absences?: Array<{ date_start: string }>;
    onEditDay?: (
      date: Date,
      session: { id?: number } | null,
      absence: unknown,
    ) => void;
  }) => {
    const session = sessions[0];
    const absence = absences[0];
    const date = new Date(
      `${session?.date ?? absence?.date_start ?? "2026-09-09"}T12:00:00`,
    );
    return (
      <button
        type="button"
        onClick={() => onEditDay?.(date, session ?? null, absence ?? null)}
      >
        Eintrag bearbeiten
      </button>
    );
  },
}));
vi.mock("~/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ChartLegend: () => null,
  ChartLegendContent: () => null,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));
vi.mock("recharts", () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("~/components/help/context-help-link", () => ({
  ContextHelpLink: () => null,
}));

import { SWRConfig } from "~/lib/swr/testing";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { adaptHistorySessionForMetrics } from "~/lib/staff-metrics-helpers";
import { useSWRAuth } from "~/lib/swr";
import type {
  StaffAbsence,
  WorkSessionHistory,
} from "~/lib/time-tracking-helpers";
import TimeTrackingPage from "./page-content";

vi.unmock("swr");

/** A fresh SWR cache per render, so no breaks leak between tests. */
function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      <ToastProvider>{children}</ToastProvider>
    </SWRConfig>
  );
}

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: Providers });
}

// Die Testuhr steht auf Mittwoch, 09.09.2026.
const DAY = "2026-09-09";

const session: WorkSessionHistory = {
  version: "v100",
  id: "100",
  staffId: "10",
  date: DAY,
  status: "present",
  checkInTime: `${DAY}T08:00:00`,
  checkOutTime: `${DAY}T16:30:00`,
  breakMinutes: 30,
  notes: "",
  autoCheckedOut: false,
  createdBy: "10",
  updatedBy: null,
  createdAt: `${DAY}T08:00:00`,
  updatedAt: `${DAY}T08:00:00`,
  netMinutes: 480,
  isOvertime: false,
  isBreakCompliant: true,
  breaks: [],
  editCount: 0,
};

const absence: StaffAbsence = {
  id: "200",
  staffId: "10",
  absenceType: "sick",
  dateStart: DAY,
  dateEnd: DAY,
  halfDay: false,
  startHalfDay: false,
  endHalfDay: false,
  note: "",
  status: "pending",
  approvedBy: null,
  approvedAt: null,
  createdBy: "10",
  createdAt: `${DAY}T07:00:00`,
  updatedAt: `${DAY}T07:00:00`,
  durationDays: 1,
  workingDays: 1,
  decisionNote: "",
  requestedAt: `${DAY}T07:00:00`,
  substituteStaffId: null,
};

function mockData(absences: StaffAbsence[]) {
  vi.mocked(useSWRAuth).mockImplementation(((key: string | null) => {
    const answer = (data: unknown) => ({
      data,
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
      error: undefined,
    });
    if (key === null) return answer(undefined);
    if (key.startsWith("time-tracking-overview-")) {
      const totals = {
        has_target: true,
        has_override: false,
        actual_minutes: 0,
        credit_minutes: 0,
        target_minutes: 0,
      };
      return answer({
        asOf: "2026-09-09T10:00:00Z",
        staffId: "10",
        session: null,
        breaks: [],
        absence: null,
        chart: [],
        completedToday: 0,
        todayCountsInTotals: true,
        laborDays: [],
        plannedShifts: [],
        cancelledShifts: [],
        assignments: [],
        week: totals,
        month: totals,
        accountStart: null,
        accountBalanceMinutes: 0,
      });
    }
    if (key.startsWith("time-tracking-period-")) {
      return answer({
        staffId: "10",
        from: new Date(2026, 8, 7),
        to: new Date(2026, 8, 13),
        sessions: [session],
        rows: [adaptHistorySessionForMetrics(session)],
        absences,
        laborDays: [],
        weeklySummaries: [],
        dailyProjection: new Map(),
        accountStart: "",
        holidays: new Map(),
        closingDays: new Map(),
        shifts: [],
      });
    }
    if (key.startsWith("time-tracking-leave-overview-")) {
      return answer({
        year: 2026,
        quota: { entitled_days: 30, carryover_days: 0, remaining_days: 30 },
        counts: { question: 0, reserved: 0, approved: 0, declined: 0 },
        recent: [],
        questions: [],
        allowances: [],
        mails: { state: "ready" },
      });
    }
    return answer([]);
  }) as never);

  service.getSessionEdits.mockResolvedValue([]);
  service.getAbsences.mockResolvedValue(absences);
}

async function openPanel(title: string) {
  fireEvent.click(screen.getByRole("button", { name: "Eintrag bearbeiten" }));
  await screen.findByRole("heading", { name: title });
}

async function startSessionSave() {
  mockData([]);
  const answer = deferred<unknown>();
  service.updateSession.mockReturnValue(answer.promise);
  const view = render(<TimeTrackingPage />);
  await openPanel("Eintrag bearbeiten");
  fireEvent.click(screen.getByRole("button", { name: "Zeitkorrektur" }));
  const save = screen.getByRole("button", { name: "Speichern" });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await screen.findByRole("button", { name: "Speichern…" });
  return { ...view, answer };
}

describe("Zeiterfassung: Eintrag bearbeiten sperrt beim Speichern (#6593)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutate.mockResolvedValue(undefined);
  });

  it("locks the panel while saving the times and unlocks it with the error after a failure", async () => {
    const { answer } = await startSessionSave();

    expectSlideOverSaveLocked("Eintrag bearbeiten", [
      "Abbrechen",
      "Speichern…",
    ]);

    await act(async () => {
      answer.reject(new ApiError("down", 503, { code: "general.unavailable" }));
    });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expectSlideOverUnlocked("Eintrag bearbeiten");
    expect(screen.getByLabelText(/Grund der Änderung/)).toHaveValue(
      "Zeitkorrektur",
    );
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("closes the panel after the times are saved", async () => {
    const { answer } = await startSessionSave();

    await act(async () => {
      answer.resolve(session);
    });

    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Die Arbeitszeit ist gespeichert.",
    );
    // Anker: die Zeiterfassung ist wieder bedienbar.
    expect(
      screen.getByRole("button", { name: "Eintrag bearbeiten" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("heading", { name: "Eintrag bearbeiten" }),
    ).toBeNull();
  });

  it("locks the panel while the absence is deleted and refreshes after unmount", async () => {
    mockData([absence]);
    const answer = deferred<void>();
    service.deleteAbsence.mockReturnValue(answer.promise);
    const { unmount } = render(<TimeTrackingPage />);
    await openPanel("Tag bearbeiten");
    const panel = screen
      .getByRole("heading", { name: "Tag bearbeiten" })
      .closest<HTMLElement>('[role="dialog"]')!;
    fireEvent.click(within(panel).getByRole("button", { name: "Abwesenheit" }));
    const remove = await screen.findByRole("button", {
      name: "Abwesenheit löschen",
    });
    expect(remove).toBeEnabled();
    fireEvent.click(remove);

    expectSlideOverSaveLocked("Tag bearbeiten", ["Abbrechen", "Speichern"]);
    expect(
      screen.getByRole("button", { name: "Abwesenheit wird gelöscht…" }),
    ).toBeDisabled();

    unmount();
    await act(async () => {
      answer.resolve();
    });

    expect(service.deleteAbsence).toHaveBeenCalledWith("200");
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Die Abwesenheit ist gelöscht.",
    );
  });

  it("locks the panel while the absence is saved and unlocks it after a failure", async () => {
    mockData([absence]);
    const answer = deferred<void>();
    service.updateAbsence.mockReturnValue(answer.promise);
    render(<TimeTrackingPage />);
    await openPanel("Tag bearbeiten");
    const panel = screen
      .getByRole("heading", { name: "Tag bearbeiten" })
      .closest<HTMLElement>('[role="dialog"]')!;
    fireEvent.click(within(panel).getByRole("button", { name: "Abwesenheit" }));
    fireEvent.change(await screen.findByLabelText("Bemerkung (optional)"), {
      target: { value: "Arzttermin" },
    });
    const save = within(panel).getByRole("button", { name: "Speichern" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await screen.findByRole("button", { name: "Speichern…" });

    expectSlideOverSaveLocked("Tag bearbeiten", ["Abbrechen", "Speichern…"]);
    expect(
      screen.getByRole("button", { name: "Abwesenheit löschen" }),
    ).toBeDisabled();

    await act(async () => {
      answer.reject(new ApiError("down", 503, { code: "general.unavailable" }));
    });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expectSlideOverUnlocked("Tag bearbeiten");
    expect(screen.getByLabelText("Bemerkung (optional)")).toHaveValue(
      "Arzttermin",
    );
  });
});
