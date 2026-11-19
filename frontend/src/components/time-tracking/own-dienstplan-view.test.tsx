import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/lib/api-error";
import type { StaffShift } from "~/lib/shift-helpers";
import type { DayProjection } from "~/lib/time-tracking-helpers";

interface SwrResult {
  data: unknown;
  error: Error | undefined;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
}

const state = vi.hoisted(() => ({
  shifts: undefined as StaffShift[] | undefined,
  shiftsError: undefined as Error | undefined,
  // useSWRAuth meldet isLoading=false, solange es den Abruf bis zur Session
  // zurückhält.
  shiftsHeldBack: false,
  // Suche nach der nächsten Schicht in den Wochen nach einer leeren Woche.
  aheadShifts: undefined as StaffShift[] | undefined,
  aheadError: undefined as Error | undefined,
  projection: undefined as ReadonlyMap<string, DayProjection> | undefined,
  projectionError: undefined as Error | undefined,
  hasOwnStaff: true,
  permissionReady: true,
  // Ohne time_tracking:own erklärt die Seite den Zustand (#7148).
  permissionDenied: false,
  // Gebucht ist die Zeiterfassung, aus der das Soll kommt (#4894).
  zeiterfassungBooked: true,
  closingDaysCalls: [] as [string, string][],
  day: null as string | null,
  keys: [] as (string | null)[],
  updateParams: vi.fn(),
  mutate: vi.fn(() => Promise.resolve(undefined)),
  mutateAhead: vi.fn(() => Promise.resolve(undefined)),
  mutateProjection: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("~/lib/swr", () => ({
  useSWRAuth: (key: string | null): SwrResult => {
    state.keys.push(key);
    if (key?.startsWith("time-tracking-own-shifts-week-ahead-")) {
      return {
        data: state.aheadShifts,
        error: state.aheadError,
        isLoading: false,
        mutate: state.mutateAhead,
      };
    }
    if (key?.startsWith("time-tracking-own-shifts-week-")) {
      return {
        data: state.shifts,
        error: state.shiftsError,
        isLoading:
          state.shifts === undefined &&
          !state.shiftsError &&
          !state.shiftsHeldBack,
        mutate: state.mutate,
      };
    }
    if (key?.startsWith("time-tracking-schedule-targets-")) {
      return {
        data: state.projection,
        error: state.projectionError,
        isLoading: false,
        mutate: state.mutateProjection,
      };
    }
    return {
      data: undefined,
      error: undefined,
      isLoading: false,
      mutate: state.mutate,
    };
  },
}));
// Personalprofil in dieser Schule laut Nutzerkontext (#7306).
vi.mock("~/lib/hooks/use-user-context", () => ({
  useHasOwnStaff: () => state.hasOwnStaff,
}));
vi.mock("~/lib/hooks/use-berlin-today", () => ({
  useBerlinToday: () => "2026-09-09",
}));
vi.mock("~/lib/hooks/use-require-permission", () => ({
  useRequirePermission: () => ({
    isReady: state.permissionReady && !state.permissionDenied,
    isDenied: state.permissionDenied,
  }),
}));
vi.mock("~/lib/hooks/use-url-params", () => ({
  useUrlParams: () => ({
    params: { d: state.day },
    updateParams: state.updateParams,
  }),
}));
vi.mock("~/lib/hooks/use-closing-days", () => ({
  useClosingDaysState: (from: string, to: string) => {
    state.closingDaysCalls.push([from, to]);
    return {
      closingDays: new Map([["2026-09-11", "Brückentag"]]),
      closingDayRanges: [],
      isLoading: false,
    };
  },
}));
vi.mock("~/lib/tenant-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/tenant-context")>()),
  useModuleBooked: (module: string) =>
    module === "zeiterfassung" ? state.zeiterfassungBooked : true,
}));
vi.mock("~/lib/tenant-router", () => ({
  useTenantRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("~/lib/shift-api", () => ({
  ownShiftService: { getOwnShifts: vi.fn() },
}));
vi.mock("~/lib/time-tracking-api", () => ({
  timeTrackingService: { getDailyProjection: vi.fn() },
}));

import { OwnDienstplanView } from "./own-dienstplan-view";

function shift(overrides: Partial<StaffShift> = {}): StaffShift {
  return {
    id: "11",
    staffId: "42",
    date: "2026-09-07",
    startTime: "08:00",
    endTime: "12:00",
    breakMinutes: 0,
    shiftTypeId: "21",
    shiftTypeName: "Frühdienst",
    shiftTypeColor: "#83CD2D",
    notes: "",
    seriesId: null,
    detached: false,
    cancelled: false,
    changeReason: null,
    originShiftId: null,
    ...overrides,
  };
}

function target(minutes: number): DayProjection {
  return {
    targetMinutes: minutes,
    creditMinutes: 0,
    actualMinutes: 0,
    balanceMinutes: 0,
  };
}

const WORKDAYS = [
  "2026-09-07",
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
  "2026-09-11",
];

describe("OwnDienstplanView", () => {
  beforeEach(() => {
    state.shifts = undefined;
    state.shiftsError = undefined;
    state.shiftsHeldBack = false;
    state.aheadShifts = undefined;
    state.aheadError = undefined;
    state.projection = undefined;
    state.projectionError = undefined;
    state.hasOwnStaff = true;
    state.permissionReady = true;
    state.permissionDenied = false;
    state.zeiterfassungBooked = true;
    state.closingDaysCalls = [];
    state.day = null;
    state.keys = [];
    state.updateParams.mockClear();
    state.mutate.mockClear();
    state.mutateAhead.mockClear();
    state.mutateProjection.mockClear();
  });

  it("shows the own week read-only with sums by Dienstart and the Soll", () => {
    state.shifts = [
      shift(),
      shift({
        id: "12",
        startTime: "12:30",
        endTime: "16:00",
        breakMinutes: 30,
        shiftTypeId: "22",
        shiftTypeName: "Spätdienst",
        shiftTypeColor: "#5080D8",
      }),
      shift({ id: "13", date: "2026-09-08" }),
      shift({ id: "14", date: "2026-09-09", cancelled: true }),
    ];
    state.projection = new Map(
      WORKDAYS.map((day) => [day, target(240)] as const),
    );

    render(<OwnDienstplanView />);

    expect(
      screen.getByRole("heading", { name: "Mein Dienstplan" }),
    ).toBeInTheDocument();
    // 4 h + 3 h + 4 h geplant (die ausgefallene Schicht zählt nicht), Soll
    // 5 × 4 h.
    const stats = screen.getByText("geplant").parentElement?.parentElement;
    expect(stats?.textContent).toBe("11 h geplant, 20 h Soll, −9 h Differenz");

    // Lesend: kein Anlegen, kein Bearbeiten.
    expect(
      screen.queryByRole("button", { name: /Schicht anlegen/ }),
    ).not.toBeInTheDocument();
    // The read-only blocks show time and Dienstart as text, as no buttons
    // (#7112: a block names itself by what it shows).
    const earlyBlocks = screen
      .getAllByText("08:00–12:00")
      .filter(
        (time) => time.closest("div")?.textContent === "08:00–12:00Frühdienst",
      );
    expect(earlyBlocks).toHaveLength(2);
    for (const time of earlyBlocks) {
      expect(time.closest("button")).toBeNull();
    }
    // Raster (ab lg) und Tagesliste (Handy) tragen beide den Hinweis.
    expect(screen.getAllByText(/Nur zur Information/)).toHaveLength(2);

    const hours = screen.getByTestId("own-week-hours-card");
    expect(hours).toHaveTextContent("Frühdienst8 h");
    expect(hours).toHaveTextContent("Spätdienst3 h");
    expect(hours).toHaveTextContent("Gesamt11 h");

    // Wochenend-Spalten nur bei Wochenend-Diensten; der Schließtag ist markiert.
    expect(screen.queryByText(/^Sa /)).not.toBeInTheDocument();
    expect(screen.getByTitle("Schließtag: Brückentag")).toBeInTheDocument();
  });

  it("lists the week per day on small screens, like Mein Kalender", () => {
    state.shifts = [
      shift(),
      shift({
        id: "12",
        startTime: "12:30",
        endTime: "16:00",
        breakMinutes: 30,
        shiftTypeId: "22",
        shiftTypeName: "Spätdienst",
        shiftTypeColor: "#5080D8",
      }),
      shift({ id: "14", date: "2026-09-09", cancelled: true }),
      shift({ id: "15", date: "2026-09-12", startTime: "10:00" }),
    ];

    render(<OwnDienstplanView />);

    const agenda = within(screen.getByTestId("own-week-agenda"));
    const headings = agenda
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    // Tage ohne Schicht fallen weg, ein Samstagsdienst steht mit drin.
    expect(headings).toEqual(["Mo 07.09.", "Mi 09.09.", "Sa 12.09."]);
    // Tagessumme ohne Pause; die ausgefallene Schicht zählt nicht.
    expect(agenda.getByText("7 h")).toBeInTheDocument();
    expect(agenda.getByText("0 h")).toBeInTheDocument();
    expect(agenda.getByText("Pause 30 min")).toBeInTheDocument();
    expect(agenda.getByText("Fällt aus")).toBeInTheDocument();
    // Nur lesend: keine Knöpfe in der Liste.
    expect(agenda.queryAllByRole("button")).toHaveLength(0);
  });

  it("loads Monday to Sunday so weekend shifts count and show", () => {
    state.shifts = [shift({ id: "15", date: "2026-09-13" })];

    render(<OwnDienstplanView />);

    expect(state.keys).toContain(
      "time-tracking-own-shifts-week-2026-09-07-2026-09-13",
    );
    expect(state.keys).toContain(
      "time-tracking-schedule-targets-2026-09-07-2026-09-13",
    );
    // Das Raster bekommt Sa und So als Spalten.
    expect(
      screen.getByTestId("person-week-day-2026-09-13"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("person-week-day-2026-09-12"),
    ).toBeInTheDocument();
  });

  it("omits Soll and Differenz while no target is known", () => {
    state.shifts = [shift()];

    render(<OwnDienstplanView />);

    expect(screen.getByText("geplant")).toBeInTheDocument();
    expect(screen.queryByText("Soll")).not.toBeInTheDocument();
    expect(screen.queryByText("Differenz")).not.toBeInTheDocument();
  });

  it("explains an empty week and who plans it while the search runs", () => {
    state.shifts = [];

    render(<OwnDienstplanView />);

    expect(
      screen.getByText("Keine Schichten in dieser Woche"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Deine Schichten plant die Leitung im Dienstplan/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Zur nächsten Schicht" }),
    ).not.toBeInTheDocument();
  });

  it("searches the eight weeks after an empty week for the next shift", () => {
    state.shifts = [];

    render(<OwnDienstplanView />);

    expect(state.keys).toContain(
      "time-tracking-own-shifts-week-ahead-2026-09-14-2026-11-08",
    );
  });

  it("does not search ahead while the week has shifts", () => {
    state.shifts = [shift()];

    render(<OwnDienstplanView />);

    expect(state.keys.some((key) => key?.includes("-week-ahead-"))).toBe(false);
  });

  it("names the next shift after an empty week and jumps to it", () => {
    state.shifts = [];
    state.aheadShifts = [
      shift({ id: "2", date: "2026-10-01" }),
      shift({ id: "3", date: "2026-09-22", cancelled: true }),
      shift({ id: "4", date: "2026-09-29" }),
    ];

    render(<OwnDienstplanView />);

    expect(
      screen.getByText(
        "Deine nächste Schicht nach dieser Woche ist am Dienstag, 29. September 2026.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Zur nächsten Schicht" }),
    );
    expect(state.updateParams).toHaveBeenCalledWith({ d: "2026-09-29" });
  });

  it("says who to ask when no shift follows in the next eight weeks", () => {
    state.shifts = [];
    state.aheadShifts = [];

    render(<OwnDienstplanView />);

    expect(
      screen.getByText(
        /Auch in den 8 Wochen danach ist keine Schicht eingetragen\. Deine Schichten plant die Leitung\. Frage dort nach/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Zur nächsten Schicht" }),
    ).not.toBeInTheDocument();
  });

  it("explains when only cancelled shifts follow in the next eight weeks", () => {
    state.shifts = [];
    state.aheadShifts = [
      shift({ id: "2", date: "2026-09-22", cancelled: true }),
    ];

    render(<OwnDienstplanView />);

    expect(
      screen.getByText(
        /In den 8 Wochen danach sind nur ausgefallene Schichten eingetragen\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Zur nächsten Schicht" }),
    ).not.toBeInTheDocument();
  });

  it("shows the failed look-ahead search and offers a retry", async () => {
    state.shifts = [];
    state.aheadError = new ApiError("unavailable", 503);

    render(<OwnDienstplanView />);

    expect(
      await screen.findByText(
        "Die Suche nach der nächsten Schicht ist gerade nicht erreichbar. Bitte versuche es erneut.",
      ),
    ).toBeInTheDocument();
    // Die aktuelle Woche ist bereits bestätigt leer und bleibt sichtbar.
    expect(
      screen.getByText("Keine Schichten in dieser Woche"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(state.mutateAhead).toHaveBeenCalledTimes(1);
  });

  it("keeps loading instead of claiming an empty week before the session", () => {
    state.shiftsHeldBack = true;

    render(<OwnDienstplanView />);

    // Anker: die Seite meldet den Ladezustand des Dienstplans.
    expect(
      screen.getByRole("status", { name: /Mein Dienstplan.*wird geladen/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Keine Schichten in dieser Woche/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("geplant")).not.toBeInTheDocument();
  });

  it("waits for the permission guard before loading own time-tracking data", () => {
    state.permissionReady = false;

    render(<OwnDienstplanView />);

    // Anker: die Seite wartet sichtbar im Ladezustand auf die Berechtigung.
    expect(
      screen.getByRole("status", { name: /Mein Dienstplan.*wird geladen/ }),
    ).toBeInTheDocument();
    expect(state.keys).toEqual([]);
    expect(screen.queryByText("geplant")).not.toBeInTheDocument();
  });

  // Ein Hinweis der Glocke führt mit ?d= hierher (#7148). Die fehlende
  // Berechtigung erklärt die Seite auch dann, wenn kein Personalprofil da ist.
  it("explains missing permission before a missing staff profile", () => {
    state.permissionDenied = true;
    state.hasOwnStaff = false;
    state.day = "2026-11-20";

    render(<OwnDienstplanView />);

    // Anker: die Erklärung des fehlenden Zugriffs steht da.
    expect(
      screen.getByText(/Du hast keinen Zugriff auf einen eigenen Dienstplan/),
    ).toBeInTheDocument();
    // This file renders without the tenant slug (real tenant context).
    expect(
      screen.getByRole("link", { name: "Zur Startseite" }),
    ).toHaveAttribute("href", "/home");
    expect(state.keys).toEqual([]);
  });

  // Ladefehler laufen über den gemeinsamen Fehlerpfad (Regel 3 in
  // error-path.md): Katalogtext des Codes und „Wiederholen“ (#7306).
  it("offers a retry when the shifts fail to load", async () => {
    state.shiftsError = new ApiError("unavailable", 503);

    render(<OwnDienstplanView />);

    expect(
      await screen.findByText(
        "Die Liste deiner Schichten ist gerade nicht erreichbar. Bitte versuche es erneut.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("geplant")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(state.mutate).toHaveBeenCalled();
  });

  it("keeps the shifts visible and offers a retry when the Soll fails to load", async () => {
    state.shifts = [shift()];
    state.projectionError = new ApiError("unavailable", 503);

    render(<OwnDienstplanView />);

    expect(
      await screen.findByText(
        "Das Soll dieser Woche ist gerade nicht erreichbar. Bitte versuche es erneut.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("own-week-hours-card")).toHaveTextContent(
      "Gesamt4 h",
    );
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(state.mutateProjection).toHaveBeenCalled();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("explains a missing staff profile before loading anything (#7306)", () => {
    state.hasOwnStaff = false;

    render(<OwnDienstplanView />);

    expect(screen.getByText(/Kein eigenes Personalprofil/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Erklärung zu Mein Dienstplan" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zur Startseite" }),
    ).toHaveAttribute("href", "/home");
    expect(state.keys).toEqual([]);
  });

  it("shows the staff profile hint instead of an error when the server refuses (#7306)", () => {
    state.shiftsError = new ApiError("no staff profile", 403, {
      code: "workforce.no_staff_profile",
    });

    render(<OwnDienstplanView />);

    expect(screen.getByText(/Kein eigenes Personalprofil/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("navigates by week through the d parameter", () => {
    state.shifts = [shift()];

    render(<OwnDienstplanView />);

    fireEvent.click(screen.getByRole("button", { name: "Nächste Woche" }));
    expect(state.updateParams).toHaveBeenCalledWith({ d: "2026-09-14" });
    fireEvent.click(screen.getByRole("button", { name: "Vorherige Woche" }));
    expect(state.updateParams).toHaveBeenCalledWith({ d: "2026-08-31" });
  });

  it("shows another week from the URL and offers the way back", () => {
    state.day = "2026-09-16";
    state.shifts = [shift({ date: "2026-09-14" })];

    render(<OwnDienstplanView />);

    expect(state.keys).toContain(
      "time-tracking-own-shifts-week-2026-09-14-2026-09-20",
    );
    fireEvent.click(screen.getByRole("button", { name: "Diese Woche" }));
    expect(state.updateParams).toHaveBeenCalledWith({ d: null });
  });

  // Seit #4894 hängt die Seite am Modul Dienstplan, nicht am Betreuungsplan;
  // ohne das Modul erklärt sich die Seite über TenantPage. Das Soll
  // kommt aus der Zeiterfassung und wird ohne dieses Modul nicht geladen.
  it("shows the week without the Soll when the school did not book Zeiterfassung", () => {
    state.zeiterfassungBooked = false;
    state.shifts = [shift()];

    render(<OwnDienstplanView />);

    expect(screen.getByText("geplant")).toBeInTheDocument();
    expect(screen.queryByText("Soll")).not.toBeInTheDocument();
    expect(
      state.keys.filter((key) =>
        key?.startsWith("time-tracking-schedule-targets"),
      ),
    ).toEqual([]);
    expect(
      state.keys.some((key) => key?.startsWith("time-tracking-own-shifts")),
    ).toBe(true);
  });
});
