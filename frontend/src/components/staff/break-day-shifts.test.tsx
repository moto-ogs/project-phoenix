import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { mapBreakDayShift, type BreakDayShift } from "~/lib/shift-helpers";
import { testClockDay } from "~/test/clock";

import { BreakDayShifts } from "./break-day-shifts";

const staffById = new Map([
  ["7", { firstName: "Mara", lastName: "Linde" }],
  ["8", { firstName: "Ole", lastName: "Brink" }],
]);

function row(
  shiftId: string,
  overrides: Partial<BreakDayShift> = {},
): BreakDayShift {
  return {
    shiftId,
    staffId: "7",
    date: testClockDay(7),
    startTime: "08:00",
    endTime: "12:00",
    kind: "closing_day",
    adjusted: true,
    ...overrides,
  };
}

describe("BreakDayShifts", () => {
  it("lists each shift with person, reason and its state, and shows its week", () => {
    const onShowWeek = vi.fn();
    render(
      <BreakDayShifts
        shifts={[
          row("2", {
            staffId: "8",
            kind: "holiday_period",
            adjusted: false,
            date: testClockDay(9),
          }),
          row("1"),
        ]}
        loadError={null}
        staffById={staffById}
        onShowWeek={onShowWeek}
      />,
    );

    const card = screen.getByTestId("break-day-shifts");
    expect(
      within(card).getByRole("heading", { name: /Schichten an Schließtagen/ }),
    ).toBeInTheDocument();
    expect(within(card).getByText("2 offen")).toBeInTheDocument();
    expect(
      within(card).getByText(/Von Hand geänderte Schichten bleiben stehen/),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(/08:00–12:00 · Schließtag · von Hand geändert/),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(/Ferien · noch nicht abgesagt/),
    ).toBeInTheDocument();

    fireEvent.click(
      within(card).getByRole("button", {
        name: "Woche der Schicht von Mara Linde ansehen",
      }),
    );
    expect(onShowWeek).toHaveBeenCalledWith(testClockDay(7));
  });

  it("folds more than five shifts behind a toggle", () => {
    render(
      <BreakDayShifts
        shifts={["1", "2", "3", "4", "5", "6", "7"].map((id) => row(id))}
        loadError={null}
        staffById={staffById}
        onShowWeek={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: /ansehen$/ })).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: /2 weitere anzeigen/ }));
    expect(screen.getAllByRole("button", { name: /ansehen$/ })).toHaveLength(7);
  });

  it("shows nothing while no shift stands on a closing day", () => {
    render(
      <BreakDayShifts
        shifts={[]}
        loadError={null}
        staffById={staffById}
        onShowWeek={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("break-day-shifts")).not.toBeInTheDocument();
    expect(document.body).toBeInTheDocument();
  });

  it("maps the wire row and keeps an unknown reason visible as a closing day", () => {
    expect(
      mapBreakDayShift({
        shift_id: "5",
        staff_id: "7",
        date: "2026-10-01",
        start_time: "08:00",
        end_time: "12:00",
        break: "something_new",
        adjusted: false,
      }),
    ).toEqual({
      shiftId: "5",
      staffId: "7",
      date: "2026-10-01",
      startTime: "08:00",
      endTime: "12:00",
      kind: "closing_day",
      adjusted: false,
    });
  });
});
