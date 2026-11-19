// Temporary (#2352): the client calls /api/auth/invitations/… through the
// staff portal's catalog proxy now. This file serves bundles built before
// that change for one production deploy; delete it afterwards, together with
// its test.
import type { NextRequest } from "next/server";
import { apiPost } from "~/lib/api-helpers.server";
import { createPostHandler } from "~/lib/route-wrapper.server";

export const POST = createPostHandler<null, Record<string, never>>(
  async (
    _request: NextRequest,
    _body: Record<string, never>,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const rawId = params.id ?? params.invitationId;
    if (typeof rawId !== "string" && typeof rawId !== "number") {
      throw new TypeError("Missing invitation id");
    }

    const invitationId = String(rawId);
    await apiPost(
      `/auth/invitations/${encodeURIComponent(invitationId)}/resend`,
      token,
    );
    return null;
  },
);
