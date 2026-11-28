import { resetSWRScope } from "~/lib/swr/scope";
import { getStartDateForTimeRange } from "~/lib/date-helpers";
import { schoolDateCases, setSchoolDateClock } from "~/test/school-date-cases";
import { afterEach as restoreZoneAfterEach, vi as zoneVi } from "vitest";
restoreZoneAfterEach(() => zoneVi.unstubAllEnvs());
import {
  render as rtlRender,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useInvalidateFamily } from "~/lib/swr";
import { studentKeys } from "~/lib/swr/portal-keys";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";
import { SWRConfig } from "~/lib/swr/testing";
import StudentFeedbackHistoryPage from "./page-content";
import { ApiError } from "~/lib/api-error";
import { fetchStudent } from "~/lib/student-api";
import { fetchStudentFeedback } from "~/lib/feedback-api";
import { catalogText } from "~/test/error-catalog-text";
import { setTestClock } from "~/test/clock";

vi.unmock("swr");

// Real SWR with a fresh cache per render.
function SWRTestCache({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      {children}
    </SWRConfig>
  );
}

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: SWRTestCache });
}

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useParams: () => ({
    id: "1",
  }),
  useSearchParams: () => ({
    get: vi.fn((key: string) => (key === "from" ? "/students/search" : null)),
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: {
      user: {
        id: "1",
        token: "test-token",
      },
    },
  })),
}));

vi.mock("~/lib/breadcrumb-context", () => ({
  useStudentHistoryBreadcrumb: vi.fn(),
  useSetBreadcrumb: vi.fn(),
  useBreadcrumb: vi.fn(() => ({ breadcrumb: {}, setBreadcrumb: vi.fn() })),
  BreadcrumbProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Der Rückweg der Kopfkarte (TenantPage) als Link mit seinem Ziel.
vi.mock("~/components/ui/back-link", () => ({
  BackLink: ({ href, label }: { href: string; label: string }) => (
    <a data-testid="back-button" href={href} data-referrer={href}>
      {label}
    </a>
  ),
}));

vi.mock("~/components/ui/loading", () => ({
  Loading: ({ fullPage }: { fullPage?: boolean }) => (
    <div data-testid="loading" data-fullpage={fullPage} aria-label="Lädt..." />
  ),
}));

vi.mock("~/components/ui/alert", () => ({
  Alert: ({ type, message }: { type: string; message: string }) => (
    <div data-testid={`alert-${type}`}>{message}</div>
  ),
}));

vi.mock("~/lib/date-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/date-helpers")>();
  return {
    ...actual,
    getStartDateForTimeRange: vi.fn((_timeRange: string, _now: Date) => {
      return new Date("2020-01-01");
    }),
  };
});

vi.mock("~/lib/student-api", () => ({
  fetchStudent: vi.fn().mockResolvedValue({
    id: "1",
    name: "Emma Müller",
    first_name: "Emma",
    second_name: "Müller",
    school_class: "3b",
    group_name: "Eulen",
    group_id: "g3",
    current_location: "Anwesend",
  }),
}));

// The child's detail also reads the account's own groups; none here.
vi.mock("~/lib/usercontext-api", () => ({
  userContextService: {},
}));

vi.mock("~/lib/feedback-api", () => ({
  fetchStudentFeedback: vi.fn().mockResolvedValue([
    {
      id: "1",
      day: "2025-05-14",
      time: "15:30:23",
      feedbackType: "positive",
      isMensaFeedback: false,
    },
    {
      id: "2",
      day: "2025-05-13",
      time: "15:45:12",
      feedbackType: "negative",
      isMensaFeedback: false,
    },
    {
      id: "3",
      day: "2025-05-12",
      time: "15:25:18",
      feedbackType: "positive",
      isMensaFeedback: false,
    },
    {
      id: "4",
      day: "2025-05-11",
      time: "15:10:09",
      feedbackType: "neutral",
      isMensaFeedback: false,
    },
    {
      id: "5",
      day: "2025-05-10",
      time: "12:30:22",
      feedbackType: "negative",
      isMensaFeedback: false,
    },
  ]),
}));

// Mock recharts to avoid ResizeObserver issues in tests
vi.mock("recharts", () => ({
  Bar: () => null,
  BarChart: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("~/components/ui/chart", () => ({
  ChartContainer: ({
    children,
  }: {
    children: React.ReactNode;
    config: unknown;
    className: string;
  }) => <div data-testid="chart-container">{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
  ChartLegend: () => null,
  ChartLegendContent: () => null,
}));

describe("StudentFeedbackHistoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state initially", () => {
    render(<StudentFeedbackHistoryPage />);

    // Der Ladezustand kommt aus dem Seitengerüst (aria-busy), nicht mehr aus
    // einem eigenen Seiten-Skelett.
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it("renders student name as page heading", async () => {
    render(<StudentFeedbackHistoryPage />);

    await waitFor(
      () => {
        expect(
          screen.getByRole("heading", { level: 1, name: "Emma Müller" }),
        ).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("displays feedback history subtitle", async () => {
    render(<StudentFeedbackHistoryPage />);

    await waitFor(
      () => {
        expect(screen.getByText("Feedbackhistorie")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("displays time range filter buttons", async () => {
    render(<StudentFeedbackHistoryPage />);

    await waitFor(
      () => {
        expect(screen.getByText("Alle")).toBeInTheDocument();
        expect(screen.getByText("Heute")).toBeInTheDocument();
        expect(screen.getByText("Diese Woche")).toBeInTheDocument();
        expect(screen.getByText("Letzte 7 Tage")).toBeInTheDocument();
        expect(screen.getByText("Diesen Monat")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("displays feedback overview heading", async () => {
    render(<StudentFeedbackHistoryPage />);

    await waitFor(
      () => {
        expect(screen.getByText("Feedback-Übersicht")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("displays feedback type stats inline", async () => {
    render(<StudentFeedbackHistoryPage />);

    await waitFor(
      () => {
        expect(screen.getByText("Positiv")).toBeInTheDocument();
        expect(screen.getByText("Neutral")).toBeInTheDocument();
        expect(screen.getByText("Negativ")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("displays back button", async () => {
    render(<StudentFeedbackHistoryPage />);

    await waitFor(
      () => {
        expect(screen.getByTestId("back-button")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("back button links to student profile", async () => {
    render(<StudentFeedbackHistoryPage />);

    await waitFor(
      () => {
        const backButton = screen.getByTestId("back-button");
        // tab=historie returns to the Historie tab on the detail page (#1501);
        // from= still drives the detail page's own back button to the list.
        expect(backButton).toHaveAttribute(
          "data-referrer",
          "/test-tenant/students/1?from=%2Fstudents%2Fsearch&tab=historie",
        );
      },
      { timeout: 2000 },
    );
  });

  it("displays student class and group info", async () => {
    render(<StudentFeedbackHistoryPage />);

    await waitFor(
      () => {
        expect(screen.getByText(/3b/)).toBeInTheDocument();
        expect(screen.getByText(/Gruppe: Eulen/)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("changes time range when filter button clicked", async () => {
    render(<StudentFeedbackHistoryPage />);

    await waitFor(
      () => {
        expect(screen.getByText("Alle")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    fireEvent.click(screen.getByText("Alle"));

    await waitFor(
      () => {
        expect(screen.getByText("Alle")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("hides detail list by default and shows toggle button", async () => {
    render(<StudentFeedbackHistoryPage />);

    await waitFor(
      () => {
        expect(screen.getByText(/Alle Einträge anzeigen/)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("shows detail entries when toggle is clicked", async () => {
    render(<StudentFeedbackHistoryPage />);

    await waitFor(
      () => {
        expect(screen.getByText(/Alle Einträge anzeigen/)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    fireEvent.click(screen.getByText(/Alle Einträge anzeigen/));

    await waitFor(
      () => {
        expect(
          screen.getAllByTestId(/feedback-indicator/).length,
        ).toBeGreaterThan(0);
        expect(
          screen.getAllByText(/Positives Feedback/i).length,
        ).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );
  });

  it("shows a failed load in place with the catalog text", async () => {
    vi.mocked(fetchStudentFeedback).mockRejectedValueOnce(
      new ApiError("boom", 503, { code: "general.unavailable" }),
    );

    render(<StudentFeedbackHistoryPage />);

    expect(await screen.findByTestId("alert-error")).toHaveTextContent(
      "Die Feedbackhistorie ist gerade nicht erreichbar. Bitte versuche es erneut.",
    );
    // #2517: keine Zählung aus einer Historie, die nie geladen wurde.
    expect(screen.getByTestId("alert-error")).toHaveTextContent(
      catalogText("general.unavailable", "die Feedbackhistorie"),
    );
    // Die Statuszeile setzt Zahl und Wort in eigene Elemente (#7402).
    expect(screen.queryByText(/^(\d+ )?Einträge?$/)).not.toBeInTheDocument();
  });

  it("shows the switched-off state from the child's record", async () => {
    vi.mocked(fetchStudent).mockResolvedValueOnce({
      id: "1",
      name: "Emma Müller",
      first_name: "Emma",
      second_name: "Müller",
      school_class: "3b",
      feedback_enabled: false,
    } as unknown as Awaited<ReturnType<typeof fetchStudent>>);
    vi.mocked(fetchStudentFeedback).mockRejectedValueOnce(
      new ApiError("feature_disabled", 403),
    );

    render(<StudentFeedbackHistoryPage />);

    expect(
      await screen.findByText(
        /Die Feedbackhistorie ist für deine Schule ausgeschaltet/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("alert-error")).not.toBeInTheDocument();
  });

  it.each(schoolDateCases("2026-04-01"))(
    "filters feedback by Berlin days and midnight across DST in %s",
    async (zone, instant) => {
      setSchoolDateClock(zone, instant, "2026-04-01");
      const actual =
        await vi.importActual<typeof import("~/lib/date-helpers")>(
          "~/lib/date-helpers",
        );
      const rangeHelper = vi.mocked(getStartDateForTimeRange);
      const previous = rangeHelper.getMockImplementation()!;
      rangeHelper.mockImplementation(actual.getStartDateForTimeRange);
      try {
        expect(actual.getStartDateForTimeRange("today").toISOString()).toBe(
          "2026-03-31T22:00:00.000Z",
        );
        expect(actual.getStartDateForTimeRange("week").toISOString()).toBe(
          "2026-03-29T22:00:00.000Z",
        );
        expect(actual.getStartDateForTimeRange("month").toISOString()).toBe(
          "2026-03-31T22:00:00.000Z",
        );
        expect(actual.getStartDateForTimeRange("7days").toISOString()).toBe(
          "2026-03-25T23:00:00.000Z",
        );
        vi.mocked(fetchStudentFeedback).mockResolvedValueOnce([
          {
            id: "1",
            day: "2026-04-01",
            time: "00:30:00",
            feedbackType: "positive",
            isMensaFeedback: false,
          },
          {
            id: "2",
            day: "2026-03-31",
            time: "23:30:00",
            feedbackType: "negative",
            isMensaFeedback: false,
          },
          {
            id: "3",
            day: "2026-03-30",
            time: "12:00:00",
            feedbackType: "neutral",
            isMensaFeedback: false,
          },
          {
            id: "4",
            day: "2026-03-29",
            time: "23:30:00",
            feedbackType: "neutral",
            isMensaFeedback: false,
          },
        ]);
        render(<StudentFeedbackHistoryPage />);
        expect(
          (await screen.findByText("Einträge")).parentElement,
        ).toHaveTextContent(/^4 Einträge$/);
        for (const [label, count] of [
          ["Heute", 1],
          ["Diese Woche", 3],
          ["Diesen Monat", 1],
        ] as const) {
          fireEvent.click(screen.getByText(label));
          await waitFor(() =>
            expect(
              screen.getByText(count === 1 ? "Eintrag" : "Einträge")
                .parentElement,
            ).toHaveTextContent(count === 1 ? /^1 Eintrag$/ : /^3 Einträge$/),
          );
        }
      } finally {
        rangeHelper.mockImplementation(previous);
      }
    },
  );
});

// #8270: the API sends the Berlin school day and wall-clock time apart. The
// filter, the day groups and the time must all show that school time,
// whatever zone the browser runs in.
describe.each(["Europe/Berlin", "UTC", "America/New_York"])(
  "school day and time in a browser in %s (#8270)",
  (zone) => {
    const apiEntries = [
      { id: "1", day: "2026-11-25", time: "08:05:00", value: "neutral" },
      { id: "2", day: "2026-11-26", time: "15:30:23", value: "negative" },
      { id: "3", day: "2026-11-26", time: "23:30:23", value: "positive" },
    ].map((entry) => ({
      ...entry,
      student_id: "1",
      is_mensa_feedback: entry.id === "1",
      created_at: "2026-11-26T22:30:23Z",
      updated_at: "2026-11-26T22:30:23Z",
    }));

    it("groups by school day and shows the school clock", async () => {
      vi.clearAllMocks();
      vi.stubEnv("TZ", zone);
      // Friday 27.11., 12:00 in Berlin.
      setTestClock("2026-11-27T11:00:00Z");
      // The zone change took effect, or the cases below prove nothing. The
      // old code read the offset-less "23:30" in this zone and then formatted
      // it for Berlin: 00:30 on the 27th in UTC, 05:30 in New York.
      const late = new Date("2026-11-26T22:30:23Z");
      expect(late.getHours()).toBe(
        { "Europe/Berlin": 23, UTC: 22, "America/New_York": 17 }[zone],
      );
      const actual =
        await vi.importActual<typeof import("~/lib/date-helpers")>(
          "~/lib/date-helpers",
        );
      const { mapFeedbackResponse } =
        await vi.importActual<typeof import("~/lib/feedback-api")>(
          "~/lib/feedback-api",
        );
      const rangeHelper = vi.mocked(getStartDateForTimeRange);
      const previous = rangeHelper.getMockImplementation()!;
      rangeHelper.mockImplementation(actual.getStartDateForTimeRange);
      try {
        vi.mocked(fetchStudentFeedback).mockResolvedValueOnce(
          apiEntries.map(mapFeedbackResponse),
        );
        render(<StudentFeedbackHistoryPage />);
        fireEvent.click(await screen.findByText(/Alle Einträge anzeigen/));

        // Day groups by calendar day, the latest first; no 27.11.
        expect(
          screen
            .getAllByRole("heading", { level: 3 })
            .map((h) => h.textContent),
        ).toEqual([
          "Donnerstag, 26. November 2026",
          "Mittwoch, 25. November 2026",
        ]);
        const thursday = screen
          .getByRole("heading", { name: "Donnerstag, 26. November 2026" })
          .closest("section")!;
        expect(
          within(thursday)
            .getAllByTestId(/^feedback-indicator-/)
            .map((row) => row.textContent),
        ).toEqual([
          expect.stringContaining("23:30"),
          expect.stringContaining("15:30"),
        ]);
        expect(thursday).not.toHaveTextContent("00:30");

        // The filter agrees: today (27.11.) has no feedback.
        fireEvent.click(screen.getByText("Heute"));
        expect(
          await screen.findByText(
            /Kein Feedback für den ausgewählten Zeitraum/,
          ),
        ).toBeInTheDocument();
      } finally {
        rangeHelper.mockImplementation(previous);
      }
    });
  },
);

function ReloadFeedback() {
  const invalidate = useInvalidateFamily();
  return (
    <button
      onClick={() => {
        void invalidate(studentKeys.detail("1"));
        void invalidate(tenantStudentKeys.feedback("1"));
      }}
    >
      Reload feedback
    </button>
  );
}

it.each([false, true])(
  "hides cached feedback when the confirmed feature flag turns off (refused read: %s)",
  async (refused) => {
    vi.clearAllMocks();
    resetSWRScope({ revalidate: false });
    const studentRead = vi.mocked(fetchStudent).getMockImplementation()!;
    const feedbackRead = vi
      .mocked(fetchStudentFeedback)
      .getMockImplementation()!;
    try {
      render(
        <>
          <ReloadFeedback />
          <StudentFeedbackHistoryPage />
        </>,
      );
      expect(await screen.findByText("Feedback-Übersicht")).toBeVisible();
      const original = await vi.mocked(fetchStudent).mock.results[0]!.value;
      vi.mocked(fetchStudent).mockResolvedValue({
        ...original,
        feedback_enabled: false,
      });
      if (refused)
        vi.mocked(fetchStudentFeedback).mockRejectedValue(
          new ApiError("disabled", 403),
        );
      fireEvent.click(screen.getByRole("button", { name: "Reload feedback" }));
      expect(
        await screen.findByText(
          /Die Feedbackhistorie ist für deine Schule ausgeschaltet/,
        ),
      ).toBeVisible();
      expect(screen.queryByText("Feedback-Übersicht")).not.toBeInTheDocument();
      expect(screen.queryByText(/^(\d+ )?Einträge?$/)).not.toBeInTheDocument();
      const readsBeforeFailure =
        vi.mocked(fetchStudentFeedback).mock.calls.length;
      vi.mocked(fetchStudentFeedback).mockRejectedValue(
        new ApiError("offline", 503),
      );
      fireEvent.click(screen.getByRole("button", { name: "Reload feedback" }));
      await waitFor(() =>
        expect(fetchStudentFeedback).toHaveBeenCalledTimes(
          readsBeforeFailure + 1,
        ),
      );
      expect(
        screen.getByText(
          /Die Feedbackhistorie ist für deine Schule ausgeschaltet/,
        ),
      ).toBeVisible();
      expect(screen.queryByText("Feedback-Übersicht")).not.toBeInTheDocument();
      expect(screen.queryByText(/^(\d+ )?Einträge?$/)).not.toBeInTheDocument();
    } finally {
      vi.mocked(fetchStudent).mockImplementation(studentRead);
      vi.mocked(fetchStudentFeedback).mockImplementation(feedbackRead);
    }
  },
);
