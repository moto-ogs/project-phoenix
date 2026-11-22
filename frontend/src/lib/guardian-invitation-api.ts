import type {
  AcceptGuardianInvitationRequest as WireAcceptGuardianInvitationRequest,
  AcceptGuardianInvitationResponse as WireAcceptGuardianInvitationResponse,
  GuardianInvitationValidateResponse,
} from "~/lib/contract/auth-guardian-invitations.generated";
import {
  apiErrorFromBody,
  transportFetch,
  type ApiError,
} from "~/lib/api-error";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "GuardianInvitationAPI" });

export interface GuardianInvitationValidation {
  email: string;
  firstName?: string;
  lastName?: string;
  expiresAt: string;
  schoolName?: string;
  tenantSlug?: string;
  schoolLogoUrl?: string;
}

/**
 * Go's `GuardianInvitationValidateResponse`. The validation route is not in
 * the contract: the accept page reads it from Go directly (`sendBackend`),
 * so no decoder narrows it.
 */
export interface GuardianInvitationAcceptRequest {
  password: string;
  confirmPassword: string;
}

export interface GuardianInvitationAcceptResult {
  accountId: string;
  email: string;
  tenantSlug?: string;
}

const createApiError = async (
  response: Response,
  fallbackMessage: string,
): Promise<ApiError> => {
  let message = fallbackMessage;
  let payload: unknown;
  try {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("json")) {
      // The envelope's `detail` becomes the diagnostic message.
      payload = await response.json();
    } else {
      const text = (await response.text()).trim();
      if (text) {
        message = text;
      }
    }
  } catch (error) {
    logger.warn("guardian_invitation_error_parse_failed", {
      error: String(error),
    });
  }
  // A real ApiError, so code, field errors and request ID reach the shared
  // display path (#2518). The message stays a diagnostic.
  return apiErrorFromBody(message, response.status, payload);
};

const hasDataProperty = <T>(value: unknown): value is { data: T } => {
  return typeof value === "object" && value !== null && "data" in value;
};

const extractData = <T>(payload: unknown): T => {
  if (hasDataProperty<T>(payload)) {
    return payload.data;
  }
  return payload as T;
};

export const mapValidation = (
  data: GuardianInvitationValidateResponse,
): GuardianInvitationValidation => ({
  email: data.email,
  firstName: data.first_name,
  lastName: data.last_name,
  expiresAt: data.expires_at,
  schoolName: data.school_name,
  tenantSlug: data.tenant_slug,
  schoolLogoUrl: data.school_logo_url,
});

export async function acceptGuardianInvitation(
  token: string,
  data: GuardianInvitationAcceptRequest,
): Promise<GuardianInvitationAcceptResult> {
  const response = await transportFetch(
    `/api/auth/guardian-invitations/${encodeURIComponent(token)}/accept`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The backend's field names: the catalog proxy forwards the body as is.
      body: JSON.stringify({
        password: data.password,
        confirm_password: data.confirmPassword,
      } satisfies WireAcceptGuardianInvitationRequest),
    },
  );
  if (!response.ok) {
    throw await createApiError(
      response,
      "Einladung konnte nicht angenommen werden.",
    );
  }
  const raw = (await response.json()) as unknown;
  const payload = extractData<WireAcceptGuardianInvitationResponse>(raw);
  return {
    accountId: payload.account_id,
    email: payload.email,
    tenantSlug: payload.tenant_slug,
  };
}
