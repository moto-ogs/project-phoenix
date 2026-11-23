// lib/group-helpers.ts
// Type definitions and helper functions for groups

import { createLogger } from "~/lib/logger";
import type * as groupsContract from "~/lib/contract/groups.generated";

const logger = createLogger({ component: "GroupHelpers" });

export interface Group {
  id: string;
  name: string;
  room_id?: string;
  room_name?: string;
  representative_id?: string;
  representative_name?: string;
  representative?: {
    id: string;
    staffId: string;
    firstName: string;
    lastName: string;
    fullName: string;
  };
  student_count?: number;
  created_at?: string;
  updated_at?: string;
  supervisors?: Array<{ id: string; name: string }>;
  teacher_ids?: string[];
}

// Mapping functions
export function mapGroupResponse(
  backendGroup: groupsContract.GroupResponse,
): Group {
  // Create the basic group properties
  const group: Group = {
    id: backendGroup.id,
    name: backendGroup.name,
    room_id: backendGroup.room_id,
    // Extract room name from nested room object if available
    room_name: backendGroup.room?.name ?? undefined,
    representative_id: backendGroup.representative_id,
    representative_name: backendGroup.representative?.full_name ?? undefined,
    student_count: backendGroup.student_count,
    created_at: backendGroup.created_at,
    updated_at: backendGroup.updated_at,
  };

  // Map the representative if available
  if (backendGroup.representative) {
    group.representative = {
      id: backendGroup.representative.id,
      staffId: backendGroup.representative.staff_id,
      firstName: backendGroup.representative.first_name,
      lastName: backendGroup.representative.last_name,
      fullName: backendGroup.representative.full_name,
    };
  }

  // If the backend group has teachers, map them to supervisors
  if (Array.isArray(backendGroup.teachers)) {
    group.supervisors = backendGroup.teachers.map((teacher) => ({
      id: teacher.id,
      name: teacher.full_name,
    }));

    // Extract teacher IDs for form population
    group.teacher_ids = backendGroup.teachers.map((teacher) => teacher.id);
  }

  return group;
}

export function mapGroupsResponse(
  backendGroups: groupsContract.GroupResponse[],
): Group[] {
  // Safety check to ensure we have an array
  if (!Array.isArray(backendGroups)) {
    logger.error("expected array for backendGroups", {
      received: typeof backendGroups,
    });
    return [];
  }
  return backendGroups.map(mapGroupResponse);
}
