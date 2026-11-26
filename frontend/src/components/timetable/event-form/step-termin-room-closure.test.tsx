import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import type { RoomClosure } from "~/lib/room-closures-api";
import { testClockDay } from "~/test/clock";
import { emptyForm } from "./form-model";
import { StepTermin } from "./step-termin";

const closedRooms = new Map<string, RoomClosure>();

const day = testClockDay(2);
const rooms = [
  { id: "10", name: "Werkraum", building: "" },
  { id: "11", name: "Musikraum", building: "" },
];

function renderStep(roomId = "") {
  const update = vi.fn();
  render(
    <ToastProvider>
      <StepTermin
        form={{ ...emptyForm(day), type: "care", roomId }}
        update={update}
        fieldErrors={{}}
        rooms={rooms}
        closedRooms={closedRooms}
        categories={[]}
        loadingRefs={false}
        expanded
        isSeriesFlow
        isEditingSeries={false}
        quickPreset=""
        listKindTouched={createRef<boolean>() as React.RefObject<boolean>}
        canManageCategories={false}
      />
    </ToastProvider>,
  );
  return { update };
}

describe("StepTermin — gesperrter Raum (#7653)", () => {
  closedRooms.set("10", {
    id: "1",
    roomId: "10",
    startDate: day,
    endDate: day,
    reason: "Wasserschaden",
  });

  it("offers a room closed on the day only with its reason, not to choose", () => {
    const { update } = renderStep();

    fireEvent.click(screen.getByRole("combobox", { name: "Raum" }));
    const closed = screen.getByRole("option", {
      name: "Werkraum (Gesperrt: Wasserschaden)",
    });
    expect(closed).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(closed);
    expect(update).not.toHaveBeenCalledWith("roomId", "10");

    fireEvent.click(screen.getByRole("option", { name: "Musikraum" }));
    expect(update).toHaveBeenCalledWith("roomId", "11");
  });

  it("keeps an already chosen closed room and says why it should move", () => {
    renderStep("10");

    expect(
      screen.getByText(
        "Der Raum ist an diesem Tag gesperrt: Wasserschaden. Wähle einen anderen Raum.",
      ),
    ).toBeInTheDocument();
  });
});
