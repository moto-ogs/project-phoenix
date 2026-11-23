// lib/active-service.ts
import { ApiError } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "ActiveService" });
import {
  mapActiveGroupResponse,
  mapVisitResponse,
  mapSupervisorResponse,
  mapSchulhofStatusResponse,
  type ActiveGroup,
  type Visit,
  type Supervisor,
  type SchulhofStatus,
  type TrackingIndicatorsResponse,
} from "./active-helpers";
import type * as active from "./contract/active.generated";

/** The decoded result with its lists present; Go always sends them (#2353). */
type WithLists<T, K extends keyof T> = Omit<T, K> & {
  [P in K]-?: NonNullable<T[P]>;
};

type TransitAssignResult = WithLists<
  active.TransitAssignResult,
  "assigned" | "skipped"
>;

export type StudentMoveResult = WithLists<
  active.StudentMoveResult,
  "moved" | "unchanged" | "skipped"
>;

function transitAssignResult(
  wire: active.TransitAssignResult,
): TransitAssignResult {
  return {
    ...wire,
    assigned: wire.assigned ?? [],
    skipped: wire.skipped ?? [],
  };
}

function studentMoveResult(wire: active.StudentMoveResult): StudentMoveResult {
  return {
    ...wire,
    moved: wire.moved ?? [],
    unchanged: wire.unchanged ?? [],
    skipped: wire.skipped ?? [],
  };
}

export interface StudentMoveSummary {
  successCount: number;
  notPresentCount: number;
  otherSkippedCount: number;
}

export function summarizeStudentMoveResult(
  result: StudentMoveResult,
): StudentMoveSummary {
  const notPresentCount = result.skipped.filter(
    (item) => item.reason === "not_present",
  ).length;
  return {
    successCount: result.moved.length + result.unchanged.length,
    notPresentCount,
    otherSkippedCount: result.skipped.length - notPresentCount,
  };
}

/** Labels and per-student matches; Go sends both, never null (#2353). */
function trackingIndicators(
  wire: active.TrackingIndicatorsResponse,
): TrackingIndicatorsResponse {
  const results: Record<string, boolean[]> = {};
  for (const [studentId, matches] of Object.entries(wire.results ?? {})) {
    results[studentId] = matches ?? [];
  }
  return { labels: wire.labels ?? [], results };
}

/** A failed call is logged under its operation and rethrown. */
async function logged<T>(operation: string, call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    logger.error("proxy fetch failed", {
      operation,
      status: error instanceof ApiError ? error.status : undefined,
      code: error instanceof ApiError ? error.code : undefined,
    });
    throw error;
  }
}

export const activeService = {
  // Active Groups
  getActiveGroups: async (filters?: {
    active?: boolean;
  }): Promise<ActiveGroup[]> => {
    const groups = await logged(
      "Get active groups",
      bffJson("tenant", "GET /api/active/groups/", {
        query: { active: filters?.active },
      }),
    );
    return groups.map(mapActiveGroupResponse);
  },

  getActiveGroupSupervisors: async (id: string): Promise<Supervisor[]> => {
    const supervisors = await logged(
      "Get active group supervisors",
      bffJson("tenant", "GET /api/active/groups/{id}/supervisors", {
        params: { id },
      }),
    );
    return supervisors.map(mapSupervisorResponse);
  },

  // Visits
  getVisits: async (filters?: {
    active?: boolean;
    activeGroupIds?: readonly string[];
  }): Promise<Visit[]> => {
    const visits = await logged(
      "Get visits",
      bffJson("tenant", "GET /api/active/visits/", {
        query: {
          active: filters?.active,
          active_group_ids: filters?.activeGroupIds?.length
            ? filters.activeGroupIds.join(",")
            : undefined,
        },
      }),
    );
    return visits.map(mapVisitResponse);
  },

  getStaffActiveSupervisions: async (
    staffId: string,
  ): Promise<Supervisor[]> => {
    const supervisions = await logged(
      "Get staff active supervisions",
      bffJson("tenant", "GET /api/active/supervisors/staff/{staffId}/active", {
        params: { staffId },
      }),
    );
    return supervisions.map(mapSupervisorResponse);
  },

  /** The ended supervision; null when the backend could not read it back. */
  endSupervision: async (id: string): Promise<Supervisor | null> => {
    const supervisor = await logged(
      "End supervision",
      bffJson("tenant", "POST /api/active/supervisors/{id}/end", {
        params: { id },
      }),
    );
    return supervisor ? mapSupervisorResponse(supervisor) : null;
  },

  claimActiveGroup: async (groupId: string): Promise<void> => {
    await logged(
      "Claim group",
      bffJson("tenant", "POST /api/active/groups/{id}/claim", {
        params: { id: groupId },
      }),
    );
  },

  assignTransitStudents: async (
    studentIds: string[],
    activeGroupId: string,
  ): Promise<TransitAssignResult> => {
    return transitAssignResult(
      await logged(
        "Assign transit students",
        bffJson("tenant", "POST /api/active/visits/transit/assign", {
          body: {
            student_ids: [...studentIds],
            active_group_id: activeGroupId,
          },
        }),
      ),
    );
  },

  moveStudentsToActiveGroup: async (
    studentIds: string[],
    activeGroupId: string,
  ): Promise<StudentMoveResult> => {
    return studentMoveResult(
      await logged(
        "Move students to active group",
        bffJson("tenant", "POST /api/active/visits/move-to-group", {
          body: {
            student_ids: [...studentIds],
            target_active_group_id: activeGroupId,
          },
        }),
      ),
    );
  },

  /**
   * Records that the children now use a released room (#3066): an independent
   * room stay, not participation in an activity running there. Rejects with an
   * ApiError whose `code` is `rooms.not_released` when the release was removed
   * after the room list was loaded, or a full room's code and details.
   */
  moveStudentsToOpenRoom: async (
    studentIds: string[],
    roomId: string,
  ): Promise<StudentMoveResult> => {
    return studentMoveResult(
      await logged(
        "Move students to open room",
        bffJson("tenant", "POST /api/active/visits/move-to-room", {
          body: { student_ids: [...studentIds], target_room_id: roomId },
        }),
      ),
    );
  },

  /**
   * Checks the children in to the school and places them in a running
   * session in one step (#6953). Children already present move under the
   * ordinary move rules.
   */
  checkInStudentsToActiveGroup: async (
    studentIds: string[],
    activeGroupId: string,
    keepPresent: boolean,
  ): Promise<StudentMoveResult> => {
    return studentMoveResult(
      await logged(
        "Check students in to active group",
        bffJson("tenant", "POST /api/active/visits/check-in-to-group", {
          body: {
            student_ids: [...studentIds],
            target_active_group_id: activeGroupId,
            keep_present: keepPresent,
          },
        }),
      ),
    );
  },

  /**
   * Checks the children in to the school and records a stay in a released
   * room in one step (#6953). Rejects like moveStudentsToOpenRoom.
   */
  checkInStudentsToOpenRoom: async (
    studentIds: string[],
    roomId: string,
    keepPresent: boolean,
  ): Promise<StudentMoveResult> => {
    return studentMoveResult(
      await logged(
        "Check students in to open room",
        bffJson("tenant", "POST /api/active/visits/check-in-to-room", {
          body: {
            student_ids: [...studentIds],
            target_room_id: roomId,
            keep_present: keepPresent,
          },
        }),
      ),
    );
  },

  // Schulhof (Schoolyard) - Permanent Tab Functions

  /**
   * Get the current Schulhof status including room info, supervisors, and student count.
   */
  getSchulhofStatus: async (): Promise<SchulhofStatus> => {
    return mapSchulhofStatusResponse(
      await logged(
        "Get Schulhof status",
        bffJson("tenant", "GET /api/active/schulhof/status"),
      ),
    );
  },

  /**
   * Fetch tracking indicators for a set of students.
   * Returns configured labels and per-student match results (boolean array aligned with labels).
   * Returns empty labels/results when the feature is disabled or no labels are configured.
   */
  getTrackingIndicators: async (
    studentIds: string[],
  ): Promise<TrackingIndicatorsResponse> => {
    const empty: TrackingIndicatorsResponse = { labels: [], results: {} };
    if (studentIds.length === 0) return empty;
    try {
      return trackingIndicators(
        await bffJson("tenant", "POST /api/active/tracking-indicators", {
          body: { student_ids: [...studentIds] },
        }),
      );
    } catch (error) {
      // Bewusst still: die Markierungen sind eine Zusatzinfo; ohne sie zeigt
      // die Liste die Kinder unverändert.
      logger.warn("tracking_indicators_fetch_failed", {
        status: error instanceof ApiError ? error.status : undefined,
      });
      return empty;
    }
  },
};
