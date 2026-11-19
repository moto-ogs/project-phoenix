// Temporary (#7563): the operator client calls POST /api/operator/unregistered-tag-scans/{id}/resolve
// through the operator portal's catalog proxy since #2352, which checks the
// answer against the contract. This /provisioning/ path stays for an open tab
// with an older bundle; delete the file after the next production deploy.
import type { NextRequest } from "next/server";
import {
  createOperatorPostHandler,
  operatorApiPost,
} from "~/lib/operator/route-wrapper.server";
import {
  encodePathSegment,
  requireStringParam,
} from "~/lib/route-wrapper-utils.server";

export const POST = createOperatorPostHandler(
  async (
    _request: NextRequest,
    body: unknown,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const id = requireStringParam(params, "id");
    const scanId = encodePathSegment(id);
    return await operatorApiPost(
      `/operator/unregistered-tag-scans/${scanId}/resolve`,
      token,
      body,
    );
  },
);
