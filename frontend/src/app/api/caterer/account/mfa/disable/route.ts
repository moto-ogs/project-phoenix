import { createCatererJsonProxy } from "~/lib/caterer/route-wrapper.server";
import { currentPasswordBody } from "~/lib/factor-routes.server";

/**
 * Temporary (#2352): the portal's catalog proxy answers this path once this
 * file is gone; the contract registers it. It stays one release for an
 * installed app with an older bundle, which sends `currentPassword`; the
 * current client sends the backend's `current_password`, which this file
 * passes on. Delete it after the next production deploy.
 */
export const POST = createCatererJsonProxy({
  method: "POST",
  path: "/caterer/account/mfa/disable",
  retry: { off: "a renewed session would send the current password twice" },
  mapJsonBody: currentPasswordBody,
});
