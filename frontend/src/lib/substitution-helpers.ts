// lib/substitution-helpers.ts
// Type definitions and helper functions for substitutions

import { ApiError } from "~/lib/api-error";
import { knownEnum } from "~/lib/contract/known-enum";
import type {
  SubstitutionAssignmentResponse,
  GroupHandover,
  StaffRef,
  SubstitutionOverviewResult,
} from "~/lib/contract/substitutions.generated";
import type * as substitutionsContract from "~/lib/contract/substitutions.generated";
import type { ExternalAccountStatus } from "~/lib/staff-api";
import { EXTERNAL_ACCOUNT_STATUS_VALUES } from "~/lib/staff-wire-enums";

interface SupervisionStaffRef {
  id: string;
  fullName: string;
  isExternal?: true;
  /** Organisation der externen Kraft (#4573); fehlt, wenn leer. */
  externalOrganization?: string;
  /** Kontostand der externen Kraft (#4573); fehlt bei allen anderen. */
  externalAccountStatus?: ExternalAccountStatus;
}

export interface RunningSupervision {
  id: string;
  name: string;
  roomName?: string;
  supervisors: SupervisionStaffRef[];
  /**
   * isExternal: externe Kraft (#3823), mit jedem Zugang einteilbar
   * (ADR 0091). Vertretungen bieten keine Externen an.
   */
  availableTargets: SupervisionStaffRef[];
  isCurrentUserSupervising: boolean;
  canAssign: boolean;
}

export interface SubstitutionOverview {
  groups: Array<{ id: string; name: string }>;
  groupHandovers: Substitution[];
  targets: Array<{ id: string; fullName: string }>;
  runningSupervisions: RunningSupervision[];
}

export interface ScheduleSubstitutionOverview {
  appointments: Array<{
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    title: string;
    status: string;
    staff: Array<{
      assignmentId: string;
      id: string;
      name: string;
      isAbsent: boolean;
      isSubstitute: boolean;
      canEnd: boolean;
    }>;
  }>;
  staff: Array<{ id: string; name: string; isExternal: boolean }>;
}

/** The kinds of assignment POST /api/substitutions answers (#2352). */
type SubstitutionAssignmentKind =
  "group_handover" | "additional_supervision" | "schedule_substitution";

/**
 * The result of an assignment. The backend names its shape in `type` and
 * carries the result under the member of that name (#2352). An answer
 * without that member is not one of the kind the caller asked for.
 */
export function substitutionAssignmentResult<
  K extends SubstitutionAssignmentKind,
>(
  answer: SubstitutionAssignmentResponse,
  kind: K,
): NonNullable<SubstitutionAssignmentResponse[K]> {
  const member = answer[kind];
  if (member === undefined || member === null) {
    throw new ApiError(`substitution answer without ${kind}`, 502);
  }
  return member as NonNullable<SubstitutionAssignmentResponse[K]>;
}

// Frontend types
export interface Substitution {
  id: string;
  type: "group_handover";
  groupId: string;
  groupName: string;
  substituteStaffId: string;
  substituteStaffName: string;
  startDate: string;
  endDate: string;
  canEnd: boolean;
}

// Mapping functions
export function mapSubstitutionResponse(
  backend: Pick<
    GroupHandover,
    "id" | "group" | "target" | "period" | "can_end"
  >,
): Substitution {
  return {
    id: backend.id,
    type: "group_handover",
    groupId: backend.group.id,
    groupName: backend.group.name,
    substituteStaffId: backend.target.id,
    substituteStaffName: backend.target.full_name,
    startDate: backend.period.start_date,
    endDate: backend.period.end_date,
    canEnd: backend.can_end,
  };
}

function mapSupervisionStaffRef(staff: StaffRef): SupervisionStaffRef {
  const accountStatus = knownEnum(
    EXTERNAL_ACCOUNT_STATUS_VALUES,
    staff.external_account_status,
  );
  return {
    id: staff.id,
    fullName: staff.full_name,
    ...(staff.is_external ? { isExternal: true as const } : {}),
    ...(staff.is_external && staff.external_organization
      ? { externalOrganization: staff.external_organization }
      : {}),
    ...(staff.is_external && accountStatus
      ? { externalAccountStatus: accountStatus }
      : {}),
  };
}

export function mapRunningSupervision(
  backend: substitutionsContract.RunningSupervision,
): RunningSupervision {
  return {
    id: backend.id,
    name: backend.name,
    roomName: backend.room_name,
    supervisors: (backend.supervisors ?? []).map(mapSupervisionStaffRef),
    availableTargets: (backend.available_targets ?? []).map(
      mapSupervisionStaffRef,
    ),
    isCurrentUserSupervising: backend.is_current_user_supervising,
    canAssign: backend.can_assign,
  };
}

// Go writes an empty list as null; a malformed answer never gets here, the
// catalog proxy refuses it (502).
export function mapSubstitutionOverview(
  backend: SubstitutionOverviewResult,
): SubstitutionOverview {
  return {
    groups: (backend.groups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
    })),
    groupHandovers: (backend.group_handovers ?? []).map(
      mapSubstitutionResponse,
    ),
    targets: (backend.targets ?? []).map((staff) => ({
      id: staff.id,
      fullName: staff.full_name,
    })),
    runningSupervisions: (backend.running_supervisions ?? []).map(
      mapRunningSupervision,
    ),
  };
}

export function mapScheduleSubstitutionOverview(
  backend: SubstitutionOverviewResult,
): ScheduleSubstitutionOverview {
  return {
    appointments: (backend.schedule_appointments ?? []).map((appointment) => ({
      id: appointment.id,
      date: appointment.date,
      startTime: appointment.start_time,
      endTime: appointment.end_time,
      title: appointment.title,
      status: appointment.status,
      staff: (appointment.staff ?? []).map((row) => ({
        assignmentId: row.assignment_id,
        id: row.staff.id,
        name: row.staff.full_name,
        isAbsent: row.is_absent,
        isSubstitute: row.is_substitute,
        canEnd: row.can_end,
      })),
    })),
    staff: (backend.schedule_targets ?? []).map((member) => ({
      id: member.id,
      name: member.full_name,
      isExternal: member.is_external === true,
    })),
  };
}

// Prepare frontend types for backend
export interface CreateSubstitutionRequest {
  type: "group_handover";
  group_handover: Required<substitutionsContract.groupHandoverRequest>;
}

export function prepareSubstitutionForBackend(
  groupId: string,
  substituteStaffId: string,
  startDate: string,
  endDate: string,
): CreateSubstitutionRequest {
  return {
    type: "group_handover",
    group_handover: {
      group_id: groupId,
      target_staff_id: substituteStaffId,
      start_date: startDate,
      end_date: endDate,
    },
  };
}
