import { contractWrite } from "~/lib/contract/client.server";
import { contractResponse } from "~/lib/contract/route-response.server";
import {
  routes,
  type OperatorAcceptInvitationRequest,
} from "~/lib/contract/operator-auth.generated";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { handleApiError } from "~/lib/api-response-error.server";
import type { NextRequest } from "next/server";
import { operatorJsonErrors } from "~/lib/operator/route-wrapper.server";
import {
  operatorInvitationCookieName,
  operatorInvitationCookieOptions,
  operatorInvitationFlowID,
  operatorInvitationToken,
} from "~/lib/operator/operator-invitation-session.server";

/**
 * Public: the invitation token travels in the body, taken from the
 * invitation flow's cookie, never in the URL. An accepted invitation ends
 * that cookie.
 */
export const POST = withPrivateNoStore(async (request: NextRequest) => {
  let body: OperatorAcceptInvitationRequest;
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
      routes["POST /operator/auth/invitations/accept"],
      body,
      { request },
    );
    const response = contractResponse(reply, request);
    if (reply.backend?.ok) {
      response.cookies.set(
        operatorInvitationCookieName(operatorInvitationFlowID(request)),
        "",
        { ...operatorInvitationCookieOptions, maxAge: 0 },
      );
    }
    return response;
  } catch (error) {
    return handleApiError(error, request);
  }
});
