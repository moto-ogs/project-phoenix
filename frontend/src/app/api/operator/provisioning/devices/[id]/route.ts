// Temporary (#2352): the operator client calls DELETE /api/operator/devices/{id}
// through the operator portal's catalog proxy, which the contract serves.
// This path stays for an open tab with an older bundle; delete the file
// after the next production deploy.
import type { NextRequest } from "next/server";
import {
  createOperatorDeleteHandler,
  operatorApiDelete,
} from "~/lib/operator/route-wrapper.server";

export const DELETE = createOperatorDeleteHandler(
  async (
    _request: NextRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    return await operatorApiDelete(
      `/operator/devices/${encodeURIComponent(String(params.id))}`,
      token,
    );
  },
);
