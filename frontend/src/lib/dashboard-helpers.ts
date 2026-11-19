import type { DashboardAnalyticsResponse } from "./contract/active.generated";

// Dashboard Analytics Types
export interface DashboardAnalytics {
  // Student Overview
  studentsPresent: number;
  studentsInTransit: number; // Students present but not in any active visit
  studentsOnPlayground: number;
  studentsInRooms: number; // Students in indoor rooms (excluding playground)
  studentsSick: number; // Students currently flagged as sick
  studentsExcused: number; // Students currently flagged as excused
  /**
   * Active students who are neither checked in nor covered by an absence
   * status. The backend derives it as the remainder of the other buckets
   * (see calculateStudentsHome in services/active/analytics_service.go), so
   * this tile and the Krank/Entschuldigt tiles do not double count. Children
   * counted in studentsAtSchool or studentsInClass are not in it.
   */
  studentsHome: number;
  /** Expected students before their first check-in of the day (#3260). */
  studentsAtSchool: number;
  /** Checked out to class and not back yet (#5656). */
  studentsInClass: number;

  // Activities & Rooms
  activeActivities: number;
  totalRooms: number;
  capacityUtilization: number;
  activityCategories: number;

  // OGS Groups
  activeOGSGroups: number;
  studentsInGroupRooms: number;
  supervisorsToday: number;
  studentsInHomeRoom: number;

  // Recent Activity (Privacy-compliant)
  recentActivity: RecentActivity[];

  // Current Activities (No personal data)
  currentActivities: CurrentActivity[];

  // Active Groups Summary
  activeGroupsSummary: ActiveGroupInfo[];

  // Timestamp
  lastUpdated: Date;
}

interface RecentActivity {
  type: "check_in" | "check_out" | "group_start" | "group_end";
  groupName: string;
  roomName: string;
  count: number;
  timestamp: Date;
}

interface CurrentActivity {
  id: string;
  name: string;
  category: string;
  participants: number;
  maxCapacity: number | null;
  status: "active" | "full" | "ending_soon" | "overbooked";
}

interface ActiveGroupInfo {
  name: string;
  type: "ogs_group" | "activity";
  studentCount: number;
  /** Teilnehmergrenze der Aktivität; null ohne Grenze (#3634). */
  maxCapacity?: number | null;
  location: string;
  status: "active" | "transitioning" | "preparing";
}

// The backend's answer is the contract's DashboardAnalyticsResponse. Its
// free_rooms is deliberately not mapped: the "Freie Räume" StatCard was
// dropped from the dashboard, and nothing else consumed the number.
export type { DashboardAnalyticsResponse } from "./contract/active.generated";
// Mapping function
export function mapDashboardAnalyticsResponse(
  data: DashboardAnalyticsResponse,
): DashboardAnalytics {
  return {
    studentsPresent: data.students_present,
    studentsInTransit: data.students_in_transit,
    studentsOnPlayground: data.students_on_playground,
    studentsInRooms: data.students_in_rooms,
    studentsSick: data.students_sick ?? 0,
    studentsExcused: data.students_excused ?? 0,
    studentsHome: data.students_home ?? 0,
    studentsAtSchool: data.students_at_school ?? 0,
    studentsInClass: data.students_in_class ?? 0,
    activeActivities: data.active_activities,
    totalRooms: data.total_rooms,
    capacityUtilization: data.capacity_utilization,
    activityCategories: data.activity_categories,
    activeOGSGroups: data.active_ogs_groups,
    studentsInGroupRooms: data.students_in_group_rooms,
    supervisorsToday: data.supervisors_today,
    studentsInHomeRoom: data.students_in_home_room,
    recentActivity: (data.recent_activity ?? []).map((activity) => ({
      type: activity.type as RecentActivity["type"],
      groupName: activity.group_name,
      roomName: activity.room_name,
      count: activity.count,
      timestamp: new Date(activity.timestamp),
    })),
    currentActivities: (data.current_activities ?? []).map((activity) => ({
      id: activity.id,
      name: activity.name,
      category: activity.category,
      participants: activity.participants,
      maxCapacity: activity.max_capacity,
      status: activity.status as CurrentActivity["status"],
    })),
    activeGroupsSummary: (data.active_groups_summary ?? []).map((group) => ({
      name: group.name,
      type: group.type as ActiveGroupInfo["type"],
      studentCount: group.student_count,
      maxCapacity: group.max_capacity ?? null,
      location: group.location,
      status: group.status as ActiveGroupInfo["status"],
    })),
    lastUpdated: new Date(data.last_updated),
  };
}

// Helper functions for formatting
export function formatRecentActivityTime(timestamp: Date | string): string {
  const now = new Date();
  const timestampDate =
    typeof timestamp === "string" ? new Date(timestamp) : timestamp;

  // Check if the date is valid
  if (Number.isNaN(timestampDate.getTime())) {
    return "Unbekannt";
  }

  const diffMinutes = Math.floor(
    (now.getTime() - timestampDate.getTime()) / 60000,
  );

  if (diffMinutes < 1) return "gerade eben";
  if (diffMinutes < 60) return `vor ${diffMinutes} min`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `vor ${diffHours} Std.`;

  return timestampDate.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function getActivityStatusColor(
  status: CurrentActivity["status"],
): string {
  switch (status) {
    case "active":
      return "bg-moto-green";
    case "full":
      return "bg-moto-amber";
    case "ending_soon":
      return "bg-moto-orange";
    case "overbooked":
      return "bg-moto-red";
    default:
      // Unbekannt = LOCATION_COLORS.UNKNOWN (#78716C)
      return "bg-moto-stone";
  }
}

export function getGroupStatusColor(status: ActiveGroupInfo["status"]): string {
  switch (status) {
    case "active":
      return "bg-moto-green";
    case "transitioning":
      return "bg-moto-amber";
    case "preparing":
      return "bg-moto-blue";
    default:
      // Unbekannt = LOCATION_COLORS.UNKNOWN (#78716C)
      return "bg-moto-stone";
  }
}
