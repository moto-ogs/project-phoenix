import { describe, expect, it } from "vitest";
import type { NavigationResponse } from "~/lib/contract/me.generated";
import { mapUserContext } from "./user-context-map";

const row: NavigationResponse = {
  current_staff: null,
  school_switches: {
    parent_news_enabled: true,
    parent_invite_mode: "staff_approval",
    timetable_day_start_time: "07:30",
    timetable_day_end_time: "16:15",
  },
};

describe("mapUserContext", () => {
  it("maps the school switches and absent staff profile", () => {
    expect(mapUserContext(row)).toEqual({
      currentStaff: null,
      schoolSwitches: {
        parentNewsEnabled: true,
        parentInviteMode: "staff_approval",
        timetableDayStartTime: "07:30",
        timetableDayEndTime: "16:15",
      },
    });
  });

  it("keeps an unknown invite mode undefined instead of guessing", () => {
    const input = {
      ...row,
      school_switches: {
        ...row.school_switches,
        parent_invite_mode: "unexpected",
      },
    };
    expect(
      mapUserContext(input).schoolSwitches.parentInviteMode,
    ).toBeUndefined();
  });
});
