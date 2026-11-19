/**
 * Temporary (#7563): GET and PUT /api/absence-types/{id}/allowances/{staffId}
 * are registered in the contract, and the current client reaches them through
 * the portal's catalog proxy; the backend refuses a read without a year with
 * 400. An installed bundle of the previous release still calls this path and
 * reads the same `data` from this route's envelope. Delete this file after
 * the next production deploy.
 */
import type { NextRequest } from "next/server";

import { apiGet } from "~/lib/api-helpers.server";
import { createGetHandler, proxyPut } from "~/lib/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";

function backendPath(params: Record<string, unknown>): string {
  const typeId = requirePathSegmentParam(params, "absenceTypeId");
  const staffId = requirePathSegmentParam(params, "staffId");
  return `/api/absence-types/${typeId}/allowances/${staffId}`;
}

export const GET = createGetHandler(
  async (
    request: NextRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const year = request.nextUrl.searchParams.get("year");
    if (!year) throw new Error("year is required");
    const response = await apiGet<{ data: unknown }>(
      `${backendPath(params)}?year=${encodeURIComponent(year)}`,
      token,
    );
    return response.data;
  },
);

export const PUT = proxyPut<unknown, unknown>(backendPath);
