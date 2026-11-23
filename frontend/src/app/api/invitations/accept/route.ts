import { captureBffException } from "~/lib/sentry-bff.server";
import type { NextRequest } from "next/server";
import { contractWrite } from "~/lib/contract/client.server";
import { contractResponse } from "~/lib/contract/route-response.server";
import { routes } from "~/lib/contract/auth-invitations.generated";
import { createLogger } from "~/lib/logger";
import { withInvitationOwnerSession } from "~/lib/invitation-owner-session.server";
import { problemResponse } from "~/lib/api-helpers.server";
import { withPrivateNoStore } from "~/lib/private-no-store";

const logger = createLogger({ component: "InvitationAcceptRoute" });

interface AcceptInvitationBody {
  existingAccount?: boolean;
  token?: string;
  firstName?: string;
  lastName?: string;
  password: string;
  confirmPassword: string;
}

async function POSTHandler(request: NextRequest) {
  try {
    // NextAuth reconstructs the original request when resolving the owner session.
    let body: AcceptInvitationBody;
    try {
      body = (await request.clone().json()) as AcceptInvitationBody;
    } catch {
      return problemResponse(400, "Invalid JSON", request);
    }
    if (!body.token) {
      return problemResponse(400, "Missing invitation token", request);
    }

    const { token, ...rest } = body;
    const payload = {
      first_name: rest.firstName,
      last_name: rest.lastName,
      password: rest.password,
      confirm_password: rest.confirmPassword,
    };

    const forward = async (ownerToken?: string) => {
      const reply = await contractWrite(
        routes["POST /auth/invitations/{token}/accept"],
        payload,
        {
          endpoint: `/auth/invitations/${encodeURIComponent(token)}/accept`,
          token: ownerToken,
          request,
        },
      );
      return contractResponse(reply, request);
    };
    return body.existingAccount
      ? await withInvitationOwnerSession(request, forward)
      : await forward();
  } catch (error) {
    captureBffException(error, request);
    logger.error("invitation accept failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return problemResponse(500, "Internal Server Error", request);
  }
}

export const POST = withPrivateNoStore(POSTHandler);
