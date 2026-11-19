import { describe, expect, it } from "vitest";
import type { CallerNavigationRow } from "~/lib/contract/me.generated";
import { mapUserContext } from "./user-context-map";

const AT = "2026-09-01T08:00:00Z";

function row(
  overrides: Partial<CallerNavigationRow> = {},
): CallerNavigationRow {
  return {
    current_staff: null,
    educational_groups: [],
    incomplete: false,
    school_switches: {
      parent_news_enabled: true,
      parent_invite_mode: "staff_approval",
      timetable_day_start_time: "07:30",
      timetable_day_end_time: "16:15",
    },
    supervised_groups: [],
    unavailable_sections: [],
    ...overrides,
  };
}

describe("mapUserContext", () => {
  it("maps the contract's navigation row once into the cached context", () => {
    const context = mapUserContext(
      row({
        current_staff: {
          id: "5",
          created_at: AT,
          updated_at: AT,
          tenant_id: "3",
          person_id: "7",
          birthday_display_opt_out: false,
        },
        educational_groups: [
          {
            id: "1",
            created_at: AT,
            updated_at: AT,
            tenant_id: "3",
            name: "Rot",
            room_id: "10",
            room: { id: "10", created_at: AT, updated_at: AT, name: "Raum 10" },
            via_substitution: true,
          },
          {
            id: "4",
            created_at: AT,
            updated_at: AT,
            tenant_id: "3",
            name: "Blau",
            via_substitution: false,
          },
          null,
        ],
        supervised_groups: [
          {
            id: "2",
            created_at: AT,
            updated_at: AT,
            tenant_id: "3",
            start_time: AT,
            last_activity: AT,
            timeout_minutes: 30,
            group_id: null,
            room_id: "11",
            room: {
              id: "11",
              tenant_id: "3",
              created_at: AT,
              updated_at: AT,
              name: "Raum 11",
              is_system: false,
              is_open_room: false,
            },
          },
        ],
        incomplete: true,
        unavailable_sections: ["supervised_groups"],
      }),
    );

    expect(context).toEqual({
      educationalGroups: [
        {
          id: "1",
          name: "Rot",
          roomId: "10",
          room: { id: "10", name: "Raum 10" },
          viaSubstitution: true,
        },
        {
          id: "4",
          name: "Blau",
          roomId: undefined,
          room: undefined,
          viaSubstitution: false,
        },
      ],
      supervisedGroups: [
        { id: "2", roomId: "11", room: { id: "11", name: "Raum 11" } },
      ],
      currentStaff: { id: "5", personId: "7" },
      educationalGroupIds: ["1", "4"],
      educationalGroupRoomNames: ["Raum 10"],
      supervisedRoomNames: ["Raum 11"],
      incomplete: true,
      unavailableSections: ["supervised_groups"],
      schoolSwitches: {
        parentNewsEnabled: true,
        parentInviteMode: "staff_approval",
        timetableDayStartTime: "07:30",
        timetableDayEndTime: "16:15",
      },
    });
  });

  it("reads null lists as empty", () => {
    const context = mapUserContext(
      row({
        educational_groups: null,
        supervised_groups: null,
        unavailable_sections: null,
      }),
    );

    expect(context.educationalGroups).toEqual([]);
    expect(context.supervisedGroups).toEqual([]);
    expect(context.unavailableSections).toEqual([]);
  });

  // The signed-in app shell reads these school switches here instead of the
  // settings schema (#4996).
  it("keeps an unknown invite mode undefined instead of guessing", () => {
    const context = mapUserContext(
      row({
        school_switches: {
          parent_news_enabled: false,
          parent_invite_mode: "nonsense_from_a_newer_backend",
          timetable_day_start_time: "09:00",
          timetable_day_end_time: "17:00",
        },
      }),
    );

    expect(context.schoolSwitches).toEqual({
      parentNewsEnabled: false,
      parentInviteMode: undefined,
      timetableDayStartTime: "09:00",
      timetableDayEndTime: "17:00",
    });
  });
});
