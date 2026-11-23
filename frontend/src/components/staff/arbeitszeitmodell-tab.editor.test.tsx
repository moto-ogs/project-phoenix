import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/lib/api-error";
import type { StaffSchedule } from "~/lib/staff-api";
import { catalogText } from "~/test/error-catalog-text";
import { ArbeitszeitmodellTab } from "./arbeitszeitmodell-tab";

const mocks = vi.hoisted(() => ({
  updateSchedule: vi.fn(),
  mutateSchedule: vi.fn(),
  mutate: vi.fn(),
  toastError: vi.fn(),
  refusalShow: vi.fn(),
  templates: [] as unknown[],
}));

const schedule: StaffSchedule = {
  mode: "custom",
  model: null,
  rotationLength: 1,
  rotationAnchorDate: "2026-08-10",
  entries: [{ weekIndex: 0, dayOfWeek: 0, targetMinutes: 267 }],
  weeklyTotals: [267],
  validFrom: "2026-08-10",
  version: "schedule-v1",
};

vi.mock("~/lib/swr", () => ({
  useInvalidateMatching: () => mocks.mutate,
  useSWRAuth: (key: string | null) => {
    if (key === "staff-schedule-42") {
      return { data: schedule, isLoading: false, mutate: mocks.mutateSchedule };
    }
    // The four-week preview's daily Soll stays pending in these editor tests.
    if (key?.startsWith("staff-schedule-targets-preview-")) {
      return { data: undefined, isLoading: true, mutate: vi.fn() };
    }
    if (key === "work-time-models") {
      return { data: mocks.templates, isLoading: false, mutate: vi.fn() };
    }
    return { data: [], isLoading: false, mutate: vi.fn() };
  },
}));

vi.mock("~/lib/staff-api", () => ({
  staffScheduleService: {
    getSchedule: vi.fn(),
    updateSchedule: mocks.updateSchedule,
  },
  workTimeModelService: { list: vi.fn() },
  staffMonthSummaryService: { getDailyProjection: vi.fn() },
}));

vi.mock("~/contexts/ToastContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/contexts/ToastContext")>()),
  // Ablehnungen stehen beim Reiter (ADR 0311); hier ohne ToastProvider.
  useApiErrorDisplay: () => ({
    error: null,
    show: mocks.refusalShow,
    clear: vi.fn(),
    showMessage: vi.fn(),
  }),
  useToast: () => ({
    success: vi.fn(),
    error: mocks.toastError,
  }),
}));

vi.mock("~/components/ui/modal", () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
      </div>
    ) : null,
}));

describe("Arbeitszeitmodell decimal-hours editor", () => {
  beforeEach(() => {
    mocks.updateSchedule.mockReset();
    mocks.updateSchedule.mockResolvedValue(schedule);
    mocks.mutateSchedule.mockReset();
    mocks.mutate.mockReset();
    mocks.toastError.mockReset();
    mocks.refusalShow.mockReset();
    mocks.templates = [];
  });

  function openEditor() {
    render(<ArbeitszeitmodellTab staffId="42" canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
  }

  // Bearbeitet wird am Objekt (BAUARTEN-SPEC Bauart 2 Regeln 3 und 4, #3119):
  // „Bearbeiten“ schaltet den Reiter selbst um, es öffnet kein Slide-over.
  it("replaces the read view with the editor in place and restores it on cancel", () => {
    openEditor();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Bearbeiten" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Vorschau (nächste 4 Wochen)")).toBeNull();
    expect(screen.getByRole("radio", { name: /Eigenes Modell/ })).toBeChecked();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Dezimalstunden Montag" }),
      { target: { value: "8" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(mocks.updateSchedule).not.toHaveBeenCalled();
    expect(screen.getByText("Vorschau (nächste 4 Wochen)")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Bearbeiten" }),
    ).toBeInTheDocument();

    // Der verworfene Entwurf kommt beim nächsten Bearbeiten nicht zurück.
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    expect(
      screen.getByRole("textbox", { name: "Dezimalstunden Montag" }),
    ).toHaveValue("4,45");
  });

  it("requires a template in template mode and reports it in the alert", () => {
    openEditor();

    fireEvent.click(screen.getByRole("radio", { name: /Vorlage zuweisen/ }));
    expect(
      screen.queryByRole("textbox", { name: "Dezimalstunden Montag" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(mocks.updateSchedule).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bitte wähle eine Vorlage.",
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  // Eine archivierte Vorlage wird nicht neu zugewiesen (#6891).
  it("offers only templates the school still offers and links to the catalog", () => {
    const template = {
      rotationLength: 1,
      rotationAnchorDate: "2026-08-10",
      entries: [],
      weeklyTotals: [0],
    };
    mocks.templates = [
      { ...template, id: "1", name: "Vollzeit", archivedAt: null },
      {
        ...template,
        id: "2",
        name: "Altvertrag",
        archivedAt: "2026-09-01T08:00:00Z",
      },
    ];
    openEditor();
    fireEvent.click(screen.getByRole("radio", { name: /Vorlage zuweisen/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Vorlage" }));

    expect(screen.getByRole("option", { name: "Vollzeit" })).toBeVisible();
    expect(
      screen.queryByRole("option", { name: /Altvertrag/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Arbeitszeitmodelle verwalten/ }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/database/work-time-models"),
    );
  });

  it("returns to the read view after a successful save", async () => {
    openEditor();

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(mocks.updateSchedule).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("button", { name: "Bearbeiten" }),
    ).toBeInTheDocument();
    expect(mocks.mutateSchedule).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });

  it("keeps the editor open and offers a retry when saving fails", async () => {
    mocks.updateSchedule.mockRejectedValueOnce(
      new ApiError("boom", 500, { code: "general.server", instance: "req-az" }),
    );
    openEditor();

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText("general.server", "das Arbeitszeitmodell"),
      ),
    ).toBeInTheDocument();
    expect(mocks.toastError).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(mocks.updateSchedule).toHaveBeenCalledTimes(2));
  });

  it("loads existing minutes as decimal hours and updates totals while typing", () => {
    openEditor();

    const input = screen.getByRole("textbox", {
      name: "Dezimalstunden Montag",
    });
    expect(input).toHaveValue("4,45");

    fireEvent.change(input, { target: { value: "0,33" } });

    expect(input).toHaveValue("0,33");
    expect(screen.getByText("20min (20 min)")).toBeInTheDocument();
    expect(
      screen.getByText("Wochensoll Woche A").nextSibling,
    ).toHaveTextContent("20min");
  });

  it("accepts decimal points and sends only integer target minutes", async () => {
    openEditor();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Dezimalstunden Montag" }),
      { target: { value: "4.45" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(mocks.updateSchedule).toHaveBeenCalledWith(
        "42",
        {
          mode: "custom",
          rotationLength: 1,
          entries: [{ weekIndex: 0, dayOfWeek: 0, targetMinutes: 267 }],
        },
        "schedule-v1",
      ),
    );
  });

  it("treats an empty field as a zero-hour day", () => {
    openEditor();

    const input = screen.getByRole("textbox", {
      name: "Dezimalstunden Montag",
    });
    fireEvent.change(input, { target: { value: "" } });

    expect(input).toHaveAccessibleDescription("0min (0 min)");
    expect(
      screen.getByText("Wochensoll Woche A").nextSibling,
    ).toHaveTextContent("0min");
  });

  it("keeps invalid input visible, exposes its error, and blocks saving", () => {
    openEditor();

    const input = screen.getByRole("textbox", {
      name: "Dezimalstunden Montag",
    });
    fireEvent.change(input, { target: { value: "12,01" } });

    expect(input).toHaveValue("12,01");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bitte 0 bis 12 eingeben.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(mocks.updateSchedule).not.toHaveBeenCalled();
    // The form error stands in the alert at the top of the panel body, not in
    // a toast (BAUARTEN-SPEC Bauart 2 Regel 5); the field keeps its own alert.
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toContain("Bitte korrigiere die markierten Stunden.");
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("clears removed rotation weeks from both visible and saved state", async () => {
    openEditor();

    fireEvent.click(screen.getByRole("combobox", { name: "Rotation" }));
    fireEvent.click(screen.getByText("A/B-Wochen (2 Wochen)"));
    fireEvent.click(screen.getByRole("button", { name: "Woche B" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Dezimalstunden Montag" }),
      { target: { value: "4,45" } },
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Rotation" }));
    fireEvent.click(screen.getByText("Standard (1 Woche)"));
    fireEvent.click(screen.getByRole("combobox", { name: "Rotation" }));
    fireEvent.click(screen.getByText("A/B-Wochen (2 Wochen)"));
    fireEvent.click(screen.getByRole("button", { name: "Woche B" }));

    expect(
      screen.getByRole("textbox", { name: "Dezimalstunden Montag" }),
    ).toHaveValue("");

    fireEvent.change(
      screen.getByRole("textbox", { name: "Dezimalstunden Dienstag" }),
      { target: { value: "1" } },
    );
    expect(
      screen.getByText("5h 27min gesamt · Ø 2h 44min / Woche"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mocks.updateSchedule).toHaveBeenCalledWith(
        "42",
        {
          mode: "custom",
          rotationLength: 2,
          entries: [
            { weekIndex: 0, dayOfWeek: 0, targetMinutes: 267 },
            { weekIndex: 1, dayOfWeek: 1, targetMinutes: 60 },
          ],
        },
        "schedule-v1",
      ),
    );
  });

  it("closes the editor and reads the stored model when it changed since opening", async () => {
    // ADR 0311: Speichern sendet den Stand beim Öffnen. Hat jemand das
    // Modell inzwischen geändert, schließt der Editor und der Reiter meldet
    // es mit dem Neuladen, ohne „Wiederholen“.
    const refusal = new ApiError("changed", 409, {
      code: "general.changed_since_read",
    });
    mocks.updateSchedule.mockRejectedValue(refusal);
    openEditor();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Dezimalstunden Montag" }),
      { target: { value: "5" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(mocks.refusalShow).toHaveBeenCalledWith(
        refusal,
        expect.objectContaining({
          object: "das Arbeitszeitmodell",
          reload: expect.any(Function),
        }),
      ),
    );
    expect(mocks.updateSchedule).toHaveBeenCalledWith(
      "42",
      expect.anything(),
      "schedule-v1",
    );
    expect(
      screen.queryByRole("button", { name: "Speichern" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Bearbeiten" }),
    ).toBeInTheDocument();
  });
});
