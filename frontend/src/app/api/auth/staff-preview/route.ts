import { invalidJsonResponse } from "~/lib/route-wrapper-utils.server";
import { tenantPortal } from "~/server/auth";
import { sessionMutationOriginError } from "~/server/auth/same-origin";
import {
  handleApiError,
  problemResponse,
} from "~/lib/api-response-error.server";
import { contractWrite } from "~/lib/contract/client.server";
import { contractError } from "~/lib/contract/route-response.server";
import {
  routes,
  type StaffPreviewStartRequest,
} from "~/lib/contract/auth-staff-preview.generated";
import { tenant } from "~/lib/route-wrapper.server";
import { successResponse } from "~/lib/route-wrapper-utils.server";
import { installMintedSession } from "~/lib/session-transition.server";
import type { StaffPreviewReply } from "~/lib/session-bff";

export const POST = tenantPortal.withAuth(async (request) => {
  const originError = sessionMutationOriginError(request);
  if (originError) return originError;
  if ((await tenantPortal.auth())?.user?.isPreview)
    return problemResponse(409, "A preview is already running", request);
  let body: StaffPreviewStartRequest;
  try {
    body = await request.json();
  } catch {
    return invalidJsonResponse(request);
  }
  try {
    const reply = await contractWrite(
      routes["POST /auth/staff-preview"],
      body,
      {
        send: (path, call) =>
          tenant.backendFetch(request, path, {
            ...call,
            retry: {
              off: "its 401 names why the preview is refused, like the school switch",
            },
          }),
      },
    );
    if (!reply.ok) return contractError(reply, request);
    const preview = reply.value;
    const failure = await installMintedSession(
      request,
      () =>
        tenantPortal.setStaffPreviewSession({
          accessToken: preview.access_token,
          expiresIn: preview.expires_in,
          targetAccountId: preview.target_account_id,
          targetName: preview.target_name,
        }),
      () =>
        contractWrite(
          routes["POST /auth/staff-preview/end"],
          { preview_token: preview.access_token },
          { request, timeout: "session" },
        ),
    );
    if (failure) return failure;
    // Explicit allowlist: no backend token or newly added backend field.
    return Response.json(
      successResponse<StaffPreviewReply>({
        expires_in: preview.expires_in,
        target_account_id: preview.target_account_id,
        target_name: preview.target_name,
      }),
    );
  } catch (error) {
    return handleApiError(error, request);
  }
});
