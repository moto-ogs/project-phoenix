// Temporary (#7563): the current client calls the backend's own path
// /api/enrollment/admin/requests/{id}/children/{childId}/offerings through the
// portal's catalog proxy. An installed bundle of the previous release still
// calls this flattened path with request_id and child_id in the body; this file
// moves them into the path. Delete it and its test after the next production deploy.
import { enrollmentChildPath } from "~/lib/enrollment-admin-child.server";
import { tenant } from "~/lib/route-wrapper.server";
import { parseRequestBody } from "~/lib/route-wrapper-utils.server";

interface UpdateOfferingsBody {
  request_id?: string | number;
  child_id?: string | number;
  offerings?: Array<{
    offering_id?: string | number;
    selected_days?: string[];
  }>;
  reason?: string;
  complete_withdrawal_confirmed?: boolean;
}

export const PUT = tenant.route(async (request) => {
  const body = await parseRequestBody<UpdateOfferingsBody>(request);
  return tenant.forwardToBackend(
    request,
    enrollmentChildPath(body, "offerings"),
    {
      method: "PUT",
      json: {
        offerings: body.offerings ?? [],
        reason: body.reason ?? "",
        complete_withdrawal_confirmed:
          body.complete_withdrawal_confirmed === true,
      },
    },
  );
});
