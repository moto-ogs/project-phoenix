import type { NextRequest } from "next/server";
import {
  createOperatorPostHandler,
  operatorApiPost,
} from "~/lib/operator/route-wrapper.server";

/**
 * Temporary (#2352): the operator portal's catalog proxy answers this path
 * once this file is gone; the contract registers it. It stays one release
 * for an installed app with an older bundle, which sends camelCase; the
 * current client sends the backend's snake_case. Delete it after the next
 * production deploy.
 */
interface ModalBody {
  currentPassword?: string;
  newPassword?: string;
  current_password?: string;
  new_password?: string;
}

interface BackendBody {
  current_password: string;
  new_password: string;
}

export const POST = createOperatorPostHandler<null, ModalBody>(
  async (_request: NextRequest, body: ModalBody, token: string) => {
    const backendBody: BackendBody = {
      current_password: body.current_password ?? body.currentPassword ?? "",
      new_password: body.new_password ?? body.newPassword ?? "",
    };
    return await operatorApiPost<null, BackendBody>(
      "/operator/profile/password",
      token,
      backendBody,
    );
  },
  { retry: { off: "a renewed session would send the current password twice" } },
);
