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
          dates: ["2026-09-01"],
          note: "Zahnarzt",
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
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

  it("sends the changed request with the version it was loaded at", async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderParent(
      <RequestEditModal
        studentId="1"
        request={{
          type: "excused",
          id: "req-1",
          dates: ["2026-09-01"],
          note: "Zahnarzt",
        }}
        onClose={onClose}
        onSaved={onSaved}
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
        expectedVersion: "v2",
      }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reads the version anew when the dialog opens again", async () => {
    const request = {
      type: "excused" as const,
      id: "req-1",
      dates: ["2026-09-01"],
      note: "Zahnarzt",
    };
    function Dialog({ open }: Readonly<{ open: boolean }>) {
      return (
        <ParentResourceTestProvider>
          {open ? (
            <RequestEditModal
              studentId="1"
              request={request}
              onClose={vi.fn()}
              onSaved={vi.fn()}
            />
          ) : null}
        </ParentResourceTestProvider>
      );
    }
    const view = render(<Dialog open />);
    await screen.findByText("Geändert am 24.08.2026");
    view.rerender(<Dialog open={false} />);
    // Another guardian edited the request meanwhile.
    events.mockResolvedValue([
      {
        event_type: "guardian_edited",
        version: "v3",
        created_at: "2026-08-25T10:00:00Z",
      },
    ]);
    view.rerender(<Dialog open />);

    await screen.findByText("Geändert am 25.08.2026");
    fireEvent.click(screen.getByRole("button", { name: "Änderung speichern" }));
    await waitFor(() =>
      expect(updateExcused).toHaveBeenCalledWith("1", "req-1", {
        dates: ["2026-09-01"],
        note: "Zahnarzt",
        expectedVersion: "v3",
      }),
    );
  });

  it("changes a Stammdaten request through the same dialog", async () => {
    updateMasterData.mockResolvedValue({
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
          label: "Vorname",
          value: "Lena",
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
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
        expectedVersion: "v2",
      }),
    );
  });

  // Ohne Änderungsgeschichte bleibt das Bearbeiten möglich; die Fassung geht
  // dann leer raus, das Backend prüft sie nicht.
  it("still saves when the history cannot be loaded", async () => {
    events.mockRejectedValue(new Error("offline"));
    renderParent(
      <RequestEditModal
        studentId="1"
        request={{
          type: "excused",
          id: "req-1",
          dates: ["2026-09-01"],
          note: "Zahnarzt",
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Geändert am/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Änderung speichern" }));

    await waitFor(() =>
      expect(updateExcused).toHaveBeenCalledWith(
        "1",
        "req-1",
        expect.objectContaining({ expectedVersion: "" }),
      ),
    );
  });

  // #2518: a stale version comes back as a code; the dialog shows its catalog
  // text and never the backend sentence.
  it("shows a failed save inside the dialog from the shared catalog", async () => {
    const onClose = vi.fn();
    updateMasterData.mockRejectedValue(
      new ApiError("request was changed by someone else", 409, {
        code: "students.change_request_stale",
      }),
    );
    renderParent(
      <RequestEditModal
        studentId="1"
        request={{
          type: "master_data",
          id: "md-1",
          label: "Vorname",
          value: "Lena",
        }}
        onClose={onClose}
        onSaved={vi.fn()}
      />,
    );

    await screen.findByText("Geändert am 24.08.2026");
    fireEvent.click(screen.getByRole("button", { name: "Änderung speichern" }));

    const dialog = screen.getByRole("dialog");
    expect(
      await within(dialog).findByText(
        catalogText("students.change_request_stale", "die Anfrage"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/someone else/)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("checks an empty value before sending and marks the field", async () => {
    renderParent(
      <RequestEditModal
        studentId="1"
        request={{
          type: "master_data",
          id: "md-1",
          label: "Vorname",
          value: "Lena",
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
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
