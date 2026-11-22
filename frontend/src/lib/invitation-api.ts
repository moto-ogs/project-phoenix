import { transportFetch } from "~/lib/api-error";
import { buildApiError } from "~/lib/api-error-response";
import { bffJson } from "~/lib/bff-fetch";
import type {
  InvitationValidation,
  InvitationAcceptRequest,
  CreateInvitationRequest,
  PendingInvitation,
  FormerEmployment,
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
  const response = await transportFetch("/api/invitations/accept", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, ...data }),
  });

  if (!response.ok) {
    throw await buildApiError(
      response,
      "Einladung konnte nicht angenommen werden.",
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const result = (raw.data ?? raw) as Record<string, unknown>;
  return {
    tenantSubdomain:
      typeof result.tenant_subdomain === "string"
        ? result.tenant_subdomain
        : undefined,
  };
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
 * without an account. The address goes in the body, never into a URL.
 */
export async function findFormerEmployment(
  email: string,
  signal?: AbortSignal,
): Promise<FormerEmployment | null> {
  const data = await bffJson(
    "tenant",
    "POST /auth/invitations/former-employment",
    {
      body: { email },
      signal,
      errorMessage: "Frühere Beschäftigung konnte nicht geprüft werden.",
    },
  );
  return mapFormerEmploymentResponse(data.former_employment);
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
