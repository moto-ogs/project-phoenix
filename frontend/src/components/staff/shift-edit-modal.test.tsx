import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ShiftEditModal } from "./shift-edit-modal";
import { ApiError } from "~/lib/api-error";
import { staffShiftService } from "~/lib/shift-api";
import type { StaffShift } from "~/lib/shift-helpers";

vi.mock("~/lib/hooks/use-closing-days", () => ({
  useClosingDaysState: () => ({
    closingDays: new Map(),
    closingDayRanges: [],
    isLoading: false,
  }),
}));

vi.mock("~/lib/shift-api", () => ({
  staffShiftService: {
    createShift: vi.fn(),
    updateShift: vi.fn(),
    deleteShift: vi.fn(),
    applyCancellation: vi.fn(),
  },
  staffShiftSeriesService: {
    createSeries: vi.fn(),
    splitSeries: vi.fn(),
    endSeries: vi.fn(),
  },
}));

const oneHourShift: StaffShift = {
  id: "1",
  staffId: "7",
  date: "2026-07-06",
  startTime: "08:00",
  endTime: "09:00",
  breakMinutes: 30,
  shiftTypeId: null,
  shiftTypeName: null,
  shiftTypeColor: null,
  notes: "",
  seriesId: null,
  detached: false,
  cancelled: false,
  changeReason: null,
  originShiftId: null,
};

describe("ShiftEditModal", () => {
  it("asks before it saves a shift that breaks a working-time rule (#4708)", async () => {
    const updateShift = vi.mocked(staffShiftService.updateShift);
    updateShift.mockReset();
    updateShift
      .mockRejectedValueOnce(
        new ApiError("refused", 409, {
          code: "workforce.shift_working_time_warning",
          details: {
            reason_required: false,
            warnings: [
              {
                kind: "rest_shortened",
                date: "2026-07-06",
                minutes: 600,
                limit: 660,
                needs_reason: false,
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(oneHourShift);
    const onSaved = vi.fn();

    render(
      <ShiftEditModal
        isOpen={true}
        mode="edit"
        staffId="7"
        staffName="Ada Lovelace"
        date="2026-07-06"
        shift={oneHourShift}
        shiftTypes={[]}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Trotzdem so planen?",
    });
    expect(dialog).toHaveTextContent(
      "Vor Mo., 06.07.: 10 Stunden Ruhezeit statt 11 Stunden.",
    );
    expect(screen.queryByLabelText(/Begründung/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trotzdem planen" }));

    await waitFor(() => expect(updateShift).toHaveBeenCalledTimes(2));
    expect(updateShift.mock.calls[0]?.[1].workingTime).toBeUndefined();
    expect(updateShift.mock.calls[1]?.[1].workingTime).toEqual({
      confirmed: true,
      reason: "",
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("caps break minutes at the selected shift duration", () => {
    render(
      <ShiftEditModal
        isOpen={true}
        mode="edit"
        staffId="7"
        staffName="Ada Lovelace"
        date="2026-07-06"
        shift={oneHourShift}
        shiftTypes={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const breakInput = screen.getByLabelText("Pause (Minuten)");
    expect(breakInput).toHaveAttribute("max", "60");

    const saveButton = screen.getByRole("button", {
      name: "Änderungen speichern",
    });
    expect(saveButton).toBeEnabled();
    expect(saveButton).not.toHaveAttribute("aria-disabled");

    fireEvent.change(breakInput, { target: { value: "61" } });
    expect(saveButton).toHaveAttribute("aria-disabled", "true");

    fireEvent.change(breakInput, { target: { value: "60" } });
    expect(saveButton).toBeEnabled();
    expect(saveButton).not.toHaveAttribute("aria-disabled");
  });

  it("keeps existing covers when the cancel toggle is un- and re-checked (#1841)", async () => {
    const applyCancellation = vi.mocked(staffShiftService.applyCancellation);
    applyCancellation.mockClear();
    applyCancellation.mockResolvedValue(undefined as never);

    const cancelledShift: StaffShift = {
      ...oneHourShift,
      id: "5",
      startTime: "08:00",
      endTime: "16:00",
      cancelled: true,
    };
    const existingCover: StaffShift = {
      ...oneHourShift,
      id: "11",
      staffId: "9",
      startTime: "08:00",
      endTime: "12:00",
      breakMinutes: 0,
      originShiftId: "5",
    };

    render(
      <ShiftEditModal
        isOpen={true}
        mode="edit"
        staffId="7"
        staffName="Ada Lovelace"
        date="2026-07-06"
        shift={cancelledShift}
        shiftTypes={[]}
        staffOptions={[{ id: "9", firstName: "Grace", lastName: "Hopper" }]}
        existingReplacements={[existingCover]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const toggle = screen.getByLabelText("Diese Schicht fällt aus");
    expect(toggle).toBeChecked();

    // Reactivate then cancel again before saving: the cover must survive the
    // round-trip instead of being wiped locally.
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();

    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );

    await waitFor(() => expect(applyCancellation).toHaveBeenCalledTimes(1));
    expect(applyCancellation).toHaveBeenCalledWith(
      "5",
      expect.objectContaining({
        cancelled: true,
        replacements: [
          expect.objectContaining({
            staffId: "9",
            startTime: "08:00",
            endTime: "12:00",
          }),
        ],
      }),
    );
  });

  it("clamps a cover's preserved break when its window is shortened below it (#1841)", async () => {
    const applyCancellation = vi.mocked(staffShiftService.applyCancellation);
    applyCancellation.mockClear();
    applyCancellation.mockResolvedValue(undefined as never);

    const cancelledShift: StaffShift = {
      ...oneHourShift,
      id: "5",
      startTime: "08:00",
      endTime: "16:00",
      cancelled: true,
    };
    // A cover edited directly in the grid carries a 60-minute break; this modal
    // has no break field to reveal or correct it.
    const existingCover: StaffShift = {
      ...oneHourShift,
      id: "11",
      staffId: "9",
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 60,
      originShiftId: "5",
    };

    render(
      <ShiftEditModal
        isOpen={true}
        mode="edit"
        staffId="7"
        staffName="Ada Lovelace"
        date="2026-07-06"
        shift={cancelledShift}
        shiftTypes={[]}
        staffOptions={[{ id: "9", firstName: "Grace", lastName: "Hopper" }]}
        existingReplacements={[existingCover]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    // Shorten the cover to 30 minutes — below its hidden 60-minute break.
    fireEvent.change(screen.getByLabelText("Vertretung 1 Ende"), {
      target: { value: "08:30" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );

    // The submitted break is clamped to the new duration, so the backend cannot
    // reject the save with a break-longer-than-shift error.
    await waitFor(() => expect(applyCancellation).toHaveBeenCalledTimes(1));
    expect(applyCancellation).toHaveBeenCalledWith(
      "5",
      expect.objectContaining({
        replacements: [
          expect.objectContaining({
            staffId: "9",
            endTime: "08:30",
            breakMinutes: 30,
          }),
        ],
      }),
    );
  });
});
