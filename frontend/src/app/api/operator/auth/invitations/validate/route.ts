import { contractWrite } from "~/lib/contract/client.server";
import { contractResponse } from "~/lib/contract/route-response.server";
import {
  routes,
  type ValidateInvitationRequest,
} from "~/lib/contract/operator-auth.generated";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { handleApiError } from "~/lib/api-response-error.server";
import type { NextRequest } from "next/server";
import { operatorJsonErrors } from "~/lib/operator/route-wrapper.server";
import { operatorInvitationToken } from "~/lib/operator/operator-invitation-session.server";

/**
 * Public: the invitation token travels in the body, taken from the
 * invitation flow's cookie, never in the URL.
 */
export const POST = withPrivateNoStore(async (request: NextRequest) => {
  let body: ValidateInvitationRequest;
  try {
    body = {
      ...(await request.json()),
      token: operatorInvitationToken(request),
    };
  } catch {
    return operatorJsonErrors.invalidJsonResponse(request);
  }
  try {
    const reply = await contractWrite(
      routes["POST /operator/auth/invitations/validate"],
      body,
      { request },
    );
    const response = contractResponse(reply, request);
    return response;
  } catch (error) {
    return handleApiError(error, request);
  }
});
