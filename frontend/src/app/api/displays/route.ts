// app/api/displays/route.ts — admin CRUD proxy for info-point displays
//
// Temporary (#7563): the current client reads GET and POST /api/display/
// through the portal's catalog proxy, where the backend answers in the shared
// envelope. An installed bundle of the previous release still calls this
// path and reads the bare list and `{display, token}` inside this route's
// envelope; this file hands both on unchanged. The screens' dashboard is not
// served here. Delete this file after the next production deploy.
import { apiGet, apiPost } from "~/lib/api-helpers.server";
import { unwrapEnvelope } from "~/lib/backend-client.server";
import type {
  InfoDisplayCreatedResponse,
  InfoDisplayResponse,
} from "~/lib/contract/display.generated";
import {
  createGetHandler,
  createPostHandler,
} from "~/lib/route-wrapper.server";

interface DisplayCreateRequest {
  name: string;
}

export const GET = createGetHandler(async (_request, token) => {
  const response = await apiGet<unknown>("/api/display", token);
  return unwrapEnvelope<InfoDisplayResponse[] | null>(response) ?? [];
});

export const POST = createPostHandler<
  InfoDisplayCreatedResponse,
  DisplayCreateRequest
>(async (_request, body, token) => {
  const response = await apiPost<unknown, DisplayCreateRequest>(
    "/api/display",
    token,
    { name: body.name },
  );
  return unwrapEnvelope<InfoDisplayCreatedResponse>(response);
});
