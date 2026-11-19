import { apiPost, problemResponse } from "~/lib/api-helpers.server";
import { tenant } from "~/lib/route-wrapper.server";

/**
 * Temporary (#2352): the contract registers `POST /auth/password` for the
 * staff portal. This file stays one release for an installed app with an
 * older bundle, which sends camelCase; the current client sends the
 * backend's snake_case, and both pass here. After the next production
 * deploy, replace it with a hand-off `auth/password/[[...path]]` to the
 * catalog proxy (Next gives `/api/auth/…` to Auth.js otherwise).
 */
interface PasswordChangeBody {
  current_password?: string;
  new_password?: string;
  confirm_password?: string;
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export const POST = tenant.post<unknown, PasswordChangeBody>(
  async (request, body, token) => {
    const currentPassword = body.current_password ?? body.currentPassword;
    const newPassword = body.new_password ?? body.newPassword;
    const confirmPassword = body.confirm_password ?? body.confirmPassword;
    if (!currentPassword || !newPassword || !confirmPassword) {
      return problemResponse(400, "all password fields are required", request);
    }
    if (newPassword !== confirmPassword) {
      return problemResponse(400, "new passwords do not match", request);
    }
    await apiPost("/auth/password", token, {
      current_password: currentPassword,
      new_password: newPassword,
      confirm_password: confirmPassword,
    });
    return { success: true };
  },
  { retry: { off: "a renewed session would send the current password twice" } },
);
