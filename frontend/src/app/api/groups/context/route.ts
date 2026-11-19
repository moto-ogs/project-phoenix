// Temporary (#7563): the current client reads
// GET /api/students/ogs-group-navigation through the portal's catalog proxy.
// An installed bundle of the previous release still calls this path and
// reads the groups under `groups`. Delete this file and its test after the
// next production deploy.
import { createGetHandler } from "~/lib/route-wrapper.server";
import { apiGet } from "~/lib/api-helpers.server";

interface GroupsApiResponse {
  data: Array<{
    id: string;
    name: string;
    room_id?: string;
    room_name?: string;
    via_substitution: boolean;
    is_personal: boolean;
    leaders?: string[];
  }>;
}

/** Load the educational groups visible in the tenant portal navigation. */
export const GET = createGetHandler(async (_request, token) => {
  const response = await apiGet<GroupsApiResponse>(
    "/api/students/ogs-group-navigation",
    token,
  );

  return { groups: response.data };
});
