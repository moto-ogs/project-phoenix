import { createCatererJsonProxy } from "~/lib/caterer/route-wrapper.server";

interface PasswordChangeBody {
  current_password?: string;
  new_password?: string;
  confirm_password?: string;
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

/**
 * The caterer changes its own password (#4496). A wrong current password
 * comes back as 401 with its own code and stays on the form. The client IP
 * and user agent go along for the backend's rate limit, account lock and
 * audit.
 *
 * Temporary (#2352): the caterer portal's catalog proxy answers this path
 * once this file is gone; the contract registers it. It stays one release
 * for an installed app with an older bundle, which sends camelCase; the
 * current client sends the backend's snake_case, which this file passes on.
 * Delete it after the next production deploy.
 */
export const POST = createCatererJsonProxy({
  method: "POST",
  path: "/caterer/account/password",
  retry: { off: "a renewed session would send the current password twice" },
  mapJsonBody: (body) => {
    const fields = body as PasswordChangeBody;
    return {
      current_password: fields.current_password ?? fields.currentPassword ?? "",
      new_password: fields.new_password ?? fields.newPassword ?? "",
      confirm_password: fields.confirm_password ?? fields.confirmPassword ?? "",
    };
  },
});
