import { transportFetch } from "~/lib/api-error";
import { buildApiError } from "~/lib/api-error-response";
import type {
  InvitationValidation,
  InvitationAcceptRequest,
  CreateInvitationRequest,
  PendingInvitation,
  BackendInvitationValidation,
  BackendFormerEmployment,
  FormerEmployment,
} from "./invitation-helpers";
import {
  mapFormerEmploymentResponse,
  mapInvitationValidationResponse,
  mapPendingInvitationResponse,
  toCreateInvitationBody,
} from "./invitation-helpers";
import type { SchoolInvitationResponse } from "~/lib/contract/auth-invitations.generated";

const hasDataProperty = <T>(value: unknown): value is { data: T } => {
  return typeof value === "object" && value !== null && "data" in value;
};

const extractData = <T>(payload: unknown): T => {
  if (hasDataProperty<T>(payload)) {
    return payload.data;
  }
  return payload as T;
};

export async function validateInvitation(
  token: string,
): Promise<InvitationValidation> {
  const response = await transportFetch(
    `/api/auth/invitations/${encodeURIComponent(token)}`,
  );
  if (!response.ok) {
    throw await buildApiError(
      response,
      "Einladung konnte nicht geprüft werden.",
    );
  }
  const raw = (await response.json()) as unknown;
  const data = extractData<BackendInvitationValidation>(raw);
  return mapInvitationValidationResponse(data);
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
  // The staff portal's catalog proxy serves /auth/invitations (#7563).
  const response = await transportFetch("/api/auth/invitations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(toCreateInvitationBody(data)),
    credentials: "include",
  });

  if (!response.ok) {
    throw await buildApiError(
      response,
      "Einladung konnte nicht erstellt werden.",
    );
  }

  const json = (await response.json()) as { data: SchoolInvitationResponse };
  return mapPendingInvitationResponse(json.data);
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
  const response = await transportFetch(
    "/api/auth/invitations/former-employment",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
      credentials: "include",
      signal,
    },
  );
  if (!response.ok) {
    throw await buildApiError(
      response,
      "Frühere Beschäftigung konnte nicht geprüft werden.",
    );
  }
  const raw = (await response.json()) as unknown;
  const data = extractData<{
    former_employment?: BackendFormerEmployment | null;
  }>(raw);
  return mapFormerEmploymentResponse(data.former_employment);
}

export async function listPendingInvitations(): Promise<PendingInvitation[]> {
  const response = await transportFetch("/api/auth/invitations", {
    credentials: "include",
  });
  if (!response.ok) {
    throw await buildApiError(
      response,
      "Offene Einladungen konnten nicht geladen werden.",
    );
  }
  const json = (await response.json()) as { data: SchoolInvitationResponse[] };
  return json.data.map(mapPendingInvitationResponse);
}

export async function resendInvitation(id: string): Promise<void> {
  const response = await transportFetch(
    `/api/auth/invitations/${encodeURIComponent(id)}/resend`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw await buildApiError(
      response,
      "Einladung konnte nicht erneut gesendet werden.",
    );
  }
}

export async function revokeInvitation(id: string): Promise<void> {
  const response = await transportFetch(
    `/api/auth/invitations/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw await buildApiError(
      response,
      "Einladung konnte nicht widerrufen werden.",
    );
  }
}
