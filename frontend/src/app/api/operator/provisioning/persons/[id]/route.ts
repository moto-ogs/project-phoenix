// Temporary (#2352): the operator client calls DELETE /api/operator/persons/{id}
// through the operator portal's catalog proxy, which the contract serves.
// This path stays for an open tab with an older bundle; delete the file
// after the next production deploy.
import type { NextRequest } from "next/server";
import {
  createOperatorDeleteHandler,
  operatorApiDelete,
} from "~/lib/operator/route-wrapper.server";
import {
  encodePathSegment,
  requireStringParam,
} from "~/lib/route-wrapper-utils.server";

export const DELETE = createOperatorDeleteHandler(
  async (_request: NextRequest, token: string, params) => {
    const id = requireStringParam(params, "id");
    const personId = encodePathSegment(id);
    return await operatorApiDelete(`/operator/persons/${personId}`, token);
  },
);
