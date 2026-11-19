// Temporary (#7563): the operator client calls GET /api/operator/schools/{id}/pwa-usage
// through the operator portal's catalog proxy since #2352, which checks the
// answer against the contract. This /provisioning/ path stays for an open tab
// with an older bundle; delete the file after the next production deploy.
import type { NextRequest } from "next/server";
import {
  createOperatorGetHandler,
  operatorApiGet,
} from "~/lib/operator/route-wrapper.server";
import {
  encodePathSegment,
  requireStringParam,
} from "~/lib/route-wrapper-utils.server";

export const GET = createOperatorGetHandler(
  async (_request: NextRequest, token: string, params) => {
    const id = requireStringParam(params, "id");
    const schoolId = encodePathSegment(id);
    return await operatorApiGet(
      `/operator/schools/${schoolId}/pwa-usage`,
      token,
    );
  },
);
