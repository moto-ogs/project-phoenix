// app/api/displays/[id]/route.ts — update/delete one info-point display
//
// Temporary (#7563): the current client reads PATCH and DELETE
// /api/display/{id} through the portal's catalog proxy. An installed bundle
// of the previous release still calls this path and reads `{display}` and
// `{deleted}` inside this route's envelope. Delete this file after the next
// production deploy.
import { apiPatch, apiDelete } from "~/lib/api-helpers.server";
import { unwrapEnvelope } from "~/lib/backend-client.server";
import type { InfoDisplayResponse } from "~/lib/contract/display.generated";
import {
  createPatchHandler,
  createDeleteHandler,
} from "~/lib/route-wrapper.server";

interface DisplayUpdateRequest {
  name?: string;
  is_active?: boolean;
}

interface DisplayUpdateResponse {
  display: InfoDisplayResponse;
}

function requireDisplayID(params: Record<string, unknown>): string {
  const id = params.id;
  if (typeof id !== "string" || !/^\d+$/.test(id)) {
    throw new Error("invalid display id");
  }
  return id;
}

export const PATCH = createPatchHandler<
  DisplayUpdateResponse,
  DisplayUpdateRequest
>(async (_request, body, token, params) => {
  const id = requireDisplayID(params);
  const response = await apiPatch<unknown, DisplayUpdateRequest>(
    `/api/display/${encodeURIComponent(id)}`,
    token,
    body,
  );
  return { display: unwrapEnvelope<InfoDisplayResponse>(response) };
});

export const DELETE = createDeleteHandler(async (_request, token, params) => {
  const id = requireDisplayID(params);
  await apiDelete(`/api/display/${encodeURIComponent(id)}`, token);
  return { deleted: true };
});
