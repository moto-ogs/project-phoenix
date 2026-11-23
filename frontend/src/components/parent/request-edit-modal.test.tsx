import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ApiError } from "~/lib/api-error";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { catalogText } from "~/test/error-catalog-text";
import {
  listParentRequestEvents,
  updateExcusedRequest,
  updateMasterDataRequest,
} from "~/lib/parent-api";
import { RequestEditModal } from "./request-edit-modal";
import { ParentResourceTestProvider } from "~/test/parent-resource-provider";

vi.unmock("swr");

function renderParent(ui: Parameters<typeof render>[0]) {
  return render(ui, { wrapper: ParentResourceTestProvider });
}

vi.mock("~/lib/parent-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/parent-api")>();
  return {
    ...actual,
    listParentRequestEvents: vi.fn(),
    updateExcusedRequest: vi.fn(),
    updatePickupChangeRequest: vi.fn(),
    updateMasterDataRequest: vi.fn(),
  };
});

vi.mock("~/components/ui/date-picker", async () =>
  (await import("~/test/mocks/date-picker")).datePickerModuleMock(),
);

const events = vi.mocked(listParentRequestEvents);
const updateExcused = vi.mocked(updateExcusedRequest);
const updateMasterData = vi.mocked(updateMasterDataRequest);

describe("RequestEditModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events.mockResolvedValue([
      {
        event_type: "submitted",
        version: "v1",
        created_at: "2026-08-20T08:00:00Z",
      },
      {
        event_type: "guardian_edited",
        version: "v2",
        created_at: "2026-08-24T09:30:00Z",
      },
    ]);
    updateExcused.mockResolvedValue({
      version: "row-2",
      id: "req-1",
      student_id: "1",
      absence_status: "excused",
      status: "pending",
      dates: ["2026-09-01"],
      note: "Zahnarzt",
      created_at: "2026-08-20T08:00:00Z",
      is_self: true,
    });
  });

  // Eine offene Anfrage wird geändert, nicht zurückgezogen (#2267).
  it("offers editing and never a withdrawal", async () => {
    renderParent(
      <RequestEditModal
        studentId="1"
        request={{
          type: "excused",
          id: "req-1",
          version: "row-1",
          dates: ["2026-09-01"],
          note: "Zahnarzt",
        }}
        onClose={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Änderung speichern" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/zurückziehen/i)).not.toBeInTheDocument();
    expect(
      await screen.findByText("Geändert am 24.08.2026"),
    ).toBeInTheDocument();
  });

  // ADR 0311: the version comes from the list row the values came from, not
  // from the separate history read.
  it("sends the version of the row its values came from", async () => {
    const onReload = vi.fn();
    const onClose = vi.fn();
    renderParent(
      <RequestEditModal
        studentId="1"
        request={{
          type: "excused",
          id: "req-1",
          version: "row-1",
          dates: ["2026-09-01"],
          note: "Zahnarzt",
        }}
        onClose={onClose}
        onReload={onReload}
      />,
    );

    await screen.findByText("Geändert am 24.08.2026");
    fireEvent.change(document.querySelector("textarea")!, {
      target: { value: "Doch Kinderarzt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Änderung speichern" }));

    await waitFor(() =>
      expect(updateExcused).toHaveBeenCalledWith("1", "req-1", {
        dates: ["2026-09-01"],
        note: "Doch Kinderarzt",
        expectedVersion: "row-1",
      }),
    );
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("changes a Stammdaten request through the same dialog", async () => {
    updateMasterData.mockResolvedValue({
      version: "row-2",
      is_self: false,
      id: "md-1",
      target: "person",
      field_key: "first_name",
      new_value: "Lea",
      status: "pending",
      created_at: "2026-08-20T08:00:00Z",
    });
    renderParent(
      <RequestEditModal
        studentId="1"
        request={{
          type: "master_data",
          id: "md-1",
          version: "row-1",
          label: "Vorname",
          value: "Lena",
        }}
        onClose={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    await screen.findByText("Geändert am 24.08.2026");
    fireEvent.change(screen.getByLabelText("Vorname"), {
      target: { value: "Lea" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Änderung speichern" }));

    await waitFor(() =>
      expect(updateMasterData).toHaveBeenCalledWith("1", "md-1", {
        newValue: "Lea",
        expectedVersion: "row-1",
      }),
    );
  });

  // Die Änderungsgeschichte ist nur eine Anzeige: ohne sie bleibt das
  // Bearbeiten mit der Fassung der Listenzeile möglich.
  it("still saves when the history cannot be loaded", async () => {
    events.mockRejectedValue(new Error("offline"));
    renderParent(
      <RequestEditModal
        studentId="1"
        request={{
          type: "excused",
          id: "req-1",
          version: "row-1",
          dates: ["2026-09-01"],
          note: "Zahnarzt",
        }}
        onClose={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Geändert am/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Änderung speichern" }));

    await waitFor(() =>
      expect(updateExcused).toHaveBeenCalledWith(
        "1",
        "req-1",
        expect.objectContaining({ expectedVersion: "row-1" }),
      ),
    );
  });

  // ADR 0311: a request stored differently since the list was read is
  // refused. The dialog shows the catalog text without a retry (the same
  // version would be refused again), reloads the list and then shows the
  // stored values of the new version.
  it("reloads a request changed since it was read and shows its stored values", async () => {
    const onClose = vi.fn();
    const onReload = vi.fn();
    updateMasterData.mockRejectedValue(
      new ApiError("changed since it was read", 409, {
        code: "general.changed_since_read",
      }),
    );
    const request = {
      type: "master_data" as const,
      id: "md-1",
      version: "row-1",
      label: "Vorname",
      value: "Lena",
    };
    const view = renderParent(
      <RequestEditModal
        studentId="1"
        request={request}
        onClose={onClose}
        onReload={onReload}
      />,
    );

    await screen.findByText("Geändert am 24.08.2026");
    fireEvent.change(screen.getByLabelText("Vorname"), {
      target: { value: "Lea" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Änderung speichern" }));

    const dialog = screen.getByRole("dialog");
    expect(
      await within(dialog).findByText(
        catalogText("general.changed_since_read", "die Anfrage"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/since it was read/)).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Erneut versuchen" }),
    ).not.toBeInTheDocument();
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    // The reloaded list brings the stored request with its new version.
    view.rerender(
      <RequestEditModal
        studentId="1"
        request={{ ...request, version: "row-2", value: "Lina" }}
        onClose={onClose}
        onReload={onReload}
      />,
    );
    expect(screen.getByLabelText("Vorname")).toHaveValue("Lina");
  });

  it("checks an empty value before sending and marks the field", async () => {
    renderParent(
      <RequestEditModal
        studentId="1"
        request={{
          type: "master_data",
          id: "md-1",
          version: "row-1",
          label: "Vorname",
          value: "Lena",
        }}
        onClose={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Vorname");
    fireEvent.change(input, { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Änderung speichern" }));

    expect(
      await screen.findByText("Bitte trage einen Wert ein."),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(updateMasterData).not.toHaveBeenCalled();
  });
});
