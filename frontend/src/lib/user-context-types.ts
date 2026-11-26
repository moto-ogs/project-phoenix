interface Staff {
  id: string;
  personId: string;
}

/** Values of guardians.parent_invite_mode. */
export type ParentInviteMode = "disabled" | "direct" | "staff_approval";

/**
 * School settings the signed-in app shell reads outside the settings page
 * (#4996). They ride on the navigation context, never on the public tenant
 * resolve.
 */
export interface SchoolSwitches {
  /** operations.parent_news_enabled */
  parentNewsEnabled: boolean;
  /** guardians.parent_invite_mode; undefined for a value the client does not know */
  parentInviteMode: ParentInviteMode | undefined;
  /** timetable.day_start_time / day_end_time, "HH:MM" */
  timetableDayStartTime: string;
  timetableDayEndTime: string;
}

export interface UserContextResponse {
  currentStaff: Staff | null;
  schoolSwitches: SchoolSwitches;
}
