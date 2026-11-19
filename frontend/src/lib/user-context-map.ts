// The one mapping of the navigation context (GET /api/me/navigation, #7563):
// from the contract's shape to the shape the browser caches under the
// "user-context" SWR key. The browser reads the route through the portal's
// catalog proxy, the shell bootstrap on the server through the contract
// decoder; both hand the decoded row here. Type imports only: the decoders
// stay out of the page bundle.
import type {
  ActiveGroup,
  CallerGroupRow,
  NavigationResponse,
  SchoolSwitches as WireSchoolSwitches,
} from "~/lib/contract/me.generated";
import { knownEnum } from "~/lib/contract/known-enum";
import type {
  EducationalGroup,
  ParentInviteMode,
  SchoolSwitches,
  SupervisedGroup,
  UserContextResponse,
} from "~/lib/user-context-types";

const PARENT_INVITE_MODES: readonly ParentInviteMode[] = [
  "disabled",
  "direct",
  "staff_approval",
];

function mapSchoolSwitches(data: WireSchoolSwitches): SchoolSwitches {
  return {
    parentNewsEnabled: data.parent_news_enabled,
    // A mode a newer backend adds stays undefined instead of a guess.
    parentInviteMode: knownEnum(PARENT_INVITE_MODES, data.parent_invite_mode),
    timetableDayStartTime: data.timetable_day_start_time,
    timetableDayEndTime: data.timetable_day_end_time,
  };
}

function mapEducationalGroup(data: CallerGroupRow): EducationalGroup {
  return {
    id: data.id,
    name: data.name,
    roomId: data.room_id,
    room: data.room ? { id: data.room.id, name: data.room.name } : undefined,
    viaSubstitution: data.via_substitution,
  };
}

function mapSupervisedGroup(data: ActiveGroup): SupervisedGroup {
  return {
    id: data.id,
    roomId: data.room_id,
    room: data.room ? { id: data.room.id, name: data.room.name } : undefined,
  };
}

const present = <T>(rows: readonly (T | null)[] | null): T[] =>
  (rows ?? []).filter((row): row is T => row !== null);

/** Maps the contract's navigation row to the cached user context. */
export function mapUserContext(data: NavigationResponse): UserContextResponse {
  const educationalGroups = present(data.educational_groups).map(
    mapEducationalGroup,
  );
  const supervisedGroups = present(data.supervised_groups).map(
    mapSupervisedGroup,
  );
  return {
    educationalGroups,
    supervisedGroups,
    currentStaff: data.current_staff
      ? { id: data.current_staff.id, personId: data.current_staff.person_id }
      : null,
    educationalGroupIds: educationalGroups.map((group) => group.id),
    educationalGroupRoomNames: educationalGroups
      .map((group) => group.room?.name)
      .filter((name): name is string => !!name),
    supervisedRoomNames: supervisedGroups
      .map((group) => group.room?.name)
      .filter((name): name is string => !!name),
    incomplete: data.incomplete,
    unavailableSections: data.unavailable_sections ?? [],
    schoolSwitches: mapSchoolSwitches(data.school_switches),
  };
}
