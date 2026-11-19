import { bffJson } from "~/lib/bff-fetch";
import { CONTRACT_WIRE } from "~/lib/contract/wire";
import {
  mapCourseWaitlists,
  type CourseWaitlist,
  type CourseWaitlistWire,
} from "~/lib/course-waitlist-helpers";

/**
 * Liest die Wartelisten der AGs (#4767). Mit `activityGroupId` nur die eine
 * AG. Fehler laufen als ApiError zum Aufrufer, der sie über den Fehlerweg zeigt.
 *
 * Die Antwort kommt in der Form des Vertrags über den Katalog-Proxy (#7563);
 * der Kopf aus lib/contract/wire fragt sie bei der befristeten Routendatei an.
 */
export async function fetchCourseWaitlists(
  activityGroupId?: string,
): Promise<CourseWaitlist[]> {
  const query = activityGroupId
    ? `?activity_group_id=${encodeURIComponent(activityGroupId)}`
    : "";
  const waitlists = await bffJson<CourseWaitlistWire[] | null>(
    `/api/students/offering-change-requests/course-waitlists${query}`,
    { headers: CONTRACT_WIRE },
  );
  return mapCourseWaitlists(waitlists ?? []);
}
