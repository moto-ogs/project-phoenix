import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StaffSchedule } from "~/lib/staff-api";
import { TEST_CLOCK_TODAY } from "~/test/clock";
import { ArbeitszeitmodellTab } from "./arbeitszeitmodell-tab";

// #6887: ohne gepflegtes Soll sagt der Reiter, was fehlt und was daraus
// folgt, statt „Eigenes Modell · Schnitt 0min / Woche“.
const mocks = vi.hoisted(() => ({
  schedule: undefined as StaffSchedule | undefined,
  hasTarget: true as boolean | null,
  monthKey: "",
}));

vi.mock("~/lib/swr", () => ({
  useInvalidateMatching: () => vi.fn(),
  useSWRAuth: (key: string | null) => {
    if (key === "staff-schedule-42") {
      return { data: mocks.schedule, isLoading: false, mutate: vi.fn() };
    }
    if (key?.startsWith("staff-month-summary-42-")) {
      mocks.monthKey = key;
      return {
        data:
          mocks.hasTarget === null ? undefined : { hasTarget: mocks.hasTarget },
        isLoading: mocks.hasTarget === null,
      };
    }
    return { data: undefined, isLoading: false, mutate: vi.fn() };
  },
}));

vi.mock("~/lib/staff-api", () => ({
  staffScheduleService: { getSchedule: vi.fn(), updateSchedule: vi.fn() },
  workTimeModelService: { list: vi.fn() },
  staffMonthSummaryService: {
    getDailyProjection: vi.fn(),
    getMonthSummary: vi.fn(),
  },
}));

vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  // Ablehnungen stehen beim Reiter (ADR 0311); hier ohne ToastProvider.
  useApiErrorDisplay: () => ({
    error: null,
    show: vi.fn(),
    clear: vi.fn(),
    showMessage: vi.fn(),
  }),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const emptySchedule: StaffSchedule = {
  mode: "custom",
  model: null,
  rotationLength: 1,
  rotationAnchorDate: "",
  entries: [],
  weeklyTotals: [0],
  validFrom: "",
};

const filledSchedule: StaffSchedule = {
  ...emptySchedule,
  entries: [{ weekIndex: 0, dayOfWeek: 0, targetMinutes: 480 }],
  weeklyTotals: [480],
  validFrom: "2026-10-01",
};

describe("ArbeitszeitmodellTab ohne Soll", () => {
  beforeEach(() => {
    mocks.hasTarget = true;
    mocks.monthKey = "";
  });

  it("zeigt statt eines leeren Modells den Leerzustand mit Folge und Weg", () => {
    mocks.schedule = emptySchedule;
    mocks.hasTarget = false;
    render(<ArbeitszeitmodellTab staffId="42" canEdit />);

    expect(screen.getByText("Kein Soll hinterlegt")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Ohne Soll zählen Krankheit, Urlaub und Fortbildung 0 Stunden\..*„Bearbeiten“/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Schnitt 0min/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bearbeiten" })).toBeVisible();
    // Der aktuelle Monat der Testuhr, ohne führende Null.
    const [year, month] = TEST_CLOCK_TODAY.split("-").map(Number);
    expect(mocks.monthKey).toBe(`staff-month-summary-42-${year}-${month}`);
  });

  it("warnt bei gepflegtem Modell, das in diesem Monat nicht gilt", () => {
    mocks.schedule = filledSchedule;
    mocks.hasTarget = false;
    render(<ArbeitszeitmodellTab staffId="42" canEdit />);

    expect(screen.getByText(/In diesem Monat gilt kein Soll\./)).toBeVisible();
    expect(screen.getByText("Eigenes Modell")).toBeInTheDocument();
  });

  it.each([true, null])(
    "unterscheidet einen leeren regulären Plan vom Sollstatus %s",
    (hasTarget) => {
      mocks.schedule = emptySchedule;
      mocks.hasTarget = hasTarget;
      render(<ArbeitszeitmodellTab staffId="42" canEdit />);

      expect(
        screen.getByText("Kein reguläres Arbeitszeitmodell"),
      ).toBeVisible();
      expect(
        screen.queryByText("Kein Soll hinterlegt"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/0 Stunden/)).not.toBeInTheDocument();
    },
  );

  it("zeigt keinen Hinweis, wenn ein Soll gilt", () => {
    mocks.schedule = filledSchedule;
    render(<ArbeitszeitmodellTab staffId="42" canEdit />);

    expect(screen.getByText("Eigenes Modell")).toBeInTheDocument();
    expect(screen.queryByText(/kein Soll/)).not.toBeInTheDocument();
  });
});

// #4706: führt ein Arbeitsvertrag des Trägers das Soll, liest die Schule es
// nur: kein „Bearbeiten“, kein Anlegen einer Sonderarbeitszeit, ein Satz,
// wer es ändert.
describe("ArbeitszeitmodellTab mit Soll vom Träger", () => {
  it("zeigt das Soll aus dem Arbeitsvertrag ohne Bearbeiten", () => {
    mocks.schedule = { ...filledSchedule, keptByTraeger: true };
    mocks.hasTarget = true;
    render(<ArbeitszeitmodellTab staffId="42" canEdit />);

    expect(screen.getByText("Soll aus dem Arbeitsvertrag")).toBeInTheDocument();
    expect(
      screen.getByText(/Das Soll führt der Träger im Arbeitsvertrag/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Bearbeiten" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Sonderarbeitszeit anlegen/ }),
    ).not.toBeInTheDocument();
  });
});
