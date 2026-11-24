import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormErrorAlert } from "~/components/ui/form-error-alert";
import type { FormErrorInput } from "~/components/ui/form-error";
import { ApiError, unavailableApiError } from "~/lib/api-error";
import type { ClosingDay } from "~/lib/closing-day-helpers";
import { catalogText } from "~/test/error-catalog-text";

// The factory is hoisted above the imports, so the mock helper has to be
// pulled in inside it rather than at the top of the file.
vi.mock("~/components/ui/date-picker", async () =>
  (await import("~/test/mocks/date-picker")).datePickerModuleMock(),
);

const { mockCreate, mockUpdate, mockBulkCancel } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockBulkCancel: vi.fn(),
}));

vi.mock("~/lib/timetable-api", () => ({
  timetableService: { bulkCancel: mockBulkCancel },
}));

vi.mock("~/lib/closing-day-api", () => ({
  closingDayService: {
    create: mockCreate,
    update: mockUpdate,
  },
}));

vi.mock("~/lib/logger", () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock("~/components/ui/form-modal", () => ({
  // Wie der echte FormModal: der Fehler steht oben im Bearbeitungsbereich.
  FormModal: ({
    isOpen,
    children,
    footer,
    error,
  }: {
    isOpen: boolean;
    children: ReactNode;
    footer?: ReactNode;
    error?: FormErrorInput;
  }) =>
    isOpen ? (
      <div>
        <FormErrorAlert message={error} />
        {children}
        {footer}
      </div>
    ) : null,
}));

import { ClosingDayModal } from "./closing-day-modal";

const existingClosingDay: ClosingDay = {
  id: "7",
  startDate: "2026-12-24",
  endDate: "2026-12-31",
  reason: "Weihnachtswoche",
  version: "v1",
};

function renderModal(initial: ClosingDay | null = null) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <ClosingDayModal
      isOpen
      onClose={onClose}
      onSaved={onSaved}
      initial={initial}
    />,
  );
  return { onClose, onSaved };
}

describe("ClosingDayModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(existingClosingDay);
    mockUpdate.mockResolvedValue(existingClosingDay);
  });

  it("creates a closing day with a trimmed reason", async () => {
    const { onClose, onSaved } = renderModal();

    fireEvent.change(screen.getByLabelText("Grund"), {
      target: { value: "  Pädagogischer Tag  " },
    });
    fireEvent.change(screen.getByLabelText("Von"), {
      target: { value: "2026-09-14" },
    });
    fireEvent.change(screen.getByLabelText("Bis"), {
      target: { value: "2026-09-14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        start_date: "2026-09-14",
        end_date: "2026-09-14",
        reason: "Pädagogischer Tag",
      }),
    );
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  // #3594: appointments planned before the closure was entered stay in the
  // plan, so saving offers to cancel them, and only when there are some.
  it("offers to cancel the appointments still planned in the saved range", async () => {
    mockBulkCancel.mockResolvedValue({
      from: "2026-10-12",
      to: "2026-10-25",
      dryRun: true,
      count: 83,
      days: [],
    });
    const onOfferCancel = vi.fn();
    render(
      <ClosingDayModal
        isOpen
        onClose={vi.fn()}
        onSaved={vi.fn()}
        initial={null}
        onOfferCancel={onOfferCancel}
      />,
    );

    fireEvent.change(screen.getByLabelText("Grund"), {
      target: { value: "Herbstferien" },
    });
    fireEvent.change(screen.getByLabelText("Von"), {
      target: { value: "2026-10-12" },
    });
    fireEvent.change(screen.getByLabelText("Bis"), {
      target: { value: "2026-10-25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(onOfferCancel).toHaveBeenCalledWith({
        startDate: "2026-10-12",
        endDate: "2026-10-25",
      }),
    );
    expect(mockBulkCancel).toHaveBeenCalledWith(
      "2026-10-12",
      "2026-10-25",
      true,
    );
  });

  it("offers nothing when no appointment is left or cancelling is not allowed", async () => {
    const onOfferCancel = vi.fn();
    const { rerender } = render(
      <ClosingDayModal
        isOpen
        onClose={vi.fn()}
        onSaved={vi.fn()}
        initial={existingClosingDay}
        onOfferCancel={onOfferCancel}
      />,
    );

    mockBulkCancel.mockResolvedValueOnce({
      from: "2026-12-24",
      to: "2026-12-31",
      dryRun: true,
      count: 0,
      days: [],
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(mockBulkCancel).toHaveBeenCalledOnce());

    mockBulkCancel.mockRejectedValueOnce(
      new ApiError("Forbidden", 403, { code: "general.permission" }),
    );
    rerender(
      <ClosingDayModal
        isOpen
        onClose={vi.fn()}
        onSaved={vi.fn()}
        initial={existingClosingDay}
        onOfferCancel={onOfferCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(mockBulkCancel).toHaveBeenCalledTimes(2));

    expect(onOfferCancel).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("still offers the cancel dialog when counting fails for another reason", async () => {
    const onOfferCancel = vi.fn();
    render(
      <ClosingDayModal
        isOpen
        onClose={vi.fn()}
        onSaved={vi.fn()}
        initial={existingClosingDay}
        onOfferCancel={onOfferCancel}
      />,
    );
    mockBulkCancel.mockRejectedValueOnce(
      unavailableApiError(new TypeError("Failed to fetch")),
    );

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(onOfferCancel).toHaveBeenCalledWith({
        startDate: existingClosingDay.startDate,
        endDate: existingClosingDay.endDate,
      }),
    );
  });

  it("updates the selected closing day", async () => {
    const { onClose, onSaved } = renderModal(existingClosingDay);

    fireEvent.change(screen.getByLabelText("Grund"), {
      target: { value: "Weihnachtsferien" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith("7", {
        start_date: "2026-12-24",
        end_date: "2026-12-31",
        reason: "Weihnachtsferien",
        expected_version: "v1",
      }),
    );
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("rejects a whitespace-only reason before calling the API", async () => {
    renderModal();

    fireEvent.change(screen.getByLabelText("Grund"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText("Von"), {
      target: { value: "2026-09-14" },
    });
    fireEvent.change(screen.getByLabelText("Bis"), {
      target: { value: "2026-09-14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText("Bitte prüfe die markierten Felder."),
    ).toBeInTheDocument();
    // Der Hinweis steht am Feld, das Feld ist markiert.
    expect(screen.getByLabelText("Grund")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText("Bitte gib einen Grund an.")).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("marks an end before the start at the end field", async () => {
    renderModal();

    fireEvent.change(screen.getByLabelText("Grund"), {
      target: { value: "Brückentag" },
    });
    fireEvent.change(screen.getByLabelText("Von"), {
      target: { value: "2026-09-14" },
    });
    fireEvent.change(screen.getByLabelText("Bis"), {
      target: { value: "2026-09-10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        "Der letzte Tag darf nicht vor dem ersten liegen.",
      ),
    ).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // #2516: Katalogtext statt Serversatz, Wiederholen mit dem aktuellen Stand.
  it("keeps a failed save in the dialog and retries with the current reason", async () => {
    mockUpdate
      .mockRejectedValueOnce(
        new ApiError("closing day kaputt", 500, { code: "general.server" }),
      )
      .mockResolvedValueOnce(existingClosingDay);
    const { onClose, onSaved } = renderModal(existingClosingDay);

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText("general.server", "das Speichern des Schließtags"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/closing day kaputt/)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Grund"), {
      target: { value: "Weihnachtsferien" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenLastCalledWith("7", {
        start_date: "2026-12-24",
        end_date: "2026-12-31",
        reason: "Weihnachtsferien",
        expected_version: "v1",
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSaved).toHaveBeenCalledOnce();
  });

  // ADR 0311: hat jemand den Schließtag seit dem Öffnen geändert, zeigt der
  // Dialog dessen gespeicherten Stand, bietet kein Wiederholen an und
  // speichert danach mit dem neuen Stand.
  it("shows the stored closing day after a save refused as changed since read", async () => {
    mockUpdate
      .mockRejectedValueOnce(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      )
      .mockResolvedValueOnce(existingClosingDay);
    const stored = {
      ...existingClosingDay,
      reason: "Betriebsferien",
      version: "v2",
    };
    const reload = vi.fn(() => Promise.resolve(stored));
    render(
      <ClosingDayModal
        isOpen
        onClose={vi.fn()}
        onSaved={vi.fn()}
        reload={reload}
        initial={existingClosingDay}
      />,
    );

    fireEvent.change(screen.getByLabelText("Grund"), {
      target: { value: "Weihnachtsferien" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText(
          "general.changed_since_read",
          "das Speichern des Schließtags",
        ),
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Grund")).toHaveValue("Betriebsferien"),
    );
    expect(
      screen.queryByRole("button", { name: "Wiederholen" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenLastCalledWith(
        "7",
        expect.objectContaining({
          reason: "Betriebsferien",
          expected_version: "v2",
        }),
      ),
    );
  });

  // ADR 0311 rule 6: a failed read of the stored closing day after a
  // refusal is a load error, and the refused version is not sent again.
  it("names a failed read of the stored closing day after a refusal", async () => {
    mockUpdate.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    render(
      <ClosingDayModal
        isOpen
        onClose={vi.fn()}
        onSaved={vi.fn()}
        reload={() =>
          Promise.reject(
            new ApiError("down", 503, { code: "general.unavailable" }),
          )
        }
        initial={existingClosingDay}
      />,
    );
    fireEvent.change(screen.getByLabelText("Grund"), {
      target: { value: "Weihnachtsferien" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(/Der neue Stand konnte nicht geladen werden/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Du siehst jetzt den neuen Stand/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("marks the field the server names", async () => {
    mockCreate.mockRejectedValueOnce(
      new ApiError("invalid", 400, {
        code: "general.input",
        errors: [{ field: "reason", reason: "too long" }],
      }),
    );
    renderModal();

    fireEvent.change(screen.getByLabelText("Grund"), {
      target: { value: "Pädagogischer Tag" },
    });
    fireEvent.change(screen.getByLabelText("Von"), {
      target: { value: "2026-09-14" },
    });
    fireEvent.change(screen.getByLabelText("Bis"), {
      target: { value: "2026-09-14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      await screen.findByText(
        catalogText("general.input", "das Speichern des Schließtags"),
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Grund")).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(screen.queryByText(/too long/)).not.toBeInTheDocument();
  });
  it("keeps a draft across school and record revalidation, then resets on reopening", async () => {
    const schools = [
      { id: "1", name: "OGS Nord" },
      { id: "2", name: "OGS Süd" },
    ];
    const initial = { ...existingClosingDay, schoolIds: ["1", "2"] };
    const onSave = vi.fn().mockResolvedValue(undefined);
    const props = {
      isOpen: true,
      onClose: vi.fn(),
      onSaved: vi.fn(),
      initial,
      schools,
      onSave,
    };
    const { rerender } = render(<ClosingDayModal {...props} />);
    fireEvent.change(screen.getByLabelText("Grund"), {
      target: { value: "Entwurf" },
    });
    fireEvent.change(screen.getByLabelText("Von"), {
      target: { value: "2026-12-25" },
    });
    fireEvent.change(screen.getByLabelText("Bis"), {
      target: { value: "2026-12-30" },
    });
    fireEvent.click(screen.getAllByRole("checkbox")[2]!);
    rerender(
      <ClosingDayModal
        {...props}
        initial={{ ...initial }}
        schools={schools.map((school) => ({ ...school }))}
      />,
    );
    expect(screen.getByLabelText("Grund")).toHaveValue("Entwurf");
    expect(screen.getByLabelText("Von")).toHaveValue("2026-12-25");
    expect(screen.getByLabelText("Bis")).toHaveValue("2026-12-30");
    expect(screen.getAllByRole("checkbox")[2]).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        reason: "Entwurf",
        startDate: "2026-12-25",
        endDate: "2026-12-30",
        schoolIds: ["1"],
        // Der Stand, aus dem das Formular stammt (ADR 0311).
        expectedVersion: "v1",
      }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    rerender(<ClosingDayModal {...props} isOpen={false} />);
    rerender(<ClosingDayModal {...props} />);
    expect(screen.getByLabelText("Grund")).toHaveValue(initial.reason);
    expect(screen.getAllByRole("checkbox")[2]).toBeChecked();
  });
});
