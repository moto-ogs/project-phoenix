// lib/ogs-group-live-api.ts
// Client for the aggregated OGS group live projection (#2056).
// GET /api/students/ogs-group-live returns everything the OGS-Gruppen page renders for
// one supervised group in a single backend request. The wire DTO is minimal by
// contract — it must never grow personal fields the page does not display.
import { ApiError } from "~/lib/api-error";
import type { TrackingIndicatorsResponse } from "~/lib/active-helpers";
import { bffJson } from "~/lib/bff-fetch";
import { isPositiveInt64Id } from "~/lib/compare-ids";
import { knownEnum } from "~/lib/contract/known-enum";
import type * as studentsContract from "~/lib/contract/students.generated";
import type { DepartureMode } from "~/lib/departure-plan";

const DEPARTURE_MODES: readonly DepartureMode[] = [
  "alone",
  "bus",
  "pickup",
  "accompanied",
];

export interface GroupTransfer {
  substitutionId: string;
  groupId: string;
  targetStaffId: string;
  targetName: string;
  validUntil: string;
}

// View model consumed by the OGS-Gruppen page

interface OgsLiveGroup {
  id: string;
  name: string;
  roomId?: string;
  roomName?: string;
  viaSubstitution: boolean;
  isPersonal: boolean;
}

/** Today's effective pickup info for one student (subset the cards render). */
export interface OgsPickupInfo {
  pickupTime?: string;
  isException: boolean;
  /** The Abholart set for today only (#3946); absent for the weekly plan. */
  dayDepartureMode?: DepartureMode;
  notes?: string;
  dayNotes: Array<{ id: string; content: string }>;
}

export interface OgsLiveViewData {
  groups: OgsLiveGroup[];
  /** The group the live sections below belong to; null when the caller
   *  supervises no groups at all. */
  groupId: string | null;
  students: studentsContract.Student[];
  roomStatus: Record<string, studentsContract.RoomStatus>;
  pickupTimes: Map<string, OgsPickupInfo>;
  trackingIndicators: TrackingIndicatorsResponse;
  transfers: GroupTransfer[];
}

/** Go writes an empty list as `null`; the cards read empty lists. */
function mapTrackingIndicators(
  wire: studentsContract.TrackingIndicators,
): TrackingIndicatorsResponse {
  return {
    labels: wire.labels ?? [],
    results: Object.fromEntries(
      Object.entries(wire.results ?? {}).map(([studentId, matched]) => [
        studentId,
        matched ?? [],
      ]),
    ),
  };
}

function isValidGroupId(groupId: string | null): groupId is string {
  return groupId !== null && isPositiveInt64Id(groupId);
}

export function mapOgsGroupLiveResponse(
  wire: studentsContract.Projection,
): OgsLiveViewData {
  const pickupTimes = new Map<string, OgsPickupInfo>();
  for (const pt of wire.pickup_times ?? []) {
    pickupTimes.set(pt.student_id, {
      pickupTime: pt.pickup_time,
      isException: pt.is_exception,
      // An Abholart this build does not know reads as the weekly plan's.
      dayDepartureMode: knownEnum(DEPARTURE_MODES, pt.day_departure_mode),
      notes: pt.notes,
      dayNotes: (pt.day_notes ?? []).map((note) => ({
        id: note.id,
        content: note.content,
      })),
    });
  }

  return {
    groups: (wire.groups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      roomId: group.room_id,
      roomName: group.room_name,
      viaSubstitution: group.via_substitution,
      isPersonal: group.is_personal,
    })),
    groupId: wire.group_id ?? null,
    students: wire.students ?? [],
    roomStatus: wire.room_status ?? {},
    pickupTimes,
    trackingIndicators: mapTrackingIndicators(wire.tracking_indicators),
    transfers: (wire.transfers ?? []).map((transfer) => ({
      substitutionId: transfer.id,
      groupId: transfer.group_id,
      targetStaffId: transfer.substitute_staff_id,
      targetName: transfer.substitute_name ?? "Unbekannt",
      validUntil: transfer.end_date,
    })),
  };
}

/**
 * Fetches the aggregated live view. When a specific group was requested and
 * the backend answers 403 (e.g. a stale localStorage group the user can no
 * longer view), one fallback request without group_id resolves the caller's
 * first visible group instead — the page then re-syncs its selection from
 * the returned groupId.
 */
export async function fetchOgsGroupLive(
  groupId: string | null,
): Promise<OgsLiveViewData> {
  // The route reads the session cookie; the browser holds no token (#5005).
  const load = (withGroupId: string | null) =>
    bffJson("tenant", "GET /api/students/ogs-group-live", {
      query: { group_id: withGroupId ?? undefined },
      errorMessage: "API error",
    });

  const requestedGroupId = isValidGroupId(groupId) ? groupId : null;
  let data;
  try {
    data = await load(requestedGroupId);
  } catch (error) {
    if (!(
      error instanceof ApiError &&
      error.status === 403 &&
      requestedGroupId
    ))
      throw error;
    data = await load(null);
  }
  return mapOgsGroupLiveResponse(data);
}
