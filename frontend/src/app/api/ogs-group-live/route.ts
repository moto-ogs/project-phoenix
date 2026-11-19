// Temporary (#2352): the client reads the OGS group live projection (#2056)
// from /api/students/ogs-group-live through the staff portal's catalog proxy
// since this release; the answer is unchanged. This path stays for an open
// tab or an installed app with an older bundle. Delete this file after the
// next production deploy.
import type { NextRequest } from "next/server";
import { apiGet } from "~/lib/api-helpers.server";
import { createGetHandler } from "~/lib/route-wrapper.server";
import type { OgsGroupLiveWireResponse } from "~/lib/ogs-group-live-api";

export const GET = createGetHandler<OgsGroupLiveWireResponse>(
  async (request: NextRequest, token: string) => {
    const groupId = request.nextUrl.searchParams.get("group_id");
    const query = groupId ? `?group_id=${encodeURIComponent(groupId)}` : "";
    const response = await apiGet<{ data: OgsGroupLiveWireResponse }>(
      `/api/students/ogs-group-live${query}`,
      token,
    );
    return response.data;
  },
);
