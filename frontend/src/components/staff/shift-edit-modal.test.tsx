import {
  act,
  fireEvent,
  render as renderUi,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState, type ReactElement, type ReactNode } from "react";
import { SWRConfig } from "~/lib/swr/testing";
import { describe, expect, it, vi } from "vitest";

import { ShiftEditModal } from "./shift-edit-modal";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import { staffShiftService } from "~/lib/shift-api";
import type { StaffShift } from "~/lib/shift-helpers";

vi.unmock("swr");
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "1" }, expires: "2099-01-01" },
  }),
}));

// Real SWR with a fresh cache per render: the modal reads calendar periods
// and the series rule through the shared cache.
function FreshCache({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), errorRetryCount: 0 }}>
      {children}
    </SWRConfig>
  );
}

function render(ui: ReactElement) {
  return renderUi(ui, { wrapper: FreshCache });
}

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
            count: 1,
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

  // ADR 0311: die Absage schickt den Stand der Schicht und jeder gezeigten
  // Vertretung aus der Öffnung; nach einer Ablehnung wartet Speichern auf
  // den gespeicherten Stand, der das Formular neu füllt.
  it("cancels over the shift and covers it opened and saves again only from the stored state", async () => {
    const applyCancellation = vi.mocked(staffShiftService.applyCancellation);
    applyCancellation.mockReset();
    applyCancellation
      .mockRejectedValueOnce(
        new ApiError("changed since it was read", 409, {
          code: "general.changed_since_read",
        }),
      )
      .mockResolvedValueOnce(undefined as never);
    const opened: StaffShift = {
      ...oneHourShift,
      id: "5",
      startTime: "08:00",
      endTime: "16:00",
      cancelled: true,
      version: "shift-v1",
    };
    const cover: StaffShift = {
      ...oneHourShift,
      id: "11",
      staffId: "9",
      startTime: "08:00",
      endTime: "12:00",
      breakMinutes: 0,
      originShiftId: "5",
      version: "cover-v1",
    };
    let handOver: (() => void) | undefined;
    function Harness() {
      const [read, setRead] = useState({ shift: opened, covers: [cover] });
      handOver = () =>
        setRead({
          shift: { ...opened, version: "shift-v2" },
          covers: [{ ...cover, endTime: "13:00", version: "cover-v2" }],
        });
      return (
        <ShiftEditModal
          isOpen={true}
          mode="edit"
          staffId="7"
          staffName="Ada Lovelace"
          date="2026-07-06"
          shift={read.shift}
          shiftTypes={[]}
          staffOptions={[{ id: "9", firstName: "Grace", lastName: "Hopper" }]}
          existingReplacements={read.covers}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          reloadShift={async () => {
            await Promise.resolve();
            act(() => {
              handOver?.();
            });
          }}
        />
      );
    }
    render(<Harness />);

    const save = () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Änderungen speichern" }),
      );
    save();

    await waitFor(() => expect(applyCancellation).toHaveBeenCalledTimes(1));
    expect(applyCancellation).toHaveBeenLastCalledWith(
      "5",
      expect.objectContaining({
        expectedVersion: "shift-v1",
        expectedReplacementVersions: { "11": "cover-v1" },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Änderungen speichern" }),
      ).not.toHaveAttribute("aria-disabled"),
    );
    save();

    await waitFor(() => expect(applyCancellation).toHaveBeenCalledTimes(2));
    expect(applyCancellation).toHaveBeenLastCalledWith(
      "5",
      expect.objectContaining({
        expectedVersion: "shift-v2",
        expectedReplacementVersions: { "11": "cover-v2" },
        replacements: [expect.objectContaining({ endTime: "13:00" })],
      }),
    );
  });

  // ADR 0311: nach einer Ablehnung bringt das Neuladen die gespeicherte
  // Schicht mit derselben Kennung. Sie füllt die Felder neu, die Meldung
  // bleibt stehen. Das Neuladen setzt den Zustand ohne act(), wie die
  // Dienstplan-Ansicht es tut.
  it("keeps the refusal message when the stored shift arrives after a refused edit", async () => {
    const updateShift = vi.mocked(staffShiftService.updateShift);
    updateShift.mockReset();
    updateShift.mockRejectedValueOnce(
      new ApiError("changed since it was read", 409, {
        code: "general.changed_since_read",
      }),
    );
    const opened: StaffShift = {
      ...oneHourShift,
      id: "5",
      startTime: "08:00",
      endTime: "16:00",
      version: "shift-v1",
    };
    let handOver: (() => void) | undefined;
    function Harness() {
      const [shift, setShift] = useState(opened);
      handOver = () =>
        setShift({ ...opened, startTime: "09:00", version: "shift-v2" });
      return (
        <ShiftEditModal
          isOpen={true}
          mode="edit"
          staffId="7"
          staffName="Ada Lovelace"
          date="2026-07-06"
          shift={shift}
          shiftTypes={[]}
          staffOptions={[]}
          existingReplacements={[]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          reloadShift={async () => {
            await Promise.resolve();
            handOver?.();
          }}
        />
      );
    }
    render(<Harness />);

    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );

    await waitFor(() =>
      expect(screen.getByDisplayValue("09:00")).toBeInTheDocument(),
    );
    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Schicht"),
      ),
    ).toBeInTheDocument();
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

  // ADR 0311: the form is a draft on the shift it opened with. A newer
  // shift handed in refills only an untouched form; typed input stays and
  // goes out with the version it was typed on, so the server refuses it
  // instead of the save confirming a state nobody saw.
  it("keeps typed input on the version it opened with and refills an untouched form", async () => {
    const updateShift = vi.mocked(staffShiftService.updateShift);
    updateShift.mockReset();
    updateShift.mockResolvedValue(undefined as never);
    const opened: StaffShift = {
      ...oneHourShift,
      id: "5",
      startTime: "08:00",
      endTime: "16:00",
      version: "shift-v1",
    };
    const newer: StaffShift = {
      ...opened,
      startTime: "09:00",
      version: "shift-v2",
    };
    const props = {
      isOpen: true,
      mode: "edit" as const,
      staffId: "7",
      staffName: "Ada Lovelace",
      date: "2026-07-06",
      shiftTypes: [],
      staffOptions: [],
      existingReplacements: [],
      onClose: vi.fn(),
      onSaved: vi.fn(),
    };
    const view = render(<ShiftEditModal {...props} shift={opened} />);
    fireEvent.change(screen.getByLabelText("Ende"), {
      target: { value: "14:00" },
    });
    view.rerender(<ShiftEditModal {...props} shift={newer} />);

    expect(screen.getByLabelText("Beginn")).toHaveValue("08:00");
    expect(screen.getByLabelText("Ende")).toHaveValue("14:00");
    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );
    await waitFor(() => expect(updateShift).toHaveBeenCalledTimes(1));
    expect(updateShift).toHaveBeenLastCalledWith(
      "5",
      expect.objectContaining({
        startTime: "08:00",
        endTime: "14:00",
        expectedVersion: "shift-v1",
      }),
    );

    // A new opening without input follows the newest shift.
    view.rerender(<ShiftEditModal {...props} isOpen={false} shift={opened} />);
    view.rerender(<ShiftEditModal {...props} shift={opened} />);
    view.rerender(<ShiftEditModal {...props} shift={newer} />);
    expect(screen.getByLabelText("Beginn")).toHaveValue("09:00");
    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );
    await waitFor(() => expect(updateShift).toHaveBeenCalledTimes(2));
    expect(updateShift).toHaveBeenLastCalledWith(
      "5",
      expect.objectContaining({
        startTime: "09:00",
        expectedVersion: "shift-v2",
      }),
    );
  });
});
