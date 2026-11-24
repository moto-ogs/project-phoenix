// Client-side API for the staff "Erinnerungen" page (issue #1457).
// Visual-only reminders — no sound. The backend computes the list from
// schedules already in the system; the frontend renders and badge-counts it.

import { bffJson } from "./bff-fetch";
import type * as remindersContract from "./contract/reminders.generated";
import { shellResourceKeys } from "./swr/shell-keys";

export type ReminderType =
  | "pickup_upcoming"
  | "pickup_overdue"
  | "activity_start"
  | "activity_overdue"
  | "activity_running_over";

/** A reminder of the list; `minutes_away` is negative when overdue, and
 * `pickup_due_count` (activity_running_over only) counts children still in
 * the block's room whose pickup time has been reached (#4765). */
export type Reminder = Omit<remindersContract.StaffReminder, "type"> & {
  type: ReminderType;
};

/**
 * `enabled`: the tenant has at least one reminder type on; it decides whether
 * the header bell renders at all. `next_change_at`: the soonest moment the
 * list changes by time passing ("HH:MM" today, an RFC 3339 instant for a later
 * day); absent when nothing time-based is pending.
 */
export type RemindersResult = Omit<remindersContract.Result, "reminders"> & {
  reminders: Reminder[];
};

// Shared SWR key so the page and the header bell badge dedupe to one request.
export const REMINDERS_SWR_KEY = shellResourceKeys.reminders();

export function toRemindersResult(
  result: remindersContract.Result,
): RemindersResult {
  return {
    ...result,
    // The backend writes the types listed above; Go writes no list as null.
    reminders: (result.reminders ?? []) as Reminder[],
  };
}

export async function fetchReminders(): Promise<RemindersResult> {
  return toRemindersResult(await bffJson("tenant", "GET /api/reminders/"));
}
