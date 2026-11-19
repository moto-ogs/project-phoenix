import { bffJson } from "~/lib/bff-fetch";
import {
  mapCourseWaitlists,
  type CourseWaitlist,
  type CourseWaitlistWire,
} from "~/lib/course-waitlist-helpers";

/**
 * Liest die Wartelisten der AGs (#4767). Mit `activityGroupId` nur die eine
 * AG. Fehler laufen als ApiError zum Aufrufer, der sie über den Fehlerweg zeigt.
 *
 * Die Antwort kommt in der Form des Vertrags über den Katalog-Proxy (#7563).
 */
export async function fetchCourseWaitlists(
  activityGroupId?: string,
): Promise<CourseWaitlist[]> {
  const query = activityGroupId
    ? `?activity_group_id=${encodeURIComponent(activityGroupId)}`
    : "";
  const waitlists = await bffJson<CourseWaitlistWire[] | null>(
    `/api/students/offering-change-requests/course-waitlists${query}`,
  );
  return mapCourseWaitlists(waitlists ?? []);
}
