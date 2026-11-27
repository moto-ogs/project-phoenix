import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DatabaseSelect } from "./database-select";

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
    label: "Zielraum",
    placeholder: "Zielraum wählen",
    options: [],
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

    it("associates the visible label with the select", () => {
      render(<DatabaseSelect {...defaultProps} />);
      expect(screen.getByLabelText("Zielraum")).toHaveAttribute(
        "id",
        "test-select",
      );
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

    it("uses the caller's placeholder as the empty option", () => {
      render(<DatabaseSelect {...defaultProps} />);
      expect(screen.getByRole("combobox")).toHaveTextContent("Zielraum wählen");

      openMenu();
      expect(
        screen.getByRole("option", { name: "Zielraum wählen" }),
      ).toBeInTheDocument();
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

  it("disables the select when the owner says it cannot be used", () => {
    render(<DatabaseSelect {...defaultProps} disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("uses the standard kit focus styling", () => {
    render(<DatabaseSelect {...defaultProps} />);
    expect(screen.getByRole("combobox")).toHaveClass(
      "focus-visible:outline-2",
      "focus-visible:outline-field-focus",
    );
  });
});
