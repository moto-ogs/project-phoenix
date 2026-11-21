// lib/substitution-helpers.ts
// Type definitions and helper functions for substitutions

import { toISODate } from "~/lib/date-helpers";
import { knownEnum } from "~/lib/contract/known-enum";
import type {
  GroupHandover,
  RunningSupervision as RunningSupervisionWire,
  StaffRef,
  SubstitutionOverviewResult,
} from "~/lib/contract/substitutions.generated";
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

export interface SubstitutionProxyEnvelope<T> {
  data?: T;
}

export function unwrapSubstitutionProxyEnvelope<T>(
  envelope: SubstitutionProxyEnvelope<T>,
): T {
  if (envelope.data === undefined) {
    throw new Error("Ungültige Antwort für Gruppenübergaben.");
  }
  return envelope.data;
}

/** The kinds of assignment POST /api/substitutions answers (#2352). */
export type SubstitutionAssignmentKind =
  "group_handover" | "additional_supervision" | "schedule_substitution";

/**
 * The result of an assignment. The backend names its shape in `type` and
 * carries the result under the member of that name (#2352). A body without
 * that member is not an answer of the kind the caller asked for.
 */
export function substitutionAssignmentResult<T>(
  data: unknown,
  kind: SubstitutionAssignmentKind,
): T {
  const member =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)[kind]
      : undefined;
  if (member === undefined || member === null) {
    throw new Error("Ungültige Antwort für Gruppenübergaben.");
  }
  return member as T;
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

export interface TeacherAvailability {
  id: string;
  firstName: string;
  lastName: string;
  regularGroup?: string;
  role?: string;
  inSubstitution: boolean;
  substitutionCount: number;
  teacherId?: string;
  specialization?: string;
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

export function mapSubstitutionsResponse(
  backendSubstitutions: readonly GroupHandover[] | null,
): Substitution[] {
  return (backendSubstitutions ?? []).map(mapSubstitutionResponse);
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
  backend: RunningSupervisionWire,
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
    groupHandovers: mapSubstitutionsResponse(backend.group_handovers),
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
  group_handover: {
    group_id: string;
    target_staff_id: string;
    start_date: string;
    end_date: string;
  };
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

// Helper functions
export function formatDateForBackend(date: Date): string {
  return toISODate(date); // YYYY-MM-DD format
}
