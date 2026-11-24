import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import {
  type RunDueDate,
  saveRunDueDates,
} from "~/lib/traeger-billing-terms-api";
import { testClockDay } from "~/test/clock";
import { RunDueDatesForm } from "./run-due-dates-form";

vi.mock("~/lib/traeger-billing-terms-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveRunDueDates: vi.fn(),
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

const DATES: readonly RunDueDate[] = [];

function form(version: string, reload: () => Promise<never>) {
  return (
    <RunDueDatesForm
      kind="care"
      runId="r1"
      dueDates={DATES}
      version={version}
      reload={reload}
      onCancel={vi.fn()}
      onSaved={vi.fn()}
    />
  );
}

describe("RunDueDatesForm", () => {
  // ADR 0311, rule 6: after a refusal whose read failed, only a read that
  // arrived later unlocks the form. A render of the read shown before the
  // save (here v2, under a touched draft on v1) is no such read.
  it("stays locked after a failed read when the page renders the same read again", async () => {
    const save = vi.mocked(saveRunDueDates);
    save.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    const reload = vi.fn(() => Promise.reject(new ApiError("down", 503)));
    const { rerender } = render(form("v1", reload), {
      wrapper: ToastProvider,
    });
    const [first] = screen.getAllByLabelText(/fällig am/);
    fireEvent.change(first!, { target: { value: testClockDay(30) } });
    rerender(form("v2", reload));

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(/Der neue Stand konnte nicht geladen werden/),
    ).toBeInTheDocument();
    expect(save).toHaveBeenLastCalledWith(
      "care",
      "r1",
      expect.anything(),
      "v1",
    );

    // Typing renders the form again with the same read.
    fireEvent.change(first!, { target: { value: testClockDay(31) } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(
        screen.getByText(/Der neue Stand konnte nicht geladen werden/),
      ).toBeInTheDocument(),
    );
    expect(save).toHaveBeenCalledTimes(1);
  });
});
