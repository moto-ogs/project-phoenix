// app/api/staff/externals/[id]/invitation/route.ts
//
// Temporary (#7563): the contract registers POST
// /api/staff/externals/{id}/invitation, and the current client reads the
// contract record. Bundles built before #7563 read the flat fields this file
// used to build and call this same path, so it answers the contract record
// with those fields beside it for one production deploy. Delete it after the
// next production deploy, together with its test; the portal's catch-all then
// answers the path.
import type { NextRequest } from "next/server";
import { contractWrite } from "~/lib/contract/client.server";
import {
  routes,
  type ExternalInvitationRequest,
} from "~/lib/contract/staff.generated";
import { createPostHandler } from "~/lib/route-wrapper.server";
import { requireNumericParam } from "~/lib/route-wrapper-utils.server";
import { withLegacyStaffFields } from "~/lib/staff-route-mapping";

const INVITE = routes["POST /api/staff/externals/{id}/invitation"];

/**
 * Handler for POST /api/staff/externals/[id]/invitation
 * Invites an external caregiver who has no account yet (#4573). The id is
 * the staff id as a decimal string; anything else answers 400 here, as the
 * backend would.
 */
export const POST = createPostHandler<
  ReturnType<typeof withLegacyStaffFields>,
  ExternalInvitationRequest
>(async (_request: NextRequest, body, token, params) => {
  const id = requireNumericParam(params, "id");
  const result = await contractWrite(
    INVITE,
    `/api/staff/externals/${id}/invitation`,
    token,
    body,
  );
  if (!result.ok) throw result.error.cause;
  return withLegacyStaffFields(result.value.data);
});
