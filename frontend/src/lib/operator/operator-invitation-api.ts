import { sessionBff } from "~/lib/session-bff";
import { bffJson } from "~/lib/bff-fetch";
import type * as operatorInvitationsContract from "~/lib/contract/operator-invitations.generated";
import type {
  CreateOperatorInvitationRequest,
  AcceptOperatorInvitationRequest,
  PendingOperatorInvitation,
  OperatorInfo,
  OperatorInvitationValidation,
} from "./operator-invitation-helpers";
import {
  mapPendingInvitation,
  mapOperatorInfo,
  mapInvitationValidation,
} from "./operator-invitation-helpers";
import { ApiError } from "~/lib/api-error";
import { createLogger } from "~/lib/logger";
import { OPERATOR_INVITATION_FLOW_HEADER } from "./operator-invitation-flow";

const logger = createLogger({ component: "OperatorInvitationApi" });

export interface OperatorInvitationsData {
  invitations: PendingOperatorInvitation[];
  operators: OperatorInfo[];
}

// --- Authenticated API functions ---

export async function createOperatorInvitation(
  data: CreateOperatorInvitationRequest,
): Promise<void> {
  // Convert camelCase frontend shape to the snake_case the backend expects.
  await bffJson("platform", "POST /operator/invitations/", {
    body: {
      email: data.email,
      display_name: data.displayName,
    } satisfies operatorInvitationsContract.CreateInvitationRequest,
  });
}

export async function listOperatorInvitations(): Promise<OperatorInvitationsData> {
  const raw = await bffJson("platform", "GET /operator/invitations/");
  // Go lists pointers; the contract types an entry nullable.
  return {
    invitations: (raw.invitations ?? [])
      .filter((entry) => entry !== null)
      .map(mapPendingInvitation),
    operators: (raw.operators ?? [])
      .filter((entry) => entry !== null)
      .map(mapOperatorInfo),
  };
}

export async function resendOperatorInvitation(id: string): Promise<void> {
  await bffJson("platform", "POST /operator/invitations/{id}/resend", {
    params: { id },
  });
}

export async function revokeOperatorInvitation(id: string): Promise<void> {
  await bffJson("platform", "DELETE /operator/invitations/{id}", {
    params: { id },
  });
}

export async function deactivateOperator(id: string): Promise<void> {
  await bffJson("platform", "POST /operator/operators/{id}/deactivate", {
    params: { id },
  });
}

export async function reactivateOperator(id: string): Promise<void> {
  await bffJson("platform", "POST /operator/operators/{id}/reactivate", {
    params: { id },
  });
}

// --- Public (unauthenticated) API functions ---

// The invitation flow's steps are BFF routes without a session (`public`):
// the first keeps the token in the flow's cookie, the others read it there,
// so the token never travels in a URL.

export async function establishOperatorInvitationSession(
  token: string,
): Promise<string> {
  const { flow_id } = await bffJson("public", sessionBff.startOperatorInvite, {
    body: { token },
    errorMessage: "Invitation session failed",
  });
  return flow_id;
}

export async function validateOperatorInvitation(
  flowID: string,
): Promise<OperatorInvitationValidation> {
  // The operator backend answers in the shared error envelope (#2507).
  return mapInvitationValidation(
    await bffJson("public", sessionBff.validateOperatorInvite, {
      body: {},
      headers: { [OPERATOR_INVITATION_FLOW_HEADER]: flowID },
      errorMessage: "Invitation validation failed",
    }),
  );
}

export async function acceptOperatorInvitation(
  flowID: string,
  data: AcceptOperatorInvitationRequest,
): Promise<void> {
  try {
    // Convert camelCase frontend shape to the snake_case the backend expects.
    await bffJson("public", sessionBff.acceptOperatorInvite, {
      body: {
        display_name: data.displayName,
        password: data.password,
        confirm_password: data.confirmPassword,
      },
      headers: { [OPERATOR_INVITATION_FLOW_HEADER]: flowID },
      errorMessage: "Invitation accept failed",
    });
  } catch (error) {
    if (error instanceof ApiError) {
      logger.warn("accept_invitation_failed", {
        status: error.status,
        code: error.code,
      });
    }
    throw error;
  }
}
