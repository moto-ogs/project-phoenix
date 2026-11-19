// app/api/displays/[id]/regenerate/route.ts — mint a new display token
//
// Temporary (#7563): the current client reads POST
// /api/display/{id}/regenerate through the portal's catalog proxy. An
// installed bundle of the previous release still calls this path and reads
// `{token}` inside this route's envelope. Delete this file after the next
// production deploy.
import { apiPost } from "~/lib/api-helpers.server";
import { unwrapEnvelope } from "~/lib/backend-client.server";
import type { InfoDisplayTokenResponse } from "~/lib/contract/display.generated";
import { createPostHandler } from "~/lib/route-wrapper.server";

export const POST = createPostHandler<InfoDisplayTokenResponse, undefined>(
  async (_request, _body, token, params) => {
    const id = params.id;
    if (typeof id !== "string" || !/^\d+$/.test(id)) {
      throw new Error("invalid display id");
    }
    const response = await apiPost<unknown>(
      `/api/display/${encodeURIComponent(id)}/regenerate`,
      token,
    );
    return unwrapEnvelope<InfoDisplayTokenResponse>(response);
  },
);
