import { ApiError } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import { createLogger } from "~/lib/logger";
import type { TrackingIndicatorsResponse } from "~/lib/active-helpers";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";
import type { DepartureMode } from "~/lib/departure-plan";
import type { TeacherHint } from "~/lib/student-helpers";
import { mapSupervisionDashboard } from "~/lib/supervision-dashboard-wire";
import type { OpenRoomView, SchulhofStatusResponse } from "./view-model";
import type * as studentsContract from "~/lib/contract/students.generated";
const logger = createLogger({ component: "useSupervisionDashboard" });

// The page's view of the supervision projection (#2096), mapped once from
// the contract shape by mapSupervisionDashboard.
export interface BFFDashboardResponse {
  businessDay: string;
  spontaneousStartAvailability: {
    available: boolean;
    blockedReason?: "weekend";
  };
  supervisedGroups: Array<{
    id: string;
    name: string;
    canAssign: boolean;
    isCurrentUserSupervising?: boolean;
    participantLimit?: number | null;
    supervisorNames?: string[];
    room_id?: string;
    room?: { id: string; name: string; color?: string | null };
  }>;
  unclaimedGroups: Array<{
    id: string;
    name: string;
    room?: { name: string };
  }>;
  currentStaff: { id: string } | null;
  educationalGroups: Array<{
    id: string;
    name: string;
    room?: { name: string };
  }>;
  firstRoomVisits: Array<{
    studentId: string;
    studentName: string;
    schoolClass: string;
    groupName: string;
    activeGroupId: string;
    checkInTime: string;
    actualArrivalTime?: string;
    actualPickupTime?: string;
    isActive: boolean;
    sick?: boolean;
    sickSince?: string;
    excused?: boolean;
    excusedSince?: string;
    class_trip?: boolean;
    class_trip_since?: string;
    // Übergabe nach dem Unterricht (#4794).
    classHandover?: studentsContract.ClassHandover;
    // Authenticated proxy URL — backend rewrites the raw /uploads path
    // to /api/students/{id}/photo/{filename} before sending it down.
    photoUrl?: string;
  }>;
  firstRoomId: string | null;
  schulhofStatus: SchulhofStatusResponse | null;
  // Every permanently released room with its full occupancy (#3065). Optional
  // so a cached payload from an older backend degrades to "no shared rooms"
  // instead of breaking the page.
  openRooms?: OpenRoomView[];
  capabilities?: {
    webSpontaneousActivitiesEnabled: boolean;
  };
  // Plan windows of today's running sessions for tab labels (#2265);
  // optional so a cached older BFF payload degrades to name-only labels
  activeSessions?: Array<{
    activeGroupId: string;
    instanceId: string;
    title: string;
    startTime: string;
    endTime: string;
  }>;
  plannedNow: PlannedTimetableInstance[];
  // Folded-in sections of the selected session (#2096): the aggregate
  // resolves group_id (or the first supervised session) and ships its
  // visits, tracking indicators, and pickup/arrival times in the same
  // response. Optional so a cached payload from an older backend degrades
  // gracefully instead of breaking the page.
  selectedGroupId?: string | null;
  trackingIndicators?: TrackingIndicatorsResponse;
  pickupTimes?: Array<{
    studentId: string;
    date: string;
    weekdayName: string;
    pickupTime: string | null;
    isException: boolean;
    /** The Abholart set for today only (#3946). */
    dayDepartureMode?: DepartureMode;
    notes: string;
    dayNotes: Array<{ id: string; content: string }>;
  }>;
  // Hinweise der Lehrkraft für heute (#4795), je Kind.
  teacherHints?: Array<{ studentId: string } & TeacherHint>;
  arrivalTimes?: Array<{
    studentId: string;
    date: string;
    weekdayName: string;
    expectedArrival: string | null;
    isException: boolean;
    notes: string;
    dayNotes: Array<{ id: string; content: string }>;
  }>;
}

export async function fetchSupervisionDashboard(
  requestedGroupId: string | null,
): Promise<BFFDashboardResponse> {
  logger.debug("SWR fetching dashboard data");
  const start = performance.now();

  // The catalog proxy reads the session cookie and checks the answer
  // against the contract (#7563). No silent fallback fan-out (#2096): a
  // failed aggregate is an error, never a partial-empty payload — admins
  // included.
  const fetchDashboard = (groupId: string | null) =>
    bffJson("tenant", "GET /api/active/supervision-dashboard", {
      query: {
        group_id:
          groupId && /^[1-9]\d{0,18}$/.test(groupId) ? groupId : undefined,
      },
      errorMessage: "BFF request failed",
    });

  let data;
  try {
    data = await fetchDashboard(requestedGroupId);
  } catch (error) {
    // A stale selection (supervision revoked, session ended) is a backend
    // 403 — retry once without group_id so the backend resolves the
    // caller's first supervised session; the selection effects then
    // re-align from the response.
    if (!(
      error instanceof ApiError &&
      error.status === 403 &&
      requestedGroupId
    ))
      throw error;
    data = await fetchDashboard(null);
  }

  logger.debug("SWR fetch complete", {
    duration_ms: Math.round(performance.now() - start),
  });
  return mapSupervisionDashboard(data);
}
