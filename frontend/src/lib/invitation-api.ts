import { bffJson, bffJsonUncontracted } from "~/lib/bff-fetch";
import type * as authInvitationsContract from "~/lib/contract/auth-invitations.generated";
import type {
  InvitationValidation,
  InvitationAcceptRequest,
  CreateInvitationRequest,
  PendingInvitation,
  FormerEmploymentAnswer,
} from "./invitation-helpers";
import {
  mapFormerEmploymentResponse,
  mapInvitationValidationResponse,
  mapPendingInvitationResponse,
  toCreateInvitationBody,
} from "./invitation-helpers";

export async function validateInvitation(
  token: string,
): Promise<InvitationValidation> {
  return mapInvitationValidationResponse(
    await bffJson("public", "GET /auth/invitations/{token}", {
      params: { token },
      errorMessage: "Einladung konnte nicht geprüft werden.",
    }),
  );
}

interface AcceptInvitationResult {
  /** Subdomain of the invitation's school — tenant hosts resolve by subdomain, not slug (#1977). */
  tenantSubdomain?: string;
}

export async function acceptInvitation(
  token: string,
  data: InvitationAcceptRequest,
): Promise<AcceptInvitationResult> {
  // A new account accepts without a session, an existing one with the
  // owner's: the route file decides by `existingAccount` and forwards the
  // backend's answer. No portal of the route's contract carries both, so
  // bff-fetch-uncontracted.test.ts names this caller.
  const result =
    await bffJsonUncontracted<authInvitationsContract.AcceptInvitationResponse>(
      "public",
      "POST",
      "/api/invitations/accept",
      {
        body: { token, ...data },
        errorMessage: "Einladung konnte nicht angenommen werden.",
      },
    );
  return { tenantSubdomain: result.tenant_subdomain || undefined };
}

export async function createInvitation(
  data: CreateInvitationRequest,
): Promise<PendingInvitation> {
  return mapPendingInvitationResponse(
    await bffJson("tenant", "POST /auth/invitations/", {
      body: toCreateInvitationBody(data),
      errorMessage: "Einladung konnte nicht erstellt werden.",
    }),
  );
}

/**
 * Asks whether an invitation to the address would continue a former
 * employment at this school; null when it would not, also for an address
 * without an account. The answer carries its version either way. The address
 * goes in the body, never into a URL.
 */
export async function findFormerEmployment(
  email: string,
  signal?: AbortSignal,
): Promise<FormerEmploymentAnswer> {
  const data = await bffJson(
    "tenant",
    "POST /auth/invitations/former-employment",
    {
      body: { email },
      signal,
      errorMessage: "Frühere Beschäftigung konnte nicht geprüft werden.",
    },
  );
  return {
    formerEmployment: mapFormerEmploymentResponse(data.former_employment),
    version: data.version,
  };
}

export async function listPendingInvitations(): Promise<PendingInvitation[]> {
  const rows = await bffJson("tenant", "GET /auth/invitations/", {
    errorMessage: "Offene Einladungen konnten nicht geladen werden.",
  });
  return rows.map(mapPendingInvitationResponse);
}

export async function resendInvitation(id: string): Promise<void> {
  await bffJson("tenant", "POST /auth/invitations/{id}/resend", {
    params: { id },
    errorMessage: "Einladung konnte nicht erneut gesendet werden.",
  });
}

export async function revokeInvitation(id: string): Promise<void> {
  await bffJson("tenant", "DELETE /auth/invitations/{id}/", {
    params: { id },
    errorMessage: "Einladung konnte nicht widerrufen werden.",
  });
}
