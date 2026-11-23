import type * as shared from "~/lib/contract/shared.generated";
import type * as staffContract from "~/lib/contract/staff.generated";
import { describe, expect, it } from "vitest";
import {
  mapMonthCloseResultResponse,
  mapMonthCloseSnapshotResponse,
  mapMonthSummaryResponse,
} from "./time-tracking-helpers";

const summary: shared.MonthSummary = {
  is_closed: false,
  closed_by_traeger: false,
  drift_minutes: 0,
  carry_in_frozen: false,
  staff_id: "12",
  year: 2026,
  month: 6,
  carry_in_minutes: 30,
  target_minutes: 7_200,
  target_minutes_to_date: 7_200,
  has_target: true,
  actual_minutes: 7_260,
  credited_sick_minutes: 0,
  credited_vacation_minutes: 0,
  credited_training_minutes: 0,
  credited_other_minutes: 0,
  sick_days: 0,
  vacation_days: 0,
  training_days: 0,
  sick_days_without_target: 0,
  vacation_days_without_target: 0,
  training_days_without_target: 0,
  other_days_without_target: 0,
  planned_shift_minutes: 7_200,
  adjustment_minutes: 0,
  adjustments: [],
  balance_minutes: 60,
  closing_balance_minutes: 90,
};

const snapshot: staffContract.StaffMonthBalanceSnapshot = {
  id: "",
  created_at: "",
  updated_at: "",
  tenant_id: "1",
  staff_id: "12",
  year: 2026,
  month: 6,
  closing_balance_minutes: 90,
  carry_in_minutes: 30,
  target_minutes: 7_200,
  actual_minutes: 7_260,
  credited_minutes: 0,
  adjustment_minutes: 0,
  closed_at: "2026-07-01T08:00:00Z",
  closed_by: "4",
  close_reason: "Lohnlauf",
  source: "manual",
};

describe("month-close response mapping", () => {
  it("maps a closed month summary", () => {
    const result = mapMonthSummaryResponse({
      ...summary,
      is_closed: true,
      closed_at: "2026-07-01T08:00:00Z",
      closed_by: "4",
      close_reason: "Lohnlauf",
      frozen_closing_balance_minutes: 90,
      drift_minutes: -30,
      carry_in_frozen: true,
      carry_in_frozen_from_month: "2026-05",
    });

    expect(result).toMatchObject({
      isClosed: true,
      closedAt: "2026-07-01T08:00:00Z",
      closedBy: "4",
      closeReason: "Lohnlauf",
      closedByTraeger: false,
      frozenClosingBalanceMinutes: 90,
      driftMinutes: -30,
      carryInFrozen: true,
      carryInFrozenFromMonth: "2026-05",
    });
  });

  it("defaults month-close fields for older open-month responses", () => {
    const result = mapMonthSummaryResponse(summary);

    expect(result).toMatchObject({
      isClosed: false,
      closedAt: null,
      closedBy: null,
      closeReason: null,
      frozenClosingBalanceMinutes: null,
      driftMinutes: 0,
      carryInFrozen: false,
      carryInFrozenFromMonth: null,
    });
  });

  it("maps snapshots with and without an optional reason", () => {
    expect(mapMonthCloseSnapshotResponse(snapshot)).toEqual({
      staffId: "12",
      year: 2026,
      month: 6,
      closingBalanceMinutes: 90,
      closedAt: "2026-07-01T08:00:00Z",
      closedBy: "4",
      closeReason: "Lohnlauf",
      source: "manual",
    });
    expect(
      mapMonthCloseSnapshotResponse({
        ...snapshot,
        close_reason: undefined,
      }).closeReason,
    ).toBe("");
  });

  it("maps the school-wide close result", () => {
    expect(
      mapMonthCloseResultResponse({
        snapshots: null,
        year: 2026,
        month: 6,
        closed_staff: 19,
        skipped_staff: 2,
      }),
    ).toEqual({
      year: 2026,
      month: 6,
      closedStaff: 19,
      skippedStaff: 2,
    });
  });
});
