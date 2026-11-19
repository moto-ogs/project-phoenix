// app/api/staff/externals/route.ts
//
// Temporary (#7563): the contract registers POST /api/staff/externals, and
// the current client reads the contract record. Bundles built before #7563
// read the flat fields this file used to build and call this same path, so it
// answers the contract record with those fields beside it for one production
// deploy. Delete it after the next production deploy, together with its
// test; the portal's catch-all then answers the path.
import type { NextRequest } from "next/server";
import { contractWrite } from "~/lib/contract/client.server";
import {
  routes,
  type ExternalStaffRequest,
} from "~/lib/contract/staff.generated";
import { createPostHandler } from "~/lib/route-wrapper.server";
import { withLegacyStaffFields } from "~/lib/staff-route-mapping";

const CREATE = routes["POST /api/staff/externals"];

/**
 * Handler for POST /api/staff/externals
 * Records an external caregiver (#3823) with the chosen access (ADR 0091).
 * The backend validates names, access, address and gender.
 */
export const POST = createPostHandler<
  ReturnType<typeof withLegacyStaffFields>,
  ExternalStaffRequest
>(async (_request: NextRequest, body, token) => {
  const result = await contractWrite(
    CREATE,
    "/api/staff/externals",
    token,
    body,
  );
  if (!result.ok) throw result.error.cause;
  return withLegacyStaffFields(result.value.data);
});
