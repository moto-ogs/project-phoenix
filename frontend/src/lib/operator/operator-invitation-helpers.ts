import type { PendingOperatorInvitationResponse as WirePendingInvitation } from "~/lib/contract/operator-invitations.generated";
import type { OperatorListItem as WireOperatorListItem } from "~/lib/contract/shared.generated";

/**
 * Answer of POST /api/operator/auth/invitations/validate. The route is
 * public and outside the contract catalog, so its type stays handwritten.
 */
export interface InvitationValidationBody {
  email: string;
  display_name?: string | null;
  expires_at: string;
}

// --- Frontend types (camelCase) ---

export interface PendingOperatorInvitation {
  id: string;
  email: string;
  displayName?: string;
  createdBy: string;
  creatorName?: string;
  expiresAt: string;
  emailSentAt?: string;
  emailError?: string;
  emailRetryCount: number;
  createdAt: string;
}

export interface OperatorInfo {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
  lastLogin?: string;
  /** Set while the account is deactivated; the account is deleted later. */
  deactivatedAt?: string;
  /** When moto deletes the deactivated account. */
  deletionDueAt?: string;
  createdAt: string;
  /** The signed-in operator, who cannot deactivate their own account. */
  isSelf: boolean;
}

export interface OperatorInvitationValidation {
  email: string;
  displayName?: string;
  expiresAt: string;
}

export interface CreateOperatorInvitationRequest {
  email: string;
  displayName?: string;
}

export interface AcceptOperatorInvitationRequest {
  displayName: string;
  password: string;
  confirmPassword: string;
}

// --- Mappers ---

export function mapPendingInvitation(
  data: WirePendingInvitation,
): PendingOperatorInvitation {
  return {
    id: data.id,
    email: data.email,
    displayName: data.display_name,
    createdBy: data.created_by,
    creatorName: data.creator_name,
    expiresAt: data.expires_at,
    emailSentAt: data.email_sent_at,
    emailError: data.email_error,
    emailRetryCount: data.email_retry_count,
    createdAt: data.created_at,
  };
}

export function mapOperatorInfo(data: WireOperatorListItem): OperatorInfo {
  return {
    id: data.id,
    email: data.email,
    displayName: data.display_name,
    active: data.active,
    lastLogin: data.last_login,
    deactivatedAt: data.deactivated_at,
    deletionDueAt: data.deletion_due_at,
    createdAt: data.created_at,
    isSelf: data.is_self,
  };
}

export function mapInvitationValidation(
  data: InvitationValidationBody,
): OperatorInvitationValidation {
  return {
    email: data.email,
    displayName: data.display_name ?? undefined,
    expiresAt: data.expires_at,
  };
}
