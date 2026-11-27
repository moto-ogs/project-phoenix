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
    expect(timeTrackingKeys.period("month", "2026-09-01")).toBe(
      "time-tracking-period-month-2026-09-01",
    );
    expect(timeTrackingKeys.ownAssignmentsToday("2026-09-09")).toBe(
      "time-tracking-own-assignments-today-2026-09-09",
    );
  });

  it("keep the plan keys under their realtime and plan prefixes", () => {
    expect(
      tenantDailyKeys.planInstances("week", "a", "b", NO_PLAN_FILTER),
    ).toBe("timetable-week-a-b");
    expect(tenantDailyKeys.planInstanceDetail("42", "2026-11-25")).toBe(
      "timetable-detail-42-2026-11-25",
    );
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
  });

  it("suppresses active-group roster keys after a not-found roster miss", () => {
    const missing = new Set(["active-1"]);

    expect(
      tenantDailyKeys.activeSupervisionRoster({
        selectedTimetableInstanceId: null,
        currentRoomId: "active-1",
        missingRosterActiveGroupIds: missing,
      }),
    ).toBeNull();
    expect(
      tenantDailyKeys.activeSupervisionRoster({
        selectedTimetableInstanceId: null,
        currentRoomId: "active-2",
        missingRosterActiveGroupIds: missing,
      }),
    ).toBe("timetable-roster-active-group-active-2");
  });

  it("keeps explicit timetable instance roster keys even when the active group missed", () => {
    expect(
      tenantDailyKeys.activeSupervisionRoster({
        selectedTimetableInstanceId: "instance-1",
        currentRoomId: "active-1",
        missingRosterActiveGroupIds: new Set(["active-1"]),
      }),
    ).toBe("timetable-roster-instance-1");
  });

  it("resolves a planned roster by active group after a Schulhof reload", () => {
    expect(
      tenantDailyKeys.activeSupervisionRoster({
        selectedTimetableInstanceId: null,
        currentRoomId: "schulhof-planned-active-group",
        missingRosterActiveGroupIds: new Set(),
      }),
    ).toBe("timetable-roster-active-group-schulhof-planned-active-group");
  });
});
