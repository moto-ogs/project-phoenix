// The one mapping of the navigation context (GET /api/me/navigation, #7563):
// from the contract's shape to the shape the browser caches under the
// "user-context" SWR key. The browser reads the route through the portal's
// catalog proxy, the shell bootstrap on the server through the contract
// decoder; both hand the decoded row here. Type imports only: the decoders
// stay out of the page bundle.
import type * as meContract from "~/lib/contract/me.generated";
import { knownEnum } from "~/lib/contract/known-enum";
import type {
  ParentInviteMode,
  SchoolSwitches,
  UserContextResponse,
} from "~/lib/user-context-types";

const PARENT_INVITE_MODES: readonly ParentInviteMode[] = [
  "disabled",
  "direct",
  "staff_approval",
];

function mapSchoolSwitches(data: meContract.SchoolSwitches): SchoolSwitches {
  return {
    parentNewsEnabled: data.parent_news_enabled,
    // A mode a newer backend adds stays undefined instead of a guess.
    parentInviteMode: knownEnum(PARENT_INVITE_MODES, data.parent_invite_mode),
    timetableDayStartTime: data.timetable_day_start_time,
    timetableDayEndTime: data.timetable_day_end_time,
  };
}

/** Maps the contract's navigation row to the cached user context. */
export function mapUserContext(
  data: meContract.NavigationResponse,
): UserContextResponse {
  return {
    currentStaff: data.current_staff
      ? { id: data.current_staff.id, personId: data.current_staff.person_id }
      : null,
    schoolSwitches: mapSchoolSwitches(data.school_switches),
  };
}
