import { bffJson } from "~/lib/bff-fetch";
/**
 * Siblings from separate holiday registrations (#5628): the Träger-Büro
 * merges registrations of one period as siblings, and splits them again.
 * The Elternabrechnung ranks the children of a group together. Kept apart
 * from the contribution client, so the registration page does not load it.
 */

import type * as traegerHolidayContributionsContract from "./contract/traeger-holiday-contributions.generated";

export interface HolidaySiblingGroup {
  readonly id: string;
  readonly registrationIds: readonly string[];
}

function groupFromBackend(
  group: traegerHolidayContributionsContract.HolidaySiblingGroup,
): HolidaySiblingGroup {
  return { id: group.id, registrationIds: group.registration_ids ?? [] };
}

/** The sibling groups of the period, by registration number. */
export async function fetchHolidaySiblingGroups(
  periodId: string,
): Promise<HolidaySiblingGroup[]> {
  const groups = await bffJson(
    "org",
    "GET /traeger/holiday-contributions/{periodId}/sibling-groups",
    { params: { periodId } },
  );
  return groups.map(groupFromBackend);
}

/**
 * Merges the registrations, with the groups they already belong to, into
 * one sibling group.
 */
export async function mergeHolidaySiblings(
  periodId: string,
  registrationIds: readonly string[],
): Promise<HolidaySiblingGroup> {
  return groupFromBackend(
    await bffJson(
      "org",
      "POST /traeger/holiday-contributions/{periodId}/sibling-groups",
      {
        params: { periodId },
        body: {
          registration_ids: [...registrationIds],
        } satisfies traegerHolidayContributionsContract.HolidaySiblingMergeRequest,
      },
    ),
  );
}

/** Takes the registration out of its sibling group. */
export async function splitHolidaySibling(
  periodId: string,
  registrationId: string,
): Promise<void> {
  await bffJson(
    "org",
    "DELETE /traeger/holiday-contributions/{periodId}/sibling-groups/registrations/{registrationId}",
    { params: { periodId, registrationId } },
  );
}
