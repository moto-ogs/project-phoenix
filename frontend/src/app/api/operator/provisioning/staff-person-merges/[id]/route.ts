// Temporary (#7563): the operator client calls GET and POST /api/operator/staff-person-merges/{id}
// through the operator portal's catalog proxy since #2352, which checks the
// answer against the contract. This /provisioning/ path stays for an open tab
// with an older bundle; delete the file after the next production deploy.
import type { NextRequest } from "next/server";
import {
  createOperatorGetHandler,
  createOperatorPostHandler,
  isStringParam,
  operatorApiGet,
  operatorApiPost,
} from "~/lib/operator/route-wrapper.server";
import { encodePathSegment } from "~/lib/route-wrapper-utils.server";

export const GET = createOperatorGetHandler(
  async (_request: NextRequest, token: string, params) => {
    if (!isStringParam(params.id)) throw new Error("Invalid school ID");
    return operatorApiGet(
      `/operator/staff-person-merges/${encodePathSegment(params.id)}`,
      token,
    );
  },
);
export const POST = createOperatorPostHandler(
  async (_request: NextRequest, body: unknown, token: string, params) => {
    if (!isStringParam(params.id)) throw new Error("Invalid school ID");
    return operatorApiPost(
      `/operator/staff-person-merges/${encodePathSegment(params.id)}`,
      token,
      body,
    );
  },
);
