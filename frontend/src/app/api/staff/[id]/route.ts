// app/api/staff/[id]/route.ts
//
// Temporary (#7563): the contract registers GET, PUT and DELETE
// /api/staff/{id}, and the current client reads the contract record. Bundles
// built before #7563 read the flat fields this file used to build and call
// this same path, so GET and PUT answer the contract record with those fields
// beside it (`withLegacyStaffFields`) for one production deploy. DELETE
// answers the same either way and goes to the catalog proxy. Delete this file
// after the next production deploy, together with its test; the portal's
// catch-all then answers the path, and the hand-off files beside it
// (`by-role`, `dashboard-summary`, …) can go with it.
import type { NextRequest } from "next/server";
import { contractGet, contractWrite } from "~/lib/contract/client.server";
import { portalRoutes } from "~/lib/contract/portals.generated";
import { routes, type StaffRequest } from "~/lib/contract/staff.generated";
import { withPrivateNoStore } from "~/lib/private-no-store";
import {
  catalogProxy,
  createGetHandler,
  createPutHandler,
} from "~/lib/route-wrapper.server";
import { requirePathSegmentParam } from "~/lib/route-wrapper-utils.server";
import { withLegacyStaffFields } from "~/lib/staff-route-mapping";

const READ = routes["GET /api/staff/{id}"];
const UPDATE = routes["PUT /api/staff/{id}"];

function staffPath(params: Record<string, unknown>) {
  return `/api/staff/${requirePathSegmentParam(params, "id")}`;
}

/** Handler for GET /api/staff/[id]: one staff record. */
export const GET = createGetHandler(
  async (_request: NextRequest, token, params) => {
    const result = await contractGet(
      `${READ.method} ${READ.pattern}`,
      READ.response,
      staffPath(params),
      token,
    );
    if (!result.ok) throw result.error.cause;
    return withLegacyStaffFields(result.value.data);
  },
);

/** Handler for PUT /api/staff/[id]: forwards the body; the backend trims it. */
export const PUT = createPutHandler<
  ReturnType<typeof withLegacyStaffFields>,
  StaffRequest
>(async (_request: NextRequest, body, token, params) => {
  const result = await contractWrite(UPDATE, staffPath(params), token, body);
  if (!result.ok) throw result.error.cause;
  return withLegacyStaffFields(result.value.data);
});

const remove = catalogProxy(portalRoutes.tenant, "DELETE");

/** DELETE /api/staff/[id] goes to the catalog proxy with the catch-all's path. */
export const DELETE = withPrivateNoStore(
  (request: NextRequest, context: { params: Promise<{ id: string }> }) =>
    remove(request, {
      params: context.params.then(({ id }) => ({ path: ["staff", id] })),
    }),
);
