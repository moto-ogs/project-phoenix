import { createParentJsonProxy } from "~/lib/parent/route-wrapper.server";

/**
 * Temporary (#2352): the current client forgets a device at
 * `/api/parent/me/mfa/trusted-devices/{id}`, the backend path, through the
 * parents portal's catalog proxy. This file stays one release for an
 * installed app with an older bundle that still calls this path; delete it
 * after the next production deploy.
 */
export const DELETE = createParentJsonProxy({
  method: "DELETE",
  path: (_request, params) =>
    `/parent/me/mfa/trusted-devices/${encodeURIComponent(String(params.id))}`,
});
