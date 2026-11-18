import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setTestClock } from "~/test/clock";

import { ApiError } from "~/lib/api-error";
import {
  useTimetableEnabled,
  useWeekendFollowsFriday,
} from "~/lib/tenant-context";
import type { EnrichedInstance } from "~/lib/timetable-types";
import { catalogText } from "~/test/error-catalog-text";

const {
  mockSearch,
  mockUseSession,
  mockToastSuccess,
  mockToastError,
  mockToastWarning,
  mockTenantMutate,
  mockUseSWRAuth,
  mockApplyDeviations,
  mockApplyScheduleSubstitution,
  mockDayListProps,
  mockGridProps,
  mockEditorProps,
  mockApplyRejected,
  mockStacked,
} = vi.hoisted(() => ({
  mockSearch: { value: "" },
  mockUseSession: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockToastWarning: vi.fn(),
  mockTenantMutate: vi.fn(),
  mockUseSWRAuth: vi.fn(),
  mockApplyDeviations: vi.fn(),
  mockApplyScheduleSubstitution: vi.fn(),
  mockDayListProps: vi.fn(),
  mockGridProps: vi.fn(),
  mockEditorProps: vi.fn(),
  mockApplyRejected: vi.fn(),
  mockStacked: { value: false },
}));

// Nur die Frage „stehen Liste und Raster untereinander?“ wird gesteuert; alle
// anderen Abfragen bleiben beim Rechner-Layout.
vi.mock("~/lib/hooks/use-media-query", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("~/lib/hooks/use-media-query")>();
  return {
    ...original,
    useMediaQuery: (query: string) =>
      query === original.BELOW_LG ? mockStacked.value : false,
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch.value),
}));

vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

// Nur die Toasts ersetzen; der Anzeigeweg für Ladefehler bleibt echt.
vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    warning: mockToastWarning,
  }),
}));

vi.mock("~/lib/swr", () => ({
  useSWRAuth: mockUseSWRAuth,
  useTenantMutate: () => mockTenantMutate,
  // Vom eingebetteten BulkSubstitutionModal gebraucht (Vorschau-Cache-Reset);
  // dessen Verhalten testet bulk-substitution-modal.test.tsx.
  useTenantMutateMatching: () => () => Promise.resolve(),
}));

vi.mock("~/lib/hooks/use-timetable-day-hours", () => ({
  useTimetableDayHours: () => ({ dayStartHour: 9, dayEndHour: 17 }),
}));

vi.mock("~/lib/tenant-context", () => ({
  useWeekendFollowsFriday: vi.fn(() => false),
  useTimetableEnabled: vi.fn(() => true),
}));

vi.mock("~/lib/timetable-api", () => ({
  timetableService: {
    getWeek: vi.fn(),
    getGaps: vi.fn(),
    applyDeviations: mockApplyDeviations,
  },
}));

vi.mock("~/lib/substitution-api", () => ({
  substitutionService: {
    fetchScheduleOverview: vi.fn(),
    applyScheduleSubstitution: mockApplyScheduleSubstitution,
    applyBulkSubstitution: vi.fn(),
  },
}));

// Nur den Netzwerk-Fetcher mocken; die übrigen Schema-Helfer bleiben die echten
// Implementierungen, damit die Tests nicht gegen eine driftende Kopie laufen.
vi.mock("~/lib/settings-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/settings-api")>()),
  fetchSettingsSchema: vi.fn(),
}));

vi.mock("~/lib/shift-api", () => ({
  staffShiftService: {
    getOverview: vi.fn(),
  },
}));

vi.mock("~/lib/tenant-path", () => ({
  useTenantAwarePath: () => (path: string) => `/acme${path}`,
}));

// Nur die Tagesliste selbst ersetzen. Die übrigen Exporte (Klassifikation und
// Zeilendarstellung) bleiben echt, weil die Wochenliste sie importiert — ein
// Voll-Mock des Moduls würde sie beim Rendern der Wochenansicht verschlucken.
vi.mock(
  "~/components/timetable/vertretung-day-list",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("~/components/timetable/vertretung-day-list")
    >()),
    VertretungDayList: (props: {
      instances: Array<{ id: string }>;
      gapsAvailable: boolean;
      mode: string;
      canManage: boolean;
      onEdit: (id: string) => void;
    }) => {
      mockDayListProps(props);
      return (
        <div data-testid="day-list" data-mode={props.mode}>
          <button type="button" onClick={() => props.onEdit("42")}>
            day-list-edit
          </button>
        </div>
      );
    },
  }),
);

vi.mock("~/components/timetable/weekly-calendar-grid", () => ({
  WeeklyCalendarGrid: (props: {
    instances: Array<{ id: string }>;
    selectedId: string | null;
    onInstanceClick: (instance: { id: string }) => void;
  }) => {
    mockGridProps(props);
    return (
      <div data-testid="calendar-grid">
        <button
          type="button"
          onClick={() => props.onInstanceClick({ id: "42" })}
        >
          grid-click
        </button>
      </div>
    );
  },
}));

vi.mock("~/components/timetable/substitution-slide-over", () => ({
  SubstitutionSlideOver: (props: {
    instance: { id: string } | null;
    initialTab: string;
    staffLoadError?: boolean;
    canManage: boolean;
    dayInstances: Array<{ id: string }>;
    onClose: () => void;
    onApply: (input: unknown) => Promise<void>;
    onTabChange: (tab: "bearbeiten" | "verlauf") => void;
  }) => {
    mockEditorProps(props);
    if (!props.instance) return null;
    return (
      <div data-testid="editor" data-initial-tab={props.initialTab}>
        <span>editor-instance-{props.instance.id}</span>
        <button type="button" onClick={() => props.onClose()}>
          editor-close
        </button>
        <button type="button" onClick={() => props.onTabChange("verlauf")}>
          editor-history
        </button>
        <button
          type="button"
          // Wie der echte Editor: er schließt sich nach einer bestätigten
          // Absage selbst (#6593); die View schließt nicht mehr mit.
          onClick={() =>
            void props
              .onApply({ cancel: true })
              .then(() => props.onClose())
              .catch(mockApplyRejected)
          }
        >
          editor-cancel-save
        </button>
        <button
          type="button"
          onClick={() =>
            void props
              .onApply({
                substitutions: [
                  {
                    absentStaffId: "11",
                    substituteStaffId: "12",
                    instanceIds: ["42", "43"],
                  },
                ],
              })
              // Der echte Editor zeigt die Ablehnung im Formular.
              .catch(mockApplyRejected)
          }
        >
          editor-save
        </button>
      </div>
    );
  },
}));

import { VertretungView } from "./vertretung-view";

function makeInstance(overrides: Partial<EnrichedInstance>): EnrichedInstance {
  return {
    id: "42",
    date: "2026-07-15",
    startTime: "12:00",
    endTime: "13:00",
    title: "Mensa",
    status: "planned",
    isSpontaneous: false,
    isLive: false,
    activityType: "care",
    roomId: "3",
    roomName: "Mensa",
    staff: [],
    studentIds: [],
    students: [],
    staffCount: 0,
    absentStaffCount: 0,
    expectedStudentsCount: 0,
    notScheduledStudentsCount: 0,
    presentStudentsCount: 0,
    requiredStaffCount: 0,
    assignedStaffCount: 0,
    conflictWarnings: [],
    ...overrides,
  };
}

const WEEK_INSTANCES: EnrichedInstance[] = [
  makeInstance({ id: "42", date: "2026-07-15", title: "Mensa" }),
  makeInstance({ id: "43", date: "2026-07-16", title: "Fussball" }),
];

interface SwrState {
  weekData?: { from: string; to: string; instances: EnrichedInstance[] };
  weekError?: Error;
  weekLoading?: boolean;
  gapsData?: {
    from: string;
    to: string;
    gaps: unknown[];
    acknowledged: unknown[];
  };
  gapsError?: Error;
  gapsLoading?: boolean;
  /** Wochenwechsel: SWR reicht die Lücken der vorigen Woche weiter. */
  gapsLoadingWithPreviousData?: boolean;
  staffData?: Array<{ id: string; name: string }>;
  staffError?: Error;
  /** Dienstplan-Übersicht für den Abdeckungshinweis; ohne sie kein Hinweis. */
  coverageData?: {
    dienstplanInUse: boolean;
    assignments: Array<Record<string, unknown>>;
  };
  coverageError?: Error;
}

function setupSWR(state: SwrState = {}) {
  const {
    weekData = {
      from: "2026-07-13",
      to: "2026-07-19",
      instances: WEEK_INSTANCES,
    },
    weekError,
    weekLoading = false,
    gapsData = {
      from: "2026-07-15",
      to: "2026-07-19",
      gaps: [],
      acknowledged: [],
    },
    gapsError,
    gapsLoading = false,
    gapsLoadingWithPreviousData = false,
    staffData = [{ id: "11", name: "Ada Staff" }],
    staffError,
    coverageData,
    coverageError,
  } = state;

  mockUseSWRAuth.mockImplementation((key: string | null) => {
    if (key === null) return {};
    if (key.startsWith("vertretung-staff-list-")) {
      return {
        data: { appointments: [], staff: staffData },
        error: staffError,
      };
    }
    if (key.startsWith("vertretung-gaps")) {
      if (gapsLoading) return { isLoading: true };
      if (gapsLoadingWithPreviousData) {
        return { data: gapsData, isLoading: true };
      }
      return { data: gapsData, error: gapsError, isLoading: gapsLoading };
    }
    if (key.startsWith("vertretung-week")) {
      return {
        data: weekError ? undefined : weekData,
        error: weekError,
        isLoading: weekLoading,
      };
    }
    if (key.startsWith("dienstplan-overview")) {
      return { data: coverageData, error: coverageError };
    }
    return {};
  });
}

function urlKeys(): string[] {
  return [...new URLSearchParams(window.location.search).keys()];
}

describe("VertretungView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWeekendFollowsFriday).mockReturnValue(false);
    // Mittwoch 2026-07-15, Berlin (Sommerzeit UTC+2). Woche Mo 13. – So 19.07.
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    mockSearch.value = "";
    mockUseSession.mockReturnValue({
      status: "authenticated",
      data: { user: { permissions: ["schedules:manage"] } },
    });
    mockTenantMutate.mockResolvedValue(undefined);
    mockApplyDeviations.mockResolvedValue({
      instanceId: "42",
      cancelled: true,
      understaffedAck: false,
      affectedInstances: [],
      warnings: [],
    });
    mockApplyScheduleSubstitution.mockResolvedValue({
      instanceId: "42",
      cancelled: false,
      understaffedAck: false,
      affectedInstances: [],
      warnings: [],
    });
    setupSWR();
    window.history.replaceState(null, "", "/acme/vertretung");
  });

  it("defaults to today's Berlin date when d is absent", () => {
    render(<VertretungView />);

    const props = mockDayListProps.mock.calls.at(-1)?.[0];
    expect(props.instances.map((i: EnrichedInstance) => i.id)).toEqual(["42"]);
    expect(props.instances[0].date).toBe("2026-07-15");
    // Der "Heute"-Button bleibt sichtbar und ist deaktiviert, solange d der
    // heutige Tag ist (#2031: feste Geometrie der Navigationsgruppe).
    expect(screen.getByRole("button", { name: "Heute" })).toBeDisabled();
  });

  it("renders exactly the five Mo–Fr chips, never Sa/So", () => {
    render(<VertretungView />);

    for (const label of [
      "Mo 13.07.",
      "Di 14.07.",
      "Mi 15.07.",
      "Do 16.07.",
      "Fr 17.07.",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: "Sa 18.07." }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "So 19.07." }),
    ).not.toBeInTheDocument();
  });

  it("klappt das Raster ein, wenn es unter der Liste steht, und zeigt es auf Wunsch", () => {
    mockStacked.value = true;
    try {
      render(<VertretungView />);

      // Die Liste zeigt jeden Termin; das Raster wartet hinter seiner Zeile.
      expect(screen.getByTestId("day-list")).toBeInTheDocument();
      expect(screen.queryByText("grid-click")).not.toBeInTheDocument();
      const toggle = screen.getByRole("button", {
        name: "Tag als Zeitplan ausklappen",
      });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(toggle);
      expect(screen.getByText("grid-click")).toBeInTheDocument();
    } finally {
      mockStacked.value = false;
    }
  });

  it("snaps a weekend deep link to the following Monday", () => {
    mockSearch.value = "d=2026-07-18"; // Samstag
    render(<VertretungView />);

    // Angezeigt wird Montag der Folgewoche, dessen Chip ist selektiert.
    expect(screen.getByRole("button", { name: "Mo 20.07." })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Der Montag der Folgewoche hat keine Termine: das ist der Leerzustand
    // des Gerüsts, nicht eine leere Liste neben einem leeren Raster (#7493).
    expect(screen.getByText("Keine Termine an diesem Tag")).toBeInTheDocument();
    expect(screen.queryByTestId("day-list")).not.toBeInTheDocument();
    expect(screen.queryByText("grid-click")).not.toBeInTheDocument();
  });

  it("führt aus dem Leerzustand in den Betreuungsplan, aber nur mit Planungsrecht", () => {
    mockSearch.value = "d=2026-07-17"; // Freitag ohne Termine
    const { unmount } = render(<VertretungView />);

    expect(
      screen.getByRole("link", { name: "Betreuungsplan öffnen" }),
    ).toHaveAttribute("href", "/acme/betreuungsplan?d=2026-07-17");
    // Null Termine sagt der Leerzustand, die Statuszeile wiederholt es nicht.
    expect(screen.queryByText("Termine")).not.toBeInTheDocument();
    unmount();

    mockUseSession.mockReturnValue({
      data: { user: { permissions: ["schedules:read"] } },
      status: "authenticated",
    });
    render(<VertretungView />);
    // Ohne Aktion steht der Leerzustand als ein Satz.
    expect(
      screen.getByText(
        "Keine Termine an diesem Tag. Für diesen Zeitraum ist nichts geplant.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Betreuungsplan öffnen" }),
    ).not.toBeInTheDocument();
  });

  it("snaps a weekend day of another week to Monday on a weekday although the weekend follows Friday", () => {
    vi.mocked(useWeekendFollowsFriday).mockReturnValue(true);
    mockSearch.value = "d=2026-07-18";
    setupSWR();

    render(<VertretungView />);

    expect(screen.getByRole("button", { name: "Mo 20.07." })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Anker: die Wochenleiste ist gerendert und endet am Freitag.
    expect(
      screen.getByRole("button", { name: "Fr 24.07." }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sa 25.07." }),
    ).not.toBeInTheDocument();
  });

  it("keeps today's weekend days and their substitutions when the weekend follows Friday", () => {
    vi.mocked(useWeekendFollowsFriday).mockReturnValue(true);
    setTestClock("2026-07-18T12:00:00+02:00"); // Samstag
    mockSearch.value = "d=2026-07-18";
    setupSWR({
      weekData: {
        from: "2026-07-13",
        to: "2026-07-19",
        instances: [
          ...WEEK_INSTANCES,
          makeInstance({ id: "44", date: "2026-07-18", title: "Samstag" }),
        ],
      },
    });

    render(<VertretungView />);

    expect(screen.getByRole("button", { name: "Sa 18.07." })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "So 19.07." }),
    ).toBeInTheDocument();
    const props = mockDayListProps.mock.calls.at(-1)?.[0];
    expect(props.instances.map((i: EnrichedInstance) => i.id)).toEqual(["44"]);
  });

  it("adds the weekend to an open week after Berlin midnight", () => {
    vi.mocked(useWeekendFollowsFriday).mockReturnValue(true);
    setTestClock("2026-07-17T23:59:00+02:00"); // Friday
    vi.useFakeTimers();
    mockSearch.value = "view=woche&d=2026-07-17";
    render(<VertretungView />);

    expect(
      screen.getByRole("button", {
        name: "Fr 17.07. als Tagesansicht öffnen",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Sa 18.07. als Tagesansicht öffnen",
      }),
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(
      screen.getByRole("button", {
        name: "Sa 18.07. als Tagesansicht öffnen",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "So 19.07. als Tagesansicht öffnen",
      }),
    ).toBeInTheDocument();
  });

  it("defaults to next Monday on a weekend and disables the Heute button", () => {
    // Samstag 2026-07-18, Berlin (Sommerzeit UTC+2).
    vi.setSystemTime(new Date("2026-07-18T12:00:00Z"));
    render(<VertretungView />);

    expect(screen.getByRole("button", { name: "Mo 20.07." })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // dayISO == Heute-Ziel (nächster Montag) -> Heute ist wirkungslos und
    // deshalb deaktiviert, verschwindet aber nicht (#2031).
    expect(screen.getByRole("button", { name: "Heute" })).toBeDisabled();
  });

  it("navigates to next Monday when Heute is clicked on a weekend", () => {
    vi.setSystemTime(new Date("2026-07-18T12:00:00Z")); // Samstag
    mockSearch.value = "d=2026-07-15";
    render(<VertretungView />);

    fireEvent.click(screen.getByRole("button", { name: "Heute" }));
    expect(new URLSearchParams(window.location.search).get("d")).toBe(
      "2026-07-20",
    );
  });

  it("respects d, opens the editor for block, and starts on the Verlauf tab for verlauf=1", () => {
    mockSearch.value = "d=2026-07-16&block=43&verlauf=1";
    render(<VertretungView />);

    const dayList = mockDayListProps.mock.calls.at(-1)?.[0];
    expect(dayList.instances.map((i: EnrichedInstance) => i.id)).toEqual([
      "43",
    ]);

    const editor = mockEditorProps.mock.calls.at(-1)?.[0];
    expect(editor.instance?.id).toBe("43");
    expect(editor.initialTab).toBe("verlauf");
    expect(screen.getByTestId("editor")).toHaveAttribute(
      "data-initial-tab",
      "verlauf",
    );
  });

  it("falls back to today when d is not a real calendar date", () => {
    // "foo" ergäbe ohne Guard NaN-NaN-NaN-Fetchfenster, "2026-02-31" würde
    // still zum 3. März überlaufen — beide müssen auf heute zurückfallen.
    for (const bad of ["foo", "2026-02-31"]) {
      mockSearch.value = `d=${bad}`;
      const { unmount } = render(<VertretungView />);

      const props = mockDayListProps.mock.calls.at(-1)?.[0];
      expect(props.instances.map((i: EnrichedInstance) => i.id)).toEqual([
        "42",
      ]);
      expect(props.instances[0].date).toBe("2026-07-15");
      unmount();
    }
  });

  it("strips unknown query params on the first URL write", () => {
    mockSearch.value = "d=2026-07-15&utm_source=x";
    window.history.replaceState(
      null,
      "",
      "/acme/vertretung?d=2026-07-15&utm_source=x",
    );
    render(<VertretungView />);

    fireEvent.click(screen.getByRole("button", { name: "Do 16.07." }));
    expect(urlKeys()).toEqual(["d"]);
    expect(new URLSearchParams(window.location.search).get("d")).toBe(
      "2026-07-16",
    );
  });

  it("keeps the URL to at most d/block/verlauf across interactions", () => {
    mockSearch.value = "d=2026-07-15&block=42";
    window.history.replaceState(
      null,
      "",
      "/acme/vertretung?d=2026-07-15&block=42",
    );
    render(<VertretungView />);

    const allowed = ["d", "block", "verlauf"];
    const expectAllowed = () => {
      for (const key of urlKeys()) expect(allowed).toContain(key);
    };

    // Tageswechsel über einen Wochenleisten-Chip: setzt d, entfernt block+verlauf.
    fireEvent.click(screen.getByRole("button", { name: "Do 16.07." }));
    expect(urlKeys()).toEqual(["d"]);
    expect(new URLSearchParams(window.location.search).get("d")).toBe(
      "2026-07-16",
    );

    // Editor öffnen aus der Liste: setzt block.
    fireEvent.click(screen.getByText("day-list-edit"));
    expectAllowed();
    expect(new URLSearchParams(window.location.search).get("block")).toBe("42");

    // Reiterwechsel auf Verlauf: setzt verlauf=1.
    fireEvent.click(screen.getByText("editor-history"));
    expect(urlKeys().sort()).toEqual(["block", "d", "verlauf"]);

    // Editor schließen: entfernt block UND verlauf.
    fireEvent.click(screen.getByText("editor-close"));
    expect(urlKeys()).toEqual(["d"]);
  });

  it("räumt verlauf ab, wenn ein Block per Klick geöffnet wird", () => {
    mockSearch.value = "d=2026-07-15&block=42";
    window.history.replaceState(
      null,
      "",
      "/acme/vertretung?d=2026-07-15&block=42",
    );
    render(<VertretungView />);

    fireEvent.click(screen.getByText("editor-history"));
    expect(new URLSearchParams(window.location.search).get("verlauf")).toBe(
      "1",
    );

    // Block-Klick bei offenem Verlaufs-Reiter: verlauf darf nicht in der URL
    // kleben, sonst startet der nächste geöffnete Block im Verlauf statt im
    // Bearbeiten-Formular (Muster der alten handleSelectInstance).
    fireEvent.click(screen.getByText("grid-click"));
    expect(new URLSearchParams(window.location.search).get("block")).toBe("42");
    expect(new URLSearchParams(window.location.search).has("verlauf")).toBe(
      false,
    );
  });

  it("zeigt für einen vollständig vergangenen Tag keine Lückenzahl (nie eine erfundene 0) und sagt, warum", () => {
    mockSearch.value = "d=2026-06-15"; // Woche komplett in der Vergangenheit
    setupSWR({
      weekData: {
        from: "2026-06-15",
        to: "2026-06-21",
        instances: [makeInstance({ id: "7", date: "2026-06-15" })],
      },
    });
    render(<VertretungView />);

    // Weder die Statuszeile noch ein Tag der Leiste behauptet eine Zahl.
    expect(screen.queryByText(/offene Lücken?/)).not.toBeInTheDocument();
    expect(screen.queryByText("bewusst unbesetzt")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mo 15.06." }),
    ).toBeInTheDocument();
    const props = mockDayListProps.mock.calls.at(-1)?.[0];
    expect(props.gapsAvailable).toBe(false);
    // Ein vergangener Tag ist kein Ladefehler: die Liste bekommt den Satz
    // dafür, keinen Platzhalter.
    render(<>{props.gapsNotice}</>);
    expect(
      screen.getByText(
        "Der Tag ist vorbei. Offene Lücken zeigt moto nur ab heute.",
      ),
    ).toBeInTheDocument();
  });

  it("passes unavailable gaps to the list while the gaps request is still loading", () => {
    setupSWR({ gapsLoading: true });
    render(<VertretungView />);

    const props = mockDayListProps.mock.calls.at(-1)?.[0];
    expect(props.gapsAvailable).toBe(false);
    // Laden ist ein Platzhalter, kein Hinweis und kein Ergebnis.
    expect(props.gapsLoading).toBe(true);
    expect(props.gapsNotice).toBeUndefined();
    expect(props.nextOpenDay).toBeUndefined();
  });

  it("behauptet beim Wochenwechsel nichts aus den Daten der vorigen Woche", () => {
    // SWR reicht beim Wechsel die alten Daten weiter (`keepPreviousData`).
    // Auf die neue Woche gefiltert wären das null Lücken und null Termine.
    setupSWR({ gapsLoadingWithPreviousData: true });
    const { unmount } = render(<VertretungView />);

    const props = mockDayListProps.mock.calls.at(-1)?.[0];
    expect(props.gapsAvailable).toBe(false);
    expect(props.gapsLoading).toBe(true);
    expect(props.nextOpenDay).toBeUndefined();
    expect(screen.queryByText(/offene Lücken?/)).not.toBeInTheDocument();
    unmount();

    setupSWR({ weekLoading: true });
    mockSearch.value = "d=2026-07-17"; // Freitag: in den alten Daten leer
    render(<VertretungView />);
    expect(screen.getByRole("status", { busy: true })).toBeInTheDocument();
    expect(
      screen.queryByText("Keine Termine an diesem Tag"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Termine")).not.toBeInTheDocument();
  });

  it("passes unavailable gaps to the list when the gaps request fails", () => {
    setupSWR({ gapsError: new Error("gaps unavailable") });
    render(<VertretungView />);

    expect(mockDayListProps.mock.calls.at(-1)?.[0].gapsAvailable).toBe(false);
  });

  it("gibt einen Ladefehler der Lücken in die Liste, der sie fehlen, mit Wiederholen nur der Lücken", async () => {
    setupSWR({
      gapsError: new ApiError("gaps down", 503, {
        code: "general.unavailable",
      }),
    });
    render(<VertretungView />);

    // Der Fehler steht einmal, in der Liste (#7493): nicht mehr zusätzlich
    // als eigener Hinweis über dem Inhalt.
    const text = catalogText(
      "general.unavailable",
      "die Liste der offenen Lücken",
    );
    await waitFor(() =>
      expect(mockDayListProps.mock.calls.at(-1)?.[0].gapsNotice).toBeDefined(),
    );
    expect(screen.getByTestId("day-list")).toBeInTheDocument();
    expect(screen.queryByText(text)).not.toBeInTheDocument();
    render(<>{mockDayListProps.mock.calls.at(-1)?.[0].gapsNotice}</>);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(mockToastError).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(mockTenantMutate.mock.calls.map((c) => c[0] as string)).toEqual([
      "vertretung-gaps-2026-07-15-2026-07-19",
    ]);
  });

  it("zeigt einen Ladefehler der Personalliste vor Ort und meldet ihn an Editor und Sammel-Vertretung", async () => {
    setupSWR({
      staffError: new ApiError("staff down", 500, { code: "general.server" }),
    });
    render(<VertretungView />);

    expect(
      await screen.findByText(
        catalogText("general.server", "die Personalliste"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/staff down/)).not.toBeInTheDocument();
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockEditorProps.mock.calls.at(-1)?.[0].staffLoadError).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(mockTenantMutate.mock.calls.map((c) => c[0] as string)).toEqual([
      "vertretung-staff-list-2026-07-13-2026-07-19",
    ]);
  });

  it("renders an error surface (not an empty plan) when the week fails to load", async () => {
    setupSWR({
      weekError: new ApiError("boom", 500, {
        code: "general.server",
        instance: "req-week",
      }),
    });
    render(<VertretungView />);

    // Der Ladefehler kommt aus dem TenantPage-Gerüst (`error`), nicht aus
    // einer eigenen Fehlerfläche der Seite: Katalogtext, nie der Servertext.
    expect(
      await screen.findByText(
        catalogText("general.server", "die Liste der Termine"),
      ),
    ).toBeVisible();
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Wiederholen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Vorgangskennung kopieren" }),
    ).toHaveTextContent("req-week");
    expect(screen.queryByTestId("day-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("calendar-grid")).not.toBeInTheDocument();
    // #2517: keine Zählung aus einer Woche, die nie geladen wurde.
    // Wert und Wort der Statuszeile stehen in eigenen Elementen.
    expect(document.body).not.toHaveTextContent(/0\s*Termine/);
    // Ladefehler nie als Toast: niemand hat eine Aktion ausgelöst.
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("zeigt bis zum Katalogtext eines Wochen-Ladefehlers das Skelett, nie einen leeren Plan", () => {
    setupSWR({
      weekError: new ApiError("down", 503, { code: "general.unavailable" }),
    });
    render(<VertretungView />);

    // Der Katalog lädt asynchron; im ersten Render steht weder Raster noch
    // Liste da.
    // Anker: das Skelett des Gerüsts.
    expect(
      screen.getByRole("status", {
        name: "Der Bereich „Vertretungsplan“ wird geladen…",
      }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("calendar-grid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("day-list")).not.toBeInTheDocument();
  });

  it("retries week, gaps, AND staff list from the error surface", async () => {
    // Ein Backend-Blip lässt typischerweise alle drei Abrufe gleichzeitig
    // scheitern; ein Retry nur des Wochen-Keys ließe Gaps-Chips und
    // Personal-Hinweis bis zum Reload stale.
    setupSWR({
      weekError: new ApiError("down", 503, { code: "general.unavailable" }),
    });
    render(<VertretungView />);

    fireEvent.click(await screen.findByRole("button", { name: "Wiederholen" }));
    expect(mockTenantMutate.mock.calls.map((c) => c[0] as string)).toEqual([
      "vertretung-week-2026-07-13-2026-07-19",
      "vertretung-gaps-2026-07-15-2026-07-19",
      "vertretung-staff-list-2026-07-13-2026-07-19",
    ]);
  });

  it("defaults the list filter to 'Nur Störungen' and toggles to 'Ganzer Tag'", async () => {
    render(<VertretungView />);

    expect(mockDayListProps.mock.calls.at(-1)?.[0].mode).toBe("stoerungen");

    // Der Umschalter sitzt seit #2031 in der Liste, die er filtert (die hier
    // gemockt ist). Getestet wird deshalb die Verdrahtung: der Callback der
    // Liste setzt den Modus, den sie beim nächsten Rendern zurückbekommt. Die
    // Bedienung des Umschalters selbst prüft vertretung-list-filter.test.tsx.
    act(() => {
      mockDayListProps.mock.calls.at(-1)?.[0].onModeChange("ganzer-tag");
    });

    await waitFor(() =>
      expect(mockDayListProps.mock.calls.at(-1)?.[0].mode).toBe("ganzer-tag"),
    );
  });

  it("applies a cancel save in one call and clears block from the URL", async () => {
    mockSearch.value = "d=2026-07-15&block=42&verlauf=1";
    window.history.replaceState(
      null,
      "",
      "/acme/vertretung?d=2026-07-15&block=42&verlauf=1",
    );
    render(<VertretungView />);

    fireEvent.click(screen.getByText("editor-cancel-save"));

    await waitFor(() =>
      expect(mockApplyDeviations).toHaveBeenCalledWith("42", { cancel: true }),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith("Der Termin ist abgesagt.");
    // Cache-Refresh nach dem committeten Save.
    await waitFor(() => expect(mockTenantMutate).toHaveBeenCalled());
    // block und verlauf sind aus der URL entfernt.
    expect(urlKeys()).toEqual(["d"]);
  });

  it("nennt im Erfolgs-Toast die geänderten Termine und die Person", async () => {
    setupSWR({ staffData: [{ id: "11", name: "Anna Alt" }] });
    mockSearch.value = "d=2026-07-15&block=42";
    window.history.replaceState(
      null,
      "",
      "/acme/vertretung?d=2026-07-15&block=42",
    );
    mockApplyScheduleSubstitution.mockResolvedValueOnce({
      instanceId: "42",
      cancelled: false,
      understaffedAck: false,
      affectedInstances: [
        {
          instanceId: "42",
          title: "Mensa",
          startTime: "12:00",
          action: "substituted",
        },
        {
          instanceId: "43",
          title: "Lernzeit",
          startTime: "14:00",
          action: "substituted",
        },
      ],
      warnings: [],
    });
    render(<VertretungView />);

    fireEvent.click(screen.getByText("editor-save"));

    await waitFor(() =>
      expect(mockApplyScheduleSubstitution).toHaveBeenCalledWith("42", {
        substitutions: [
          {
            absentStaffId: "11",
            substituteStaffId: "12",
            instanceIds: ["42", "43"],
          },
        ],
      }),
    );
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(
        "2 Termine wurden für Anna Alt angepasst.",
      ),
    );
  });

  it("nennt im Erfolgs-Toast, wer wen vertritt, und zählt nur die vertretenen Termine", async () => {
    setupSWR({
      staffData: [
        { id: "11", name: "Anna Alt" },
        { id: "12", name: "Bea Neu" },
      ],
    });
    mockSearch.value = "d=2026-07-15&block=42";
    window.history.replaceState(
      null,
      "",
      "/acme/vertretung?d=2026-07-15&block=42",
    );
    // Das Speichern berührt drei Termine, vertreten werden zwei.
    mockApplyScheduleSubstitution.mockResolvedValueOnce({
      instanceId: "42",
      cancelled: false,
      understaffedAck: false,
      affectedInstances: [
        {
          instanceId: "42",
          title: "Mensa",
          startTime: "12:00",
          action: "substituted",
        },
        {
          instanceId: "43",
          title: "Lernzeit",
          startTime: "14:00",
          action: "substituted",
        },
        {
          instanceId: "44",
          title: "Bus",
          startTime: "16:00",
          action: "absent",
        },
      ],
      warnings: [],
    });
    render(<VertretungView />);

    fireEvent.click(screen.getByText("editor-save"));

    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(
        "Bea Neu vertritt Anna Alt in 2 Terminen.",
      ),
    );
  });

  it("gibt einen Speicherfehler an den offenen Editor zurück statt eines Toasts", async () => {
    mockSearch.value = "d=2026-07-15&block=42";
    window.history.replaceState(
      null,
      "",
      "/acme/vertretung?d=2026-07-15&block=42",
    );
    const failure = new ApiError(
      "Vertretung konnte nicht gespeichert werden.",
      409,
      {
        code: "timetable.substitute_conflict",
      },
    );
    mockApplyScheduleSubstitution.mockRejectedValueOnce(failure);
    render(<VertretungView />);

    fireEvent.click(screen.getByText("editor-save"));

    await waitFor(() =>
      expect(mockApplyRejected).toHaveBeenCalledWith(failure),
    );
    // Toasts lägen unter dem offenen Panel; der Editor zeigt den Fehler.
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    // Auch nach einem Fehler wird der Stand neu geladen.
    expect(mockTenantMutate).toHaveBeenCalledWith(
      "vertretung-week-2026-07-13-2026-07-19",
    );
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });

  it("weist nach dem Speichern in einem ganzen Satz auf Zeitüberschneidungen hin", async () => {
    mockSearch.value = "d=2026-07-15&block=42";
    window.history.replaceState(
      null,
      "",
      "/acme/vertretung?d=2026-07-15&block=42",
    );
    mockApplyScheduleSubstitution.mockResolvedValueOnce({
      instanceId: "42",
      cancelled: false,
      understaffedAck: false,
      affectedInstances: [],
      warnings: [{}, {}],
    });
    render(<VertretungView />);

    fireEvent.click(screen.getByText("editor-save"));

    await waitFor(() =>
      expect(mockToastWarning).toHaveBeenCalledWith(
        "Bitte prüfe 2 mögliche Zeitüberschneidungen.",
        { duration: 0 },
      ),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Die Vertretung wurde gespeichert.",
    );
  });

  // --- Wochenansicht (#2030) -------------------------------------------
  // Die Tagesansicht ist der Standard; die Woche ist eine zusätzliche Sicht
  // auf dieselben bereits geladenen Daten und lebt in `view=woche`.

  it("startet in der Tagesansicht und gibt dem Raster genau einen Tag", () => {
    render(<VertretungView />);

    expect(screen.getByRole("button", { name: "Tag" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(mockGridProps.mock.calls.at(-1)?.[0].weekDays).toHaveLength(1);
    expect(screen.getByTestId("day-list")).toBeInTheDocument();
    expect(
      screen.queryByTestId("vertretung-week-list"),
    ).not.toBeInTheDocument();
    expect(urlKeys()).toEqual([]);
  });

  it("schaltet über die Kontextleiste auf die Woche und schreibt view=woche in die URL", async () => {
    render(<VertretungView />);

    fireEvent.click(screen.getByRole("button", { name: "Woche" }));

    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("view")).toBe(
        "woche",
      ),
    );
  });

  it("stellt die Wochenansicht aus einem Deep-Link wieder her", () => {
    mockSearch.value = "view=woche";
    render(<VertretungView />);

    expect(screen.getByRole("button", { name: "Woche" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("vertretung-week-list")).toBeInTheDocument();
    expect(screen.queryByTestId("day-list")).not.toBeInTheDocument();
    // Statt der Tagesleiste steht das Wochenlabel zwischen den Pfeilen — über
    // Mo–Fr, nicht über das Mo–So-Fetch-Fenster.
    expect(screen.getByText(/13\.07\.–17\.07\.2026/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mi 15.07." }),
    ).not.toBeInTheDocument();
  });

  it("zeigt in der Wochenansicht alle fünf Schultage mit ihren Terminen", () => {
    mockSearch.value = "view=woche";
    render(<VertretungView />);

    const grid = mockGridProps.mock.calls.at(-1)?.[0];
    expect(grid.weekDays).toHaveLength(5);
    // Mi und Do liegen in derselben Woche — beide Termine sind im Raster.
    expect(grid.instances.map((i: EnrichedInstance) => i.id)).toEqual([
      "42",
      "43",
    ]);
    for (const iso of [
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
    ]) {
      expect(
        screen.getByTestId(`vertretung-week-list-day-${iso}`),
      ).toBeInTheDocument();
    }
  });

  it("markiert in der Wochenansicht die Lücken aller Tage und zählt sie über die Woche", () => {
    setupSWR({
      gapsData: {
        from: "2026-07-15",
        to: "2026-07-19",
        gaps: [
          { instanceId: "42", date: "2026-07-15" },
          { instanceId: "43", date: "2026-07-16" },
        ],
        acknowledged: [],
      },
    });
    mockSearch.value = "view=woche";
    render(<VertretungView />);

    const grid = mockGridProps.mock.calls.at(-1)?.[0];
    expect([...(grid.gapInstanceIds as Set<string>)].sort()).toEqual([
      "42",
      "43",
    ]);
    // Die Statuszeile zählt in der Wochenansicht die Woche, einmal. Das
    // Fenster beginnt heute (Mittwoch), das sagt die Angabe dazu.
    const stats = screen.getByText("offene Lücken ab heute").parentElement;
    expect(stats).toHaveTextContent("2 offene Lücken ab heute");
    expect(screen.queryByText(/^Offen:/)).not.toBeInTheDocument();
    // Eine Null bei „bewusst unbesetzt“ ändert keine Entscheidung.
    expect(screen.queryByText("bewusst unbesetzt")).not.toBeInTheDocument();
  });

  it("nennt die offenen Lücken des Tages einmal mit Namen in der Statuszeile, die Tagesleiste zeigt die Woche", () => {
    setupSWR({
      gapsData: {
        from: "2026-07-15",
        to: "2026-07-19",
        gaps: [
          { instanceId: "42", date: "2026-07-15" },
          { instanceId: "43", date: "2026-07-16" },
        ],
        acknowledged: [{ instanceId: "44", date: "2026-07-15" }],
      },
    });
    render(<VertretungView />);

    expect(
      screen.getByRole("button", { name: "Mi 15.07., 1 offene Lücke" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Do 16.07., 1 offene Lücke" }),
    ).toBeInTheDocument();
    expect(screen.getByText("offene Lücke").parentElement).toHaveTextContent(
      "1 offene Lücke",
    );
    // Das Bedienband wiederholt die Zahl nicht mehr.
    expect(screen.queryByText(/^Offen:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Quittiert:/)).not.toBeInTheDocument();
    // „Bewusst unbesetzt“ steht an keinem Tag der Leiste, also hier.
    expect(
      screen.getByText("bewusst unbesetzt").parentElement,
    ).toHaveTextContent("1 bewusst unbesetzt");
    // Das Ergebnis der Liste kennt den nächsten Tag mit offenen Lücken.
    const next = mockDayListProps.mock.calls.at(-1)?.[0].nextOpenDay;
    expect(next).toMatchObject({ label: "Do 16.07.", count: 1 });
  });

  it("zeigt am Wochenende keine erfundenen Wochenzähler für ein leeres sichtbares Lückenfenster", () => {
    // Für die laufende Woche lädt der Endpunkt ab Samstag. Die Wochenansicht
    // zeigt aber nur Mo–Fr; ein erfolgreicher Request enthält damit keine
    // sichtbaren Tage und darf nicht als bestätigte Null gewertet werden.
    vi.setSystemTime(new Date("2026-07-18T12:00:00Z")); // Samstag
    setupSWR({
      gapsData: {
        from: "2026-07-18",
        to: "2026-07-19",
        gaps: [],
        acknowledged: [],
      },
    });
    mockSearch.value = "d=2026-07-17&view=woche";
    render(<VertretungView />);

    // Anker: die Woche ist geladen und zeigt ihre Termine.
    expect(screen.getByText("Termine")).toBeInTheDocument();
    expect(screen.queryByText(/offene Lücken?/)).not.toBeInTheDocument();
    expect(screen.queryByText("bewusst unbesetzt")).not.toBeInTheDocument();
  });

  it("öffnet aus der Wochenliste denselben Editor wie die Tagesansicht", () => {
    // Der Donnerstags-Termin muss gestört sein, sonst steht er im Modus
    // "Nur Störungen" nicht in der Liste.
    setupSWR({
      gapsData: {
        from: "2026-07-15",
        to: "2026-07-19",
        gaps: [{ instanceId: "43", date: "2026-07-16" }],
        acknowledged: [],
      },
    });
    mockSearch.value = "view=woche";
    window.history.replaceState(null, "", "/acme/vertretung?view=woche");
    const { unmount } = render(<VertretungView />);

    const thursday = screen.getByTestId("vertretung-week-list-day-2026-07-16");
    fireEvent.click(
      // Für den Termin ist niemand eingeteilt: kein „Besetzen“.
      within(thursday).getByRole("button", { name: /^Bearbeiten: Fussball/ }),
    );

    expect(new URLSearchParams(window.location.search).get("block")).toBe("43");
    // Die Ansicht bleibt beim Öffnen des Editors erhalten.
    expect(new URLSearchParams(window.location.search).get("view")).toBe(
      "woche",
    );

    // Derselbe Editor wie in der Tagesansicht — der Klick schreibt nur `block`,
    // gerendert wird daraus (der Suchparam-Mock re-rendert nicht von selbst).
    unmount();
    mockSearch.value = "view=woche&block=43";
    render(<VertretungView />);
    const editor = mockEditorProps.mock.calls.at(-1)?.[0];
    expect(editor.instance?.id).toBe("43");
    expect(
      editor.dayInstances.map((instance: EnrichedInstance) => instance.id),
    ).toEqual(["43"]);
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });

  it("springt per Tageskopfzeile aus der Woche in die Tagesansicht", () => {
    mockSearch.value = "view=woche";
    window.history.replaceState(null, "", "/acme/vertretung?view=woche");
    render(<VertretungView />);

    fireEvent.click(
      screen.getByRole("button", { name: "Do 16.07. als Tagesansicht öffnen" }),
    );

    const params = new URLSearchParams(window.location.search);
    expect(params.get("d")).toBe("2026-07-16");
    expect(params.has("view")).toBe(false);
  });

  it("hält die URL auch mit view auf dem erlaubten Vokabular", () => {
    mockSearch.value = "view=woche&block=42&utm_source=x";
    window.history.replaceState(
      null,
      "",
      "/acme/vertretung?view=woche&block=42&utm_source=x",
    );
    render(<VertretungView />);

    fireEvent.click(screen.getByText("editor-history"));
    expect(urlKeys().sort()).toEqual(["block", "verlauf", "view"]);
  });

  it("renders the disabled state when timetable.enabled is false", () => {
    setupSWR();
    vi.mocked(useTimetableEnabled).mockReturnValue(false);
    try {
      render(<VertretungView />);
    } finally {
      vi.mocked(useTimetableEnabled).mockReturnValue(true);
    }

    expect(screen.getByTestId("vertretung-disabled-state")).toBeVisible();
    expect(
      screen.getByText("Der Vertretungsplan ist ausgeschaltet"),
    ).toBeVisible();
    expect(screen.queryByTestId("day-list")).not.toBeInTheDocument();
  });

  // Einsätze ohne Dienstplan-Abdeckung sind KEINE Störung (die Definition
  // bleibt vierteilig), sondern ein Planungshinweis über der Liste.
  describe("Dienstplan-Abdeckungshinweis", () => {
    function coverageAssignment(overrides: Record<string, unknown> = {}) {
      return {
        instanceId: "42",
        staffId: "11",
        date: "2026-07-15",
        startTime: "12:00",
        endTime: "14:00",
        activityTitle: "Mensa",
        status: "planned",
        isAbsent: false,
        isSubstitute: false,
        coverageStatus: "uncovered",
        coverageReason: null,
        uncoveredIntervals: [{ startTime: "12:30", endTime: "14:00" }],
        ...overrides,
      };
    }

    function authenticateWithOverviewAccess() {
      mockUseSession.mockReturnValue({
        status: "authenticated",
        data: {
          user: {
            roles: ["admin"],
            permissions: [
              "schedules:manage",
              "schedules:read",
              "time_tracking:manage",
              "users:read",
            ],
          },
        },
      });
    }

    it("zählt die nicht abgedeckten Einsätze und verlinkt den Dienstplan", () => {
      authenticateWithOverviewAccess();
      setupSWR({
        coverageData: {
          dienstplanInUse: true,
          assignments: [coverageAssignment()],
        },
      });
      render(<VertretungView />);

      expect(
        screen.getByText(
          "Bei 1 Einsatz fehlt die passende Schicht im Dienstplan.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Dienstplan öffnen" }),
      ).toHaveAttribute("href", "/acme/dienstplan?d=2026-07-15");
    });

    it("lässt abgedeckte Einsätze aus der Zählung", () => {
      authenticateWithOverviewAccess();
      setupSWR({
        coverageData: {
          dienstplanInUse: true,
          assignments: [
            coverageAssignment(),
            coverageAssignment({
              instanceId: "44",
              staffId: "12",
              coverageStatus: "covered",
              uncoveredIntervals: [],
            }),
          ],
        },
      });
      render(<VertretungView />);

      expect(
        screen.getByText(
          "Bei 1 Einsatz fehlt die passende Schicht im Dienstplan.",
        ),
      ).toBeInTheDocument();
    });

    it("zählt nicht in die Lückenzahlen", () => {
      authenticateWithOverviewAccess();
      setupSWR({
        coverageData: {
          dienstplanInUse: true,
          assignments: [coverageAssignment()],
        },
      });
      render(<VertretungView />);

      // Anker: der Hinweis ist da. Trotzdem trägt kein Tag eine offene
      // Lücke, und die Liste bekommt keine.
      expect(
        screen.getByText(
          "Bei 1 Einsatz fehlt die passende Schicht im Dienstplan.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Mi 15.07." }),
      ).toBeInTheDocument();
      expect(mockDayListProps.mock.calls.at(-1)?.[0].gaps).toEqual([]);
      mockSearch.value = "view=woche";
      render(<VertretungView />);
      expect(
        screen.getByText("offene Lücken ab heute").parentElement,
      ).toHaveTextContent("0 offene Lücken ab heute");
    });

    it("bleibt still ohne die Rechte der Dienstplan-Übersicht", () => {
      // Standard-Session aus beforeEach: nur schedules:manage.
      setupSWR({
        coverageData: {
          dienstplanInUse: true,
          assignments: [coverageAssignment()],
        },
      });
      render(<VertretungView />);

      // Anker: die Tagesliste ist geladen, nur der Hinweis fehlt.
      expect(screen.getByTestId("day-list")).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Dienstplan öffnen" }),
      ).not.toBeInTheDocument();
    });

    it("bleibt still für Nicht-Administratoren mit den Rechten der Dienstplan-Übersicht", () => {
      setupSWR({
        coverageData: {
          dienstplanInUse: true,
          assignments: [coverageAssignment()],
        },
      });
      mockUseSession.mockReturnValue({
        status: "authenticated",
        data: {
          user: {
            permissions: [
              "schedules:manage",
              "schedules:read",
              "time_tracking:manage",
              "users:read",
            ],
          },
        },
      });
      render(<VertretungView />);

      // Anker: die Tagesliste ist geladen, nur der Hinweis fehlt.
      expect(screen.getByTestId("day-list")).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Dienstplan öffnen" }),
      ).not.toBeInTheDocument();
    });

    it("bleibt still, solange kein Dienstplan gepflegt ist", () => {
      authenticateWithOverviewAccess();
      setupSWR({
        coverageData: {
          dienstplanInUse: false,
          assignments: [coverageAssignment()],
        },
      });
      render(<VertretungView />);

      // Anker: die Tagesliste ist geladen, nur der Hinweis fehlt.
      expect(screen.getByTestId("day-list")).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Dienstplan öffnen" }),
      ).not.toBeInTheDocument();
    });

    it("bleibt still, wenn die Dienstplan-Abfrage fehlschlägt", () => {
      authenticateWithOverviewAccess();
      setupSWR({
        coverageData: {
          dienstplanInUse: true,
          assignments: [coverageAssignment()],
        },
        coverageError: new Error("Netzwerkfehler"),
      });
      render(<VertretungView />);

      // Anker: die Tagesliste ist geladen, nur der Hinweis fehlt.
      expect(screen.getByTestId("day-list")).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Dienstplan öffnen" }),
      ).not.toBeInTheDocument();
    });

    it("bleibt still für einen vergangenen Tag", () => {
      authenticateWithOverviewAccess();
      mockSearch.value = "d=2026-07-14";
      setupSWR({
        weekData: {
          from: "2026-07-13",
          to: "2026-07-19",
          instances: [makeInstance({ id: "41", date: "2026-07-14" })],
        },
        coverageData: {
          dienstplanInUse: true,
          assignments: [coverageAssignment({ date: "2026-07-14" })],
        },
      });
      render(<VertretungView />);

      // Anker: die Tagesliste ist geladen, nur der Hinweis fehlt.
      expect(screen.getByTestId("day-list")).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Dienstplan öffnen" }),
      ).not.toBeInTheDocument();
    });

    it("meldet in der Wochenansicht denselben Satz und öffnet die gezeigte Woche", () => {
      authenticateWithOverviewAccess();
      mockSearch.value = "view=woche";
      setupSWR({
        coverageData: {
          dienstplanInUse: true,
          assignments: [
            coverageAssignment({ date: "2026-07-16", instanceId: "43" }),
          ],
        },
      });
      render(<VertretungView />);

      expect(
        screen.getByText(
          "Bei 1 Einsatz fehlt die passende Schicht im Dienstplan.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Dienstplan öffnen" }),
      ).toHaveAttribute("href", "/acme/dienstplan?d=2026-07-13");
    });
  });
});
