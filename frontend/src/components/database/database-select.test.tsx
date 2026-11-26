import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render as renderPlain,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { SessionProvider } from "next-auth/react";
import type { ReactElement, ReactNode } from "react";
import { DatabaseSelect, GroupSelect } from "./database-select";
import { useApiLoadError } from "~/contexts/ToastContext";
import { catalogText } from "~/test/error-catalog-text";
import { SWRConfig } from "~/lib/swr/testing";
import { pagedJson } from "~/test/mocks/plain-session-fetch";

// GroupSelect reads its options through the shared cache; each render gets
// its own.
vi.unmock("swr");
vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider
      session={{ user: { id: "1" }, expires: "2099-01-01" }}
      refetchOnWindowFocus={false}
    >
      <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
        {children}
      </SWRConfig>
    </SessionProvider>
  );
}

function render(ui: ReactElement) {
  return renderPlain(ui, { wrapper: Providers });
}

function GroupSelectOwner() {
  const { error, show, clear } = useApiLoadError();
  return (
    <GroupSelect
      name="group_id"
      value=""
      onChange={() => undefined}
      loadError={error}
      onLoadError={(loadError, retry) =>
        void show(loadError, {
          object: "die Liste der Gruppen",
          retry: () => {
            clear();
            retry();
          },
        })
      }
    />
  );
}

// The select renders as the kit listbox (CustomSelect): a combobox trigger
// button plus an option list that only exists while the menu is open.
function openMenu() {
  fireEvent.click(screen.getByRole("combobox"));
}

// =============================================================================
// DatabaseSelect Tests
// =============================================================================

describe("DatabaseSelect", () => {
  const defaultProps = {
    name: "test-select",
    value: "",
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Rendering", () => {
    it("renders a select element", () => {
      render(<DatabaseSelect {...defaultProps} />);
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    it("renders with correct name attribute", () => {
      const { container } = render(<DatabaseSelect {...defaultProps} />);
      expect(
        container.querySelector('input[name="test-select"]'),
      ).toBeInTheDocument();
    });

    it("renders label when provided", () => {
      render(<DatabaseSelect {...defaultProps} label="Auswahl" />);
      expect(screen.getByText("Auswahl")).toBeInTheDocument();
    });

    it("shows required indicator when required", () => {
      render(<DatabaseSelect {...defaultProps} label="Auswahl" required />);
      expect(screen.getByText("Auswahl").parentElement).toHaveTextContent(
        "Auswahl *",
      );
    });

    it("uses id prop for label association", () => {
      render(
        <DatabaseSelect {...defaultProps} id="custom-id" label="Test Label" />,
      );
      expect(screen.getByRole("combobox")).toHaveAttribute("id", "custom-id");
      expect(screen.getByLabelText("Test Label")).toBeInTheDocument();
    });

    it("uses name as id when id is not provided", () => {
      render(<DatabaseSelect {...defaultProps} label="Test Label" />);
      expect(screen.getByRole("combobox")).toHaveAttribute("id", "test-select");
    });
  });

  describe("Options Rendering", () => {
    it("renders static options", () => {
      const options = [
        { value: "a", label: "Option A" },
        { value: "b", label: "Option B" },
      ];
      render(<DatabaseSelect {...defaultProps} options={options} />);
      openMenu();

      expect(
        screen.getByRole("option", { name: "Option A" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Option B" }),
      ).toBeInTheDocument();
    });

    it("renders empty option by default", () => {
      render(<DatabaseSelect {...defaultProps} />);
      expect(screen.getByText("Bitte wählen")).toBeInTheDocument();
    });

    it("renders custom placeholder as empty option", () => {
      render(
        <DatabaseSelect {...defaultProps} placeholder="Wähle eine Option" />,
      );
      expect(screen.getByText("Wähle eine Option")).toBeInTheDocument();
    });

    it("renders custom empty option label", () => {
      render(
        <DatabaseSelect {...defaultProps} emptyOptionLabel="Keine Auswahl" />,
      );
      expect(screen.getByText("Keine Auswahl")).toBeInTheDocument();
    });

    it("does not render empty option when includeEmpty is false", () => {
      const options = [{ value: "a", label: "Option A" }];
      render(
        <DatabaseSelect
          {...defaultProps}
          options={options}
          includeEmpty={false}
        />,
      );
      openMenu();
      expect(
        screen.queryByRole("option", { name: "Bitte wählen" }),
      ).not.toBeInTheDocument();
    });

    it("renders disabled options correctly", () => {
      const options = [
        { value: "a", label: "Active", disabled: false },
        { value: "b", label: "Disabled", disabled: true },
      ];
      render(<DatabaseSelect {...defaultProps} options={options} />);
      openMenu();

      const disabledOption = screen.getByRole("option", { name: "Disabled" });
      expect(disabledOption).toBeDisabled();
    });
  });

  describe("Value and Change Handling", () => {
    it("displays selected value", () => {
      const options = [
        { value: "a", label: "Option A" },
        { value: "b", label: "Option B" },
      ];
      render(<DatabaseSelect {...defaultProps} options={options} value="b" />);

      expect(screen.getByRole("combobox")).toHaveTextContent("Option B");
    });

    it("calls onChange when selection changes", () => {
      const onChange = vi.fn();
      const options = [
        { value: "a", label: "Option A" },
        { value: "b", label: "Option B" },
      ];
      render(
        <DatabaseSelect
          {...defaultProps}
          options={options}
          onChange={onChange}
        />,
      );

      openMenu();
      fireEvent.click(screen.getByRole("option", { name: "Option B" }));
      expect(onChange).toHaveBeenCalledWith("b");
    });
  });

  describe("Loading State", () => {
    it("shows loading text in empty option when loading", () => {
      render(<DatabaseSelect {...defaultProps} loading />);
      expect(screen.getByText("Lädt...")).toBeInTheDocument();
    });

    it("disables select when loading", () => {
      render(<DatabaseSelect {...defaultProps} loading />);
      expect(screen.getByRole("combobox")).toBeDisabled();
    });

    it("applies loading styles", () => {
      render(<DatabaseSelect {...defaultProps} loading />);
      expect(screen.getByRole("combobox")).toHaveClass("opacity-50");
      expect(screen.getByRole("combobox")).toHaveClass("cursor-wait");
    });
  });

  describe("Disabled State", () => {
    it("disables select when disabled prop is true", () => {
      render(<DatabaseSelect {...defaultProps} disabled />);
      expect(screen.getByRole("combobox")).toBeDisabled();
    });

    it("applies disabled styles", () => {
      render(<DatabaseSelect {...defaultProps} disabled />);
      expect(screen.getByRole("combobox")).toHaveClass("disabled:bg-gray-100!");
      expect(screen.getByRole("combobox")).toHaveClass(
        "disabled:cursor-not-allowed",
      );
    });
  });

  describe("Error State", () => {
    it("displays external error message", () => {
      render(<DatabaseSelect {...defaultProps} error="Auswahl erforderlich" />);
      expect(screen.getByText("Auswahl erforderlich")).toBeInTheDocument();
    });

    it("applies error styles to select", () => {
      render(<DatabaseSelect {...defaultProps} error="Error" />);
      expect(screen.getByRole("combobox")).toHaveClass("border-moto-red!");
    });
  });

  describe("Helper Text", () => {
    it("displays helper text when provided", () => {
      render(
        <DatabaseSelect {...defaultProps} helperText="Wähle eine Option aus" />,
      );
      expect(screen.getByText("Wähle eine Option aus")).toBeInTheDocument();
    });

    it("hides helper text when error is present", () => {
      render(
        <DatabaseSelect
          {...defaultProps}
          helperText="Helper"
          error="Error message"
        />,
      );
      expect(screen.queryByText("Helper")).not.toBeInTheDocument();
      expect(screen.getByText("Error message")).toBeInTheDocument();
    });
  });

  describe("Custom Styling", () => {
    it("applies custom className", () => {
      render(<DatabaseSelect {...defaultProps} className="custom-class" />);
      expect(screen.getByRole("combobox")).toHaveClass("custom-class");
    });

    it("uses the standard kit focus styling", () => {
      render(<DatabaseSelect {...defaultProps} />);
      expect(screen.getByRole("combobox")).toHaveClass(
        "focus-visible:outline-2",
        "focus-visible:outline-field-focus",
      );
    });
  });

  describe("Required Attribute", () => {
    it("sets required attribute on select", () => {
      render(<DatabaseSelect {...defaultProps} required />);
      expect(screen.getByRole("combobox")).toBeRequired();
    });

    it("does not set required attribute by default", () => {
      render(<DatabaseSelect {...defaultProps} />);
      expect(screen.getByRole("combobox")).not.toBeRequired();
    });
  });
});

// =============================================================================
// GroupSelect Tests
// =============================================================================

describe("GroupSelect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultProps = {
    name: "group-select",
    value: "",
    onChange: vi.fn(),
    loadError: null,
    onLoadError: vi.fn(),
  };

  it("renders with default 'Gruppe' label", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(pagedJson([])),
    });

    render(<GroupSelect {...defaultProps} />);
    expect(screen.getByText("Gruppe")).toBeInTheDocument();

    // Wait for async fetch to complete to avoid act() warning
    await waitFor(() => {
      expect(screen.getByText("Bitte wählen")).toBeInTheDocument();
    });
  });

  it("uses custom label when provided", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(pagedJson([])),
    });

    render(<GroupSelect {...defaultProps} label="Klassengruppe" />);
    expect(screen.getByText("Klassengruppe")).toBeInTheDocument();

    // Wait for async fetch to complete to avoid act() warning
    await waitFor(() => {
      expect(screen.getByText("Bitte wählen")).toBeInTheDocument();
    });
  });

  it("fetches options from groups API", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve(
          pagedJson([
            { id: "1", name: "Klasse 1a" },
            { id: "2", name: "Klasse 2b" },
          ]),
        ),
    });

    render(<GroupSelect {...defaultProps} />);

    // Should show loading state initially
    expect(screen.getByText("Lädt...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("combobox")).not.toBeDisabled();
    });
    openMenu();

    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: "Klasse 1a" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Klasse 2b" }),
      ).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/groups", expect.anything());
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("shows a failed load with the owner's catalog text instead of an empty select and retries it", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve(pagedJson([{ id: "1", name: "Raum Blau" }])),
      });

    render(<GroupSelectOwner />);

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Liste der Gruppen"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox")).not.toBeDisabled();
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText(
        catalogText("general.unavailable", "die Liste der Gruppen"),
      ),
    ).not.toBeInTheDocument();
    openMenu();
    expect(
      screen.getByRole("option", { name: "Raum Blau" }),
    ).toBeInTheDocument();
  });

  it("hands a failed load to the owner with the error and a retry", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    const onLoadError = vi.fn();

    render(<GroupSelect {...defaultProps} onLoadError={onLoadError} />);

    await waitFor(() => {
      expect(onLoadError).toHaveBeenCalledWith(
        expect.objectContaining({ code: "general.unavailable" }),
        expect.any(Function),
      );
    });
  });

  it("shows a failed group load with the catalog text and retry", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: () =>
        Promise.resolve(
          JSON.stringify({ status: "error", error: "db down", code: "" }),
        ),
    });

    render(<GroupSelectOwner />);

    expect(
      await screen.findByText(
        catalogText("general.server", "die Liste der Gruppen"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Wiederholen" }),
    ).toBeInTheDocument();
  });

  it("includes filters in API request", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(pagedJson([])),
    });

    render(<GroupSelect {...defaultProps} filters={{ room_id: "7" }} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/groups?room_id=7",
        expect.anything(),
      );
    });
  });

  it("sends every set filter", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(pagedJson([])),
    });

    render(
      <GroupSelect
        {...defaultProps}
        filters={{ name: "test", room_id: "5" }}
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/groups?name=test&room_id=5",
        expect.anything(),
      );
    });
  });

  it("skips unset filter values", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(pagedJson([])),
    });

    render(
      <GroupSelect
        {...defaultProps}
        filters={{ name: "yes", room_id: undefined }}
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/groups?name=yes",
        expect.anything(),
      );
    });
  });
});
