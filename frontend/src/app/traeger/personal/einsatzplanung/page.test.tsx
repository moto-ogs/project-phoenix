import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type {
  TraegerPlanningPerson,
  TraegerPlanningWeek,
} from "~/lib/traeger-planning-api";

const api = vi.hoisted(() => ({
  fetchTraegerPlanningWeek: vi.fn(),
  planTraegerShift: vi.fn(),
  changeTraegerShift: vi.fn(),
  removeTraegerShift: vi.fn(),
  fetchTraegerFutureShifts: vi.fn(),
}));

vi.mock("~/lib/traeger-planning-api", () => api);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/personal/einsatzplanung",
  useSearchParams: () => new URLSearchParams(),
}));

import TraegerStaffPlanningPage from "./page";

// The test clock stands on Wednesday 2026-09-09; its week starts 2026-09-07.
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
    },
  ],
  plannedMinutes: 510,
  sollMinutes: 1200,
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
    <ToastProvider>
      <TraegerStaffPlanningPage />
    </ToastProvider>,
  );
}

describe("TraegerStaffPlanningPage", () => {
  beforeEach(() => {
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
    expect(
      await screen.findByText(
        "Personal beim Träger ist noch nicht freigeschaltet.",
      ),
    ).toBeInTheDocument();
  });
});
