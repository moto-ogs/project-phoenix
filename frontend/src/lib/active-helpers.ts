// lib/active-helpers.ts
// Type definitions for active entities

import type {
  ActiveGroupResponse,
  SchulhofStatusResponse,
  SupervisorResponse,
  VisitResponse,
} from "~/lib/contract/active.generated";

// Tracking indicators response from POST /api/active/tracking-indicators
export interface TrackingIndicatorsResponse {
  labels: string[];
  results: Record<string, boolean[]>; // student_id → [matched1, matched2, ...]
}

// Wire types: the decoded responses of the catalog proxy (#2353).
export type ActiveGroupWire = ActiveGroupResponse;
export type VisitWire = VisitResponse;
export type SupervisorWire = SupervisorResponse;
export type SchulhofStatusWire = SchulhofStatusResponse;

// Frontend types
// groupId: string | null — mirrors the nullable backend contract (WP-B6).
// A null value means the session is spontaneous (no parent template).
export interface ActiveGroup {
  id: string;
  groupId: string | null;
  roomId: string;
  startTime: Date;
  endTime?: Date;
  isActive: boolean;
  visitCount?: number;
  supervisorCount?: number;
  room?: {
    id: string;
    name: string;
    color?: string;
  };
  /**
   * The activity the session runs. Go sends no name with a session (#2353);
   * the check-in target resolves it from the activity list.
   */
  actualGroup?: {
    id: string;
    name: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface Visit {
  id: string;
  studentId: string;
  activeGroupId: string;
  checkInTime: Date;
  checkOutTime?: Date;
  isActive: boolean;
  studentName?: string;
  activeGroupName?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Supervisor {
  id: string;
  staffId: string;
  activeGroupId: string;
  startTime: Date;
  endTime?: Date;
  isActive: boolean;
  staffName?: string;
  activeGroupName?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Transformation functions
export function mapActiveGroupResponse(
  backendActiveGroup: ActiveGroupWire,
): ActiveGroup {
  return {
    id: backendActiveGroup.id,
    // null: a spontaneous session without a parent template (WP-B6).
    groupId: backendActiveGroup.group_id,
    roomId: backendActiveGroup.room_id,
    startTime: new Date(backendActiveGroup.start_time),
    endTime: backendActiveGroup.end_time
      ? new Date(backendActiveGroup.end_time)
      : undefined,
    isActive: backendActiveGroup.is_active,
    visitCount: backendActiveGroup.visit_count,
    supervisorCount: backendActiveGroup.supervisor_count,
    room: backendActiveGroup.room,
    createdAt: new Date(backendActiveGroup.created_at),
    updatedAt: new Date(backendActiveGroup.updated_at),
  };
}

export function mapVisitResponse(backendVisit: VisitWire): Visit {
  return {
    id: backendVisit.id,
    studentId: backendVisit.student_id,
    activeGroupId: backendVisit.active_group_id,
    checkInTime: new Date(backendVisit.check_in_time),
    checkOutTime: backendVisit.check_out_time
      ? new Date(backendVisit.check_out_time)
      : undefined,
    isActive: backendVisit.is_active,
    studentName: backendVisit.student_name,
    activeGroupName: backendVisit.active_group_name,
    createdAt: new Date(backendVisit.created_at),
    updatedAt: new Date(backendVisit.updated_at),
  };
}

export function mapSupervisorResponse(
  backendSupervisor: SupervisorWire,
): Supervisor {
  return {
    id: backendSupervisor.id,
    staffId: backendSupervisor.staff_id,
    activeGroupId: backendSupervisor.active_group_id,
    startTime: new Date(backendSupervisor.start_time),
    endTime: backendSupervisor.end_time
      ? new Date(backendSupervisor.end_time)
      : undefined,
    isActive: backendSupervisor.is_active,
    staffName: backendSupervisor.staff_name,
    activeGroupName: backendSupervisor.active_group_name,
    createdAt: new Date(backendSupervisor.created_at),
    updatedAt: new Date(backendSupervisor.updated_at),
  };
}

// Schulhof (schoolyard) status for the permanent tab
export interface SchulhofStatus {
  exists: boolean;
  roomId: string | null;
  roomName: string;
  activityGroupId: string | null;
  activeGroupId: string | null;
  isUserSupervising: boolean;
  supervisionId: string | null;
  supervisorCount: number;
  studentCount: number;
  supervisors: SchulhofSupervisor[];
}

interface SchulhofSupervisor {
  id: string;
  staffId: string;
  name: string;
  isCurrentUser: boolean;
}

export function mapSchulhofStatusResponse(
  backend: SchulhofStatusWire,
): SchulhofStatus {
  return {
    exists: backend.exists,
    roomId: backend.room_id ?? null,
    roomName: backend.room_name,
    activityGroupId: backend.activity_group_id ?? null,
    activeGroupId: backend.active_group_id ?? null,
    isUserSupervising: backend.is_user_supervising,
    supervisionId: backend.supervision_id ?? null,
    supervisorCount: backend.supervisor_count,
    studentCount: backend.student_count,
    supervisors: (backend.supervisors ?? []).map((sup) => ({
      id: sup.id,
      staffId: sup.staff_id,
      name: sup.name,
      isCurrentUser: sup.is_current_user,
    })),
  };
}
