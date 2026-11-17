import { describe, expect, it } from "vitest";
import { NO_PLAN_FILTER } from "~/lib/plan-filter";
import { timeTrackingKeys } from "./portal-keys";
import {
  staffAbsenceKeys,
  staffKeys,
  staffNoticeKeys,
  staffTimeKeys,
} from "./staff-keys";
import { tenantDailyKeys } from "./tenant-daily-keys";

// Readers moved from hand-built keys to these factories. Invalidations, SSE
// prefixes and server seeds still match on the old strings, so a factory
// must keep each key exactly as the readers built it before.
describe("factory keys of the staff, time tracking and plan readers", () => {
  it("keep the strings the invalidation prefixes match", () => {
    expect(staffTimeKeys.schedule("7")).toBe("staff-schedule-7");
    expect(staffTimeKeys.scheduleTargets("7", "a", "b")).toBe(
      "staff-schedule-targets-7-a-b",
    );
    expect(staffTimeKeys.scheduleTargetsAccount("7", "a", "b")).toBe(
      "staff-schedule-targets-7-account-a-b",
    );
    expect(staffTimeKeys.history("7", "a", "b")).toBe("staff-history-7-a-b");
    expect(staffTimeKeys.historyAccount("7", "a", "b")).toBe(
      "staff-history-account-7-a-b",
    );
    expect(staffTimeKeys.balanceAdjustments("7", "a", "b")).toBe(
      "staff-balance-adjustments-7-a-b",
    );
    expect(staffAbsenceKeys.accountList("7", "a", "b")).toBe(
      "staff-absences-account-7-a-b",
    );
    expect(staffAbsenceKeys.pendingAll()).toBe("staff-pending-absences-all");
    expect(staffAbsenceKeys.requests("9", "open", "x", ["t"])).toBe(
      'staff-absence-requests:9:open:["x",["t"]]',
    );
    expect(staffKeys.stammdaten("7")).toBe("staff-stammdaten-7");
    expect(staffNoticeKeys.today("9")).toBe("staff-notices-today:9");
    expect(timeTrackingKeys.monthSummary(2026, 9)).toBe(
      "time-tracking-month-summary-2026-9",
    );
    expect(timeTrackingKeys.ownAssignmentsToday("2026-09-09")).toBe(
      "time-tracking-own-assignments-today-2026-09-09",
    );
  });

  it("keep the plan keys under their realtime and plan prefixes", () => {
    expect(
      tenantDailyKeys.planInstances("week", "a", "b", NO_PLAN_FILTER),
    ).toBe("timetable-week-a-b");
    expect(
      tenantDailyKeys.planInstanceDetail(
        "week",
        "a",
        "b",
        { groupId: "3", staffId: null, roomId: "4" },
        "a",
      ),
    ).toBe("timetable-week-a-b-g3-p-r4-detail-a");
    expect(tenantDailyKeys.dienstplanOverview("a", "b")).toBe(
      "dienstplan-overview-a-b",
    );
    expect(tenantDailyKeys.vertretungWeek("a", "b")).toBe(
      "vertretung-week-a-b",
    );
    expect(tenantDailyKeys.rosterDeviations("5", "8")).toBe(
      "roster-deviations-5-connect-8",
    );
    expect(
      tenantDailyKeys.deviationHistory("a", {
        activityGroupId: "3",
        startTime: "08:00",
      }),
    ).toBe("deviation-history-a-3-08:00");
    expect(
      tenantDailyKeys.activeSupervisionRoster({
        selectedTimetableInstanceId: null,
        currentRoomId: "6",
        missingRosterActiveGroupIds: new Set(["6"]),
      }),
    ).toBeNull();
  });
});
