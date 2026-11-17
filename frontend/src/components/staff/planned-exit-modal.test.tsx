import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "~/lib/api-error";
import { testClockDay } from "~/test/clock";
import { catalogText } from "~/test/error-catalog-text";
import { suppressConsole } from "~/test/helpers/console";

const mocks = vi.hoisted(() => ({ plan: vi.fn() }));

vi.mock("~/lib/staff-api", () => ({
  staffPlannedExitService: { plan: mocks.plan },
}));

// The kit picker opens a calendar overlay; a native date input drives the
// "YYYY-MM-DD" value deterministically.
vi.mock("~/components/ui/date-picker", () => ({
  ISODatePicker: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (value: string) => void;
    label?: string;
  }) => (
    <input
      type="date"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { PlannedExitModal } from "./planned-exit-modal";

function renderModal(
  props: Partial<{ plannedDay: string; contractEndDate: string | null }> = {},
) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <PlannedExitModal
      isOpen
      staffId="7"
      staffName="Ada Lovelace"
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { onSaved, onClose, ...view };
}

// Days relative to the test clock: the contract ends in the future or is over.
const CONTRACT_END = testClockDay(113);
const CONTRACT_ENDED = testClockDay(-9);
const PLANNED_DAY = testClockDay(51);
const SELECTED_DAY = testClockDay(36);

describe("PlannedExitModal", () => {
  suppressConsole("error");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("suggests the contract end and plans that day", async () => {
    mocks.plan.mockResolvedValue(CONTRACT_END);
    const { onSaved } = renderModal({ contractEndDate: CONTRACT_END });

    expect(screen.getByLabelText("Letzter Arbeitstag")).toHaveValue(
      CONTRACT_END,
    );
    expect(
      screen.getByText(/Vorgeschlagen ist das Vertragsende/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Austritt planen" }));

    await waitFor(() =>
      expect(mocks.plan).toHaveBeenCalledWith("7", CONTRACT_END),
    );
    expect(onSaved).toHaveBeenCalledWith(CONTRACT_END);
  });

  it("does not suggest a contract end that is already over", () => {
    renderModal({ contractEndDate: CONTRACT_ENDED });

    expect(screen.getByLabelText("Letzter Arbeitstag")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Austritt planen" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("suggests the contract end when it loads after opening", () => {
    const { rerender } = renderModal();

    rerender(
      <PlannedExitModal
        isOpen
        staffId="7"
        staffName="Ada Lovelace"
        contractEndDate={CONTRACT_END}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Letzter Arbeitstag")).toHaveValue(
      CONTRACT_END,
    );
  });

  it("keeps a selected day when the contract end loads", () => {
    const { rerender } = renderModal();

    fireEvent.change(screen.getByLabelText("Letzter Arbeitstag"), {
      target: { value: SELECTED_DAY },
    });
    rerender(
      <PlannedExitModal
        isOpen
        staffId="7"
        staffName="Ada Lovelace"
        contractEndDate={CONTRACT_END}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Letzter Arbeitstag")).toHaveValue(
      SELECTED_DAY,
    );
  });

  it("opens a planned exit on its day for changing", () => {
    renderModal({ plannedDay: PLANNED_DAY, contractEndDate: CONTRACT_END });

    expect(
      screen.getByRole("heading", { name: "Austritt ändern" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Letzter Arbeitstag")).toHaveValue(
      PLANNED_DAY,
    );
    expect(screen.getByRole("button", { name: "Speichern" })).toBeEnabled();
  });

  it("shows a refusal in the dialog", async () => {
    mocks.plan.mockRejectedValue(
      new ApiError("exit already due", 409, { code: "staff.exit_already_due" }),
    );
    const { onSaved } = renderModal({ plannedDay: PLANNED_DAY });

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(
        catalogText("staff.exit_already_due", "den Austritt"),
      ),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
