// Temporary (#7563): the current client calls the backend's own path
// /api/enrollment/admin/requests/{id}/children/{childId}/offering-adjustments through the
// portal's catalog proxy. An installed bundle of the previous release still
// calls this flattened path with request_id and child_id in the query; this file
// moves them into the path. Delete it after the next production deploy.
import { createTenantJsonProxy } from "~/lib/route-wrapper.server";
import { problemResponse } from "~/lib/api-helpers.server";

export const GET = createTenantJsonProxy({
  method: "GET",
  path: (request) => {
    const requestID = request.nextUrl.searchParams.get("request_id") ?? "";
    const childID = request.nextUrl.searchParams.get("child_id") ?? "";
    if (!requestID || !childID) {
      return problemResponse(
        400,
        "request_id and child_id are required",
        request,
      );
    }
    return `/api/enrollment/admin/requests/${encodeURIComponent(requestID)}/children/${encodeURIComponent(childID)}/offering-adjustments`;
  },
});
