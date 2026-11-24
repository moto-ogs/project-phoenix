/**
 * Tests for ActivityManagementModal Component
 * Tests the rendering, update functionality, and the shared error path
 */
import {
  render as rtlRender,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { SessionProvider } from "next-auth/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ActivityManagementModal } from "./activity-management-modal";
import {
  deleteActivity,
  fetchActivity,
  updateActivity,
} from "~/lib/activity-api";
import { SWRConfig } from "~/lib/swr/testing";
import type { Activity } from "~/lib/activity-api";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";

// =============================================================================
// Component Tests for ActivityManagementModal
// =============================================================================

// Mock all dependencies
// Plätze und Warteliste haben eigene Tests; das Formular hier braucht sie nicht.
vi.mock("./activity-waitlist-section", () => ({
  ActivityWaitlistSection: () => null,
}));

vi.mock("~/lib/activity-api", () => ({
  fetchActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));
vi.unmock("swr");

// Real SWR with a fresh cache and a signed-in OGS session per render: the
// dialog reads the activity it saves (ADR 0311), `fetchActivity` answers
// with the stored state of the row and its version.
function render(...[ui, options]: Parameters<typeof rtlRender>) {
  return rtlRender(ui, {
    ...options,
    wrapper: ({ children }: Readonly<{ children: ReactNode }>) => (
      <SessionProvider
        session={{ user: { id: "1", scope: "tenant" }, expires: "2099-01-01" }}
        refetchOnWindowFocus={false}
      >
        <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
          {children}
        </SWRConfig>
      </SessionProvider>
    ),
  });
}

// The real hook returns a stable setForm (useState); the modal's reset effect
// depends on it.
const { mockSetForm } = vi.hoisted(() => ({ mockSetForm: vi.fn() }));

vi.mock("~/hooks/useActivityForm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/hooks/useActivityForm")>()),
  useActivityForm: vi.fn(() => ({
    form: {
      name: "Test Activity",
      category_id: "1",
      max_participants: "15",
    },
    setForm: mockSetForm,
    categories: [
      { id: "1", name: "Category 1" },
      { id: "2", name: "Category 2" },
    ],
    loading: false,
    loadError: null,
    handleInputChange: vi.fn(),
    validateForm: vi.fn(() => null),
  })),
}));

vi.mock("~/components/ui/form-modal", () => ({
  FormModal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: ReactNode;
    footer?: ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="form-modal">
        <h2>{title}</h2>
        {children}
        {footer && <div>{footer}</div>}
      </div>
    ) : null,
}));

vi.mock("~/components/ui/alert", () => ({
  Alert: ({ type, message }: { type: string; message: string }) => (
    <div role="alert" data-type={type}>
      {message}
    </div>
  ),
}));

type MockButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: string;
  readonly size?: string;
};

vi.mock("~/components/ui/button", () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: MockButtonProps) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("~/components/ui/icons", () => ({
  SpinnerIcon: () => (
    <span data-testid="button-spinner" aria-label="Wird geladen" />
  ),
}));

const mockActivity: Activity = {
  id: "1",
  name: "Test Activity",
  ag_category_id: "1",
  max_participant: 15,
  is_open_ags: true,
  supervisor_id: "1",
  created_at: new Date(),
  updated_at: new Date(),
  supervisors: [
    {
      id: "1",
      staff_id: "1",
      is_primary: true,
      full_name: "John Doe",
    },
  ],
};
const storedActivity: Activity = { ...mockActivity, version: "v1" };

describe("ActivityManagementModal", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchActivity).mockResolvedValue(storedActivity);
  });

  /** Saving waits for the read of the stored activity (ADR 0311). */
  async function submitOnceRead() {
    const save = screen.getByRole("button", { name: "Speichern" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.submit(screen.getByLabelText(/Aktivitätsname/).closest("form")!);
  }

  it("renders modal when open", () => {
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
      />,
    );

    expect(screen.getByTestId("form-modal")).toBeInTheDocument();
  });

  it("displays activity name in header", async () => {
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Aktivität: Test Activity/)).toBeInTheDocument();
    });
  });

  it("displays creator information", async () => {
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Erstellt von:/)).toBeInTheDocument();
      // Text content includes whitespace, use a more flexible matcher
      expect(screen.getByText(/John Doe/)).toBeInTheDocument();
    });
  });

  it("renders form fields", async () => {
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
      />,
    );

    await waitFor(() => {
      // Labels contain additional nested elements, so use regex for partial matching
      expect(screen.getByLabelText(/Aktivitätsname/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Kategorie/)).toBeInTheDocument();
      expect(
        screen.getByLabelText(/Maximale Teilnehmerzahl/),
      ).toBeInTheDocument();
    });
  });

  it("does not cap the participant limit at 50", () => {
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
      />,
    );

    expect(
      screen.getByLabelText(/Maximale Teilnehmerzahl/),
    ).not.toHaveAttribute("max");
  });

  it("offers an explicit unlimited option", () => {
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: "Keine Begrenzung" }),
    ).toBeInTheDocument();
  });

  it("renders action buttons when not read-only", async () => {
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
        readOnly={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Speichern")).toBeInTheDocument();
      expect(screen.getByText("Abbrechen")).toBeInTheDocument();
    });
  });

  it("hides save button when read-only", async () => {
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
        readOnly={true}
      />,
    );

    // Anker: die Fußzeile, in der „Speichern“ neben „Abbrechen“ stünde, ist da.
    expect(await screen.findByText("Abbrechen")).toBeInTheDocument();
    expect(screen.queryByText("Speichern")).not.toBeInTheDocument();
  });

  it("renders delete button when not read-only", async () => {
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
        readOnly={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Aktivität löschen")).toBeInTheDocument();
    });
  });

  it("renders categories in dropdown", async () => {
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
      />,
    );

    const select = await screen.findByRole("combobox");
    fireEvent.click(select);

    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: "Category 1" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Category 2" }),
      ).toBeInTheDocument();
    });
  });

  it("does not clip the open category menu with an overflow-hidden ancestor", async () => {
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
      />,
    );

    const select = await screen.findByRole("combobox");
    fireEvent.click(select);

    const listbox = await screen.findByRole("listbox");
    for (
      let node = listbox.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      expect(node.className).not.toMatch(/(?:^|\s)overflow-hidden(?:\s|$)/);
    }
  });

  it("disables inputs when read-only", () => {
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
        readOnly={true}
      />,
    );

    const nameInput = screen.getByLabelText(/Aktivitätsname/);
    expect(nameInput).toBeDisabled();
  });

  it("renders info message for read-only mode", async () => {
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
        readOnly={true}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Du kannst nur Aktivitäten bearbeiten/),
      ).toBeInTheDocument();
    });
  });

  it("shows the catalog text of a failed save in the form", async () => {
    vi.mocked(updateActivity).mockRejectedValueOnce(
      new ApiError("boom", 500, { code: "general.server" }),
    );
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
      />,
    );

    await submitOnceRead();

    expect(
      await screen.findByText(catalogText("general.server", "die Aktivität")),
    ).toBeInTheDocument();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  // ADR 0311: the save names only what the dialog shows, so the route keeps
  // the opening, the room, the schedules and the supervisors, and it carries
  // the version the dialog read.
  it("saves the shown fields against the version it read", async () => {
    vi.mocked(updateActivity).mockResolvedValueOnce(storedActivity);
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
      />,
    );

    await submitOnceRead();

    await waitFor(() =>
      expect(updateActivity).toHaveBeenCalledWith("1", {
        name: "Test Activity",
        category_id: "1",
        max_participants: 15,
        expected_version: "v1",
      }),
    );
  });

  it("reads the stored state after a refusal and offers no retry", async () => {
    vi.mocked(updateActivity).mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
      />,
    );

    await submitOnceRead();

    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Aktivität"),
      ),
    ).toBeInTheDocument();
    expect(fetchActivity).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("button", { name: "Wiederholen" }),
    ).not.toBeInTheDocument();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("names a failed read after a refusal and saves nothing until it is read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(updateActivity).mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    vi.mocked(fetchActivity)
      .mockResolvedValueOnce(storedActivity)
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      );
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
      />,
    );

    await submitOnceRead();

    // „Du siehst jetzt den neuen Stand“ would be false: the failed read is
    // named, and the save stays locked until a read succeeds.
    expect(
      await screen.findByText(/Der neue Stand konnte nicht geladen werden\./),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Du siehst jetzt den neuen Stand/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText(/Aktivitätsname/).closest("form")!);
    expect(updateActivity).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed delete in the open delete dialog", async () => {
    vi.mocked(deleteActivity).mockRejectedValueOnce(
      new ApiError("nope", 403, { code: "general.permission" }),
    );
    render(
      <ActivityManagementModal
        isOpen={true}
        onClose={mockOnClose}
        activity={mockActivity}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Aktivität löschen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ja, löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));

    expect(
      await screen.findByText(
        catalogText("general.permission", "die Aktivität"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Endgültig löschen" }),
    ).toBeInTheDocument();
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});
