// Temporary (#2352): the client calls /api/auth/invitations/… through the
// staff portal's catalog proxy now. This file serves bundles built before
// that change for one production deploy; delete it afterwards, together with
// its test.
import type { NextRequest } from "next/server";
import { apiDelete } from "~/lib/api-helpers.server";
import { createDeleteHandler } from "~/lib/route-wrapper.server";

export const DELETE = createDeleteHandler<null>(
  async (
    _request: NextRequest,
    token: string,
    params: Record<string, unknown>,
  ) => {
    const rawId = params.id ?? params.invitationId;
    if (typeof rawId !== "string" && typeof rawId !== "number") {
      throw new TypeError("Missing invitation id");
    }

    const invitationId = String(rawId);
    await apiDelete(
      `/auth/invitations/${encodeURIComponent(invitationId)}`,
      token,
    );
    return null;
  },
);
