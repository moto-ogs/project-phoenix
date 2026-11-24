import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TraegerPlanningPerson,
  TraegerPlanningShift,
} from "~/lib/traeger-planning-api";

const api = vi.hoisted(() => ({
  planTraegerShift: vi.fn(),
  changeTraegerShift: vi.fn(),
  removeTraegerShift: vi.fn(),
}));
vi.mock("~/lib/traeger-planning-api", () => api);

import { PlanShiftModal, type PlanShiftTarget } from "./plan-shift-modal";

const SHIFT: TraegerPlanningShift = {
  id: "501",
  schoolId: "1",
  schoolName: "OGS Nord",
  staffId: "101",
  date: "2026-09-07",
  startTime: "11:30",
  endTime: "16:30",
  breakMinutes: 0,
  notes: "",
  cancelled: false,
  shiftTypeName: null,
  shiftTypeColor: null,
  plannedByTraeger: true,
  fromSeries: false,
  version: "v1",
};

const PERSON: TraegerPlanningPerson = {
  recordId: "11",
  firstName: "Mira",
  lastName: "Sommer",
  sites: [{ schoolId: "1", schoolName: "OGS Nord", staffId: "101" }],
  shifts: [SHIFT],
  plannedMinutes: 300,
  sollMinutes: 1200,
  sollDays: [],
  absentDays: [],
  warnings: [],
};

const opened: PlanShiftTarget = { kind: "edit", person: PERSON, shift: SHIFT };
const newer: PlanShiftTarget = {
  kind: "edit",
  person: PERSON,
  shift: { ...SHIFT, startTime: "12:00", version: "v2" },
};

function modal(target: PlanShiftTarget) {
  return (
    <PlanShiftModal
      target={target}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      reloadShift={vi.fn()}
    />
  );
}

// ADR 0311: the fields are a draft on the shift the dialog opened with. A
// newer shift handed in refills only untouched fields; typed input goes out
// with the version it was typed on, and the server refuses it instead of the
// change confirming a state nobody saw.
describe("PlanShiftModal draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.changeTraegerShift.mockResolvedValue(SHIFT);
  });

  it("keeps typed input on the version it opened with", async () => {
    const view = render(modal(opened));
    fireEvent.change(screen.getByLabelText(/^Ende/), {
      target: { value: "17:00" },
    });
    view.rerender(modal(newer));

    expect(screen.getByLabelText(/^Beginn/)).toHaveValue("11:30");
    expect(screen.getByLabelText(/^Ende/)).toHaveValue("17:00");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.changeTraegerShift).toHaveBeenCalled());
    expect(api.changeTraegerShift.mock.calls[0]?.[2]).toMatchObject({
      startTime: "11:30",
      endTime: "17:00",
      expectedVersion: "v1",
    });
  });

  it("refills untouched fields from a newer shift and sends its version", async () => {
    const view = render(modal(opened));
    view.rerender(modal(newer));

    expect(screen.getByLabelText(/^Beginn/)).toHaveValue("12:00");
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.changeTraegerShift).toHaveBeenCalled());
    expect(api.changeTraegerShift.mock.calls[0]?.[2]).toMatchObject({
      startTime: "12:00",
      expectedVersion: "v2",
    });
  });
});
