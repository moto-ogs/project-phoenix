// app/api/activities/categories/[id]/restore/route.ts
//
// Temporary (#7563): the contract registers POST /api/activities/categories/{categoryId}/restore, and the
// current client reads the contract's shape through the catalog proxy. An
// installed bundle of the previous release reads the shape this file maps.
// Delete this file after the next production deploy; the portal's catch-all
// then answers the path.
import type { ActivityCategoryResponse } from "~/lib/contract/activities.generated";
import type { NextRequest } from "next/server";
import { apiPost } from "~/lib/api-helpers.server";
import { createPostHandler } from "~/lib/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { mapActivityCategoryResponse } from "~/lib/activity-helpers";
import type { ActivityCategory } from "~/lib/activity-helpers";

/**
 * Handler for POST /api/activities/categories/[id]/restore
 * Brings an archived category back into the pickers. The backend rejects the
 * restore with a 409 when an active category has taken the name meanwhile.
 */
export const POST = createPostHandler<ActivityCategory, unknown>(
  async (_request: NextRequest, _body: unknown, token: string, params) => {
    const response = await apiPost<{ data: ActivityCategoryResponse }>(
      `/api/activities/categories/${requirePathSegmentParam(params)}/restore`,
      token,
    );
    return mapActivityCategoryResponse(response.data);
  },
);
