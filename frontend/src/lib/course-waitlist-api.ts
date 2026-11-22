import { bffJson } from "~/lib/bff-fetch";
import {
  mapCourseWaitlists,
  type CourseWaitlist,
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
  const waitlists = await bffJson(
    "tenant",
    "GET /api/students/offering-change-requests/course-waitlists",
    { query: { activity_group_id: activityGroupId || undefined } },
  );
  return mapCourseWaitlists(waitlists);
}
