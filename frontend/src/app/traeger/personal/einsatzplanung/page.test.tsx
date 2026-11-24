import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";
import type {
  TraegerPlanningPerson,
  TraegerPlanningWeek,
} from "~/lib/traeger-planning-api";
import { setTestClock } from "~/test/clock";
import { catalogText } from "~/test/error-catalog-text";

vi.unmock("swr");

const api = vi.hoisted(() => ({
  fetchTraegerPlanningWeek: vi.fn(),
  planTraegerShift: vi.fn(),
  changeTraegerShift: vi.fn(),
  removeTraegerShift: vi.fn(),
  fetchTraegerFutureShifts: vi.fn(),
}));

vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));
vi.mock("~/lib/traeger-planning-api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/personal/einsatzplanung",
  useSearchParams: () => new URLSearchParams(),
}));

import TraegerStaffPlanningPage from "./page";

// The fixture week starts Monday 2026-09-07; every test pins the clock to
// Wednesday 2026-09-09 so the page opens on that week.
const MIRA: TraegerPlanningPerson = {
  recordId: "11",
  firstName: "Mira",
  lastName: "Sommer",
  sites: [
    { schoolId: "1", schoolName: "OGS Nord", staffId: "101" },
    { schoolId: "2", schoolName: "OGS Süd", staffId: "201" },
  ],
  shifts: [
    {
      id: "501",
      schoolId: "1",
      schoolName: "OGS Nord",
      staffId: "101",
      date: "2026-09-07",
      startTime: "11:30",
      endTime: "16:30",
      breakMinutes: 0,
      notes: "",
      cancelled: false,
      shiftTypeName: null,
      shiftTypeColor: null,
      plannedByTraeger: true,
      fromSeries: false,
      version: "v501",
    },
    {
      id: "502",
      schoolId: "2",
      schoolName: "OGS Süd",
      staffId: "201",
      date: "2026-09-07",
      startTime: "18:00",
      endTime: "21:30",
      breakMinutes: 0,
      notes: "Elternabend",
      cancelled: false,
      shiftTypeName: null,
      shiftTypeColor: null,
      plannedByTraeger: false,
      fromSeries: false,
      version: "v502",
    },
  ],
  plannedMinutes: 510,
  sollMinutes: 1200,
  // Monday and Tuesday lie before today; Thursday at Nord is still open.
  sollDays: [
    { schoolId: "1", date: "2026-09-07", minutes: 300 },
    { schoolId: "1", date: "2026-09-08", minutes: 300 },
    { schoolId: "1", date: "2026-09-10", minutes: 420 },
    // Friday at Süd: on vacation, so no suggestion.
    { schoolId: "2", date: "2026-09-11", minutes: 240 },
  ],
  absentDays: [{ schoolId: "2", date: "2026-09-11" }],
  warnings: [
    {
      kind: "rest_period",
      date: "2026-09-08",
      minutes: 570,
      limit: 660,
      needsReason: true,
    },
  ],
};

const WEEK: TraegerPlanningWeek = {
  weekStart: "2026-09-07",
  rules: {
    enabled: true,
    maxDailyMinutes: 600,
    minRestMinutes: 660,
    checkBreaks: true,
  },
  schools: [
    { id: "1", name: "OGS Nord" },
    { id: "2", name: "OGS Süd" },
  ],
  people: [MIRA],
  unreached: [],
};

function renderPage() {
  return render(
    <TraegerResourceTestProvider>
      <TraegerStaffPlanningPage />
    </TraegerResourceTestProvider>,
  );
}

describe("TraegerStaffPlanningPage", () => {
  beforeEach(() => {
    setTestClock("2026-09-09T12:00:00+02:00");
    vi.clearAllMocks();
    api.fetchTraegerPlanningWeek.mockResolvedValue(WEEK);
  });

  it("shows the week of a person over all Einsatzorte with its hints", async () => {
    renderPage();
    expect((await screen.findAllByText("Sommer, Mira")).length).toBeGreaterThan(
      0,
    );
    expect(api.fetchTraegerPlanningWeek).toHaveBeenCalledWith("2026-09-07");
    expect(
      // Named by what the block shows, then the hidden details (#7112).
      screen.getByRole("button", {
        name: /^11:30–16:30 Vom Träger OGS Nord ?, vom Träger geplant, Schicht ändern$/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /^18:00–21:30 Schicht OGS Süd ?, Schicht ändern$/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("8,5/20 h")).toBeInTheDocument();
    const hints = screen
      .getByRole("heading", { name: "Hinweise dieser Woche" })
      .closest("section");
    expect(hints).not.toBeNull();
    expect(
      within(hints!).getByText(
        "Vor Di., 08.09.: nur 9,5 Stunden Ruhezeit. Nötig sind 11 Stunden.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Höchstens 10 h am Tag · 11 h Ruhezeit · Pausen geprüft",
      ),
    ).toBeInTheDocument();
  });

  it("plans despite a hint only with a confirmation and a reason", async () => {
    api.planTraegerShift
      .mockRejectedValueOnce(
        new ApiError("refused", 409, {
          code: "workforce.shift_working_time_warning",
          details: {
            reason_required: true,
            warnings: [
              {
                kind: "daily_maximum",
                date: "2026-09-08",
                minutes: 660,
                limit: 600,
                needs_reason: true,
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(MIRA.shifts[0]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Schicht planen, Mira Sommer, Di 08.09.",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Planen" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Trotzdem so planen?",
    });
    expect(
      within(dialog).getByText(
        "Di., 08.09.: 11 Stunden Arbeit geplant. Erlaubt sind 10 Stunden am Tag.",
      ),
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", {
      name: "Trotzdem planen",
    });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    fireEvent.change(within(dialog).getByLabelText(/Begründung/), {
      target: { value: "Elternabend" },
    });
    fireEvent.click(confirm);

    await vi.waitFor(() =>
      expect(api.planTraegerShift).toHaveBeenCalledTimes(2),
    );
    expect(api.planTraegerShift.mock.calls[0]?.[1]).toMatchObject({
      schoolId: "1",
      date: "2026-09-08",
      workingTime: undefined,
    });
    expect(api.planTraegerShift.mock.calls[1]?.[1]).toMatchObject({
      schoolId: "1",
      date: "2026-09-08",
      workingTime: { confirmed: true, reason: "Elternabend" },
    });
    expect(
      await screen.findByText(
        "Die Schicht von Mira Sommer steht im Dienstplan von OGS Nord.",
      ),
    ).toBeInTheDocument();
  });

  // ADR 0311: ein Ändern schickt den Stand der Schicht, die der Dialog
  // zeigt. Nach einer Ablehnung liest die Seite die Woche neu, der Dialog
  // zeigt die gespeicherte Schicht samt Meldung und speichert mit ihrem
  // Stand.
  it("changes a shift over the version it shows and again over the stored one after a refusal", async () => {
    const stored = {
      ...MIRA.shifts[0]!,
      startTime: "12:00",
      version: "v501-stored",
    };
    api.fetchTraegerPlanningWeek.mockResolvedValueOnce(WEEK).mockResolvedValue({
      ...WEEK,
      people: [{ ...MIRA, shifts: [stored, MIRA.shifts[1]!] }],
    });
    api.changeTraegerShift
      .mockRejectedValueOnce(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      )
      .mockResolvedValueOnce(stored);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: /^11:30–16:30 Vom Träger OGS Nord/,
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Schicht"),
      ),
    ).toBeInTheDocument();
    expect(api.changeTraegerShift.mock.calls[0]?.[2]).toMatchObject({
      expectedVersion: "v501",
    });
    expect(await screen.findByDisplayValue("12:00")).toBeInTheDocument();

    await vi.waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
      expect(api.changeTraegerShift).toHaveBeenCalledTimes(2);
    });
    expect(api.changeTraegerShift.mock.calls[1]?.[2]).toMatchObject({
      startTime: "12:00",
      expectedVersion: "v501-stored",
    });
  });

  it("closes the dialog with a message when the refused shift is gone", async () => {
    api.fetchTraegerPlanningWeek.mockResolvedValueOnce(WEEK).mockResolvedValue({
      ...WEEK,
      people: [{ ...MIRA, shifts: [MIRA.shifts[1]!] }],
    });
    api.changeTraegerShift.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: /^11:30–16:30 Vom Träger OGS Nord/,
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(/Deine Änderung ist nicht gespeichert/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Schicht ändern" }),
    ).not.toBeInTheDocument();
  });

  it("suggests the open contract day and plans it after a check (#7381)", async () => {
    api.planTraegerShift.mockResolvedValueOnce(MIRA.shifts[0]);
    renderPage();
    const suggestion = await screen.findByRole("button", {
      name: /^7 h Vorschlag OGS Nord ?, OGS Nord, aus dem Arbeitsvertrag, noch nicht geplant, Schicht planen$/,
    });
    expect(
      screen.getAllByRole("button", { name: /aus dem Arbeitsvertrag/ }),
    ).toHaveLength(1);
    expect(
      screen.getByText("Vorschlag aus dem Arbeitsvertrag"),
    ).toBeInTheDocument();

    fireEvent.click(suggestion);
    const dialog = await screen.findByRole("dialog", {
      name: "Schicht planen",
    });
    expect(
      within(dialog).getByText(
        /Laut Arbeitsvertrag 7 h an OGS Nord\. Prüfe Beginn und Ende\./,
      ),
    ).toBeInTheDocument();
    // Begins like her Monday at Nord; 7 h need 30 minutes of break.
    expect(within(dialog).getByLabelText(/Beginn/)).toHaveValue("11:30");
    expect(within(dialog).getByLabelText(/Ende/)).toHaveValue("19:00");
    expect(within(dialog).getByLabelText(/Pause/)).toHaveValue(30);
    fireEvent.click(within(dialog).getByRole("button", { name: "Planen" }));

    await vi.waitFor(() =>
      expect(api.planTraegerShift).toHaveBeenCalledTimes(1),
    );
    expect(api.planTraegerShift.mock.calls[0]?.[1]).toMatchObject({
      schoolId: "1",
      date: "2026-09-10",
      startTime: "11:30",
      endTime: "19:00",
      breakMinutes: 30,
    });
  });

  it("offers no new shift while the Träger plans outside moto", async () => {
    api.fetchTraegerPlanningWeek.mockResolvedValue({
      ...WEEK,
      rules: { ...WEEK.rules, enabled: false },
    });
    renderPage();
    expect(
      await screen.findByText(/Einsatzplanung in moto ist aus/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Schicht planen,/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /aus dem Arbeitsvertrag/ }),
    ).not.toBeInTheDocument();
    expect(
      // Named by what the block shows, then the hidden details (#7112).
      screen.getByRole("button", {
        name: /^11:30–16:30 Vom Träger OGS Nord ?, vom Träger geplant, Schicht ändern$/,
      }),
    ).toBeInTheDocument();
  });

  it("explains the missing release instead of an error", async () => {
    api.fetchTraegerPlanningWeek.mockRejectedValue(
      new ApiError("locked", 409, {
        code: "workforce.traeger_staff_not_released",
      }),
    );
    renderPage();
    // #7415: die Bauart „Funktion nicht eingeschaltet“ mit dem Satz der Seite.
    expect(
      await screen.findByText("Diese Funktion ist nicht eingeschaltet"),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Bis zur Freischaltung plant jede Schule ihren Dienstplan selbst\. Das moto-Team schaltet/,
      ),
    ).toBeInTheDocument();
  });
});
