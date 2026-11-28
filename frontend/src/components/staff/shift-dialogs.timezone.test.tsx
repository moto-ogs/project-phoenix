import { render as renderUi, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseISODate } from "~/lib/date-helpers";
import type { StaffScheduleStaff, StaffShift } from "~/lib/shift-helpers";
import { SWRConfig } from "~/lib/swr/testing";

import { ShiftEditModal } from "./shift-edit-modal";
import { ShiftMoveDialog } from "./shift-move-dialog";

// Runs in `school-date-dom`: only forked processes apply a runtime TZ change.
// A shift date is a calendar day. Both dialogs show that very day, whether
// the browser sits in Berlin or east of it (#8269). Before the fix Tokyo read
// local midnight of 26.11. as Berlin's 25.11., 16:00.
afterEach(() => vi.unstubAllEnvs());

vi.unmock("swr");
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "1" }, expires: "2099-01-01" },
  }),
}));

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
    moveShift: vi.fn(),
    applyCancellation: vi.fn(),
  },
  staffShiftSeriesService: {
    createSeries: vi.fn(),
    splitSeries: vi.fn(),
    endSeries: vi.fn(),
  },
}));

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

const member: StaffScheduleStaff = {
  id: "7",
  firstName: "Ada",
  lastName: "Lovelace",
};

const shift: StaffShift = {
  id: "1",
  staffId: member.id,
  date: "2026-11-26",
  startTime: "08:00",
  endTime: "12:00",
  breakMinutes: 0,
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

// 26.11.2026 is a Thursday; Berlin is UTC+1, Tokyo UTC+9.
const zones = [
  ["Europe/Berlin", -60],
  ["Asia/Tokyo", -540],
] as const;

function useZone(zone: string, offsetMinutes: number) {
  vi.stubEnv("TZ", zone);
  // An ineffective zone change must not hide the defect.
  expect(parseISODate(shift.date).getTimezoneOffset()).toBe(offsetMinutes);
}

describe.each(zones)("shift dialogs in %s", (zone, offsetMinutes) => {
  it("„Schicht bearbeiten“ names the shift's own day", () => {
    useZone(zone, offsetMinutes);
    render(
      <ShiftEditModal
        mode="edit"
        staffId={member.id}
        staffName="Ada Lovelace"
        date={shift.date}
        shift={shift}
        shiftTypes={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Schicht bearbeiten · Donnerstag, 26. November 2026"),
    ).toBeInTheDocument();
  });

  it("„Schicht verschieben“ names the shift's own day", () => {
    useZone(zone, offsetMinutes);
    render(
      <ShiftMoveDialog
        isOpen
        shift={shift}
        sourceMember={member}
        staff={[member]}
        shiftTypes={[]}
        onClose={vi.fn()}
        onDataChanged={vi.fn()}
      />,
    );

    expect(
      screen.getAllByText(/Donnerstag, 26\. November 2026/).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/25\. November/)).not.toBeInTheDocument();
  });
});
