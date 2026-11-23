import { bffJson } from "~/lib/bff-fetch";
import type * as guardianInvitationsContract from "~/lib/contract/auth-guardian-invitations.generated";

export interface GuardianInvitationValidation {
  email: string;
  firstName?: string;
  lastName?: string;
  expiresAt: string;
  schoolName?: string;
  tenantSlug?: string;
  schoolLogoUrl?: string;
}

export interface GuardianInvitationAcceptRequest {
  password: string;
  confirmPassword: string;
}

export interface GuardianInvitationAcceptResult {
  accountId: string;
  email: string;
  tenantSlug?: string;
}

export const mapValidation = (
  data: guardianInvitationsContract.GuardianInvitationValidateResponse,
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
  // Without a session (`public`): the link creates the parent's account.
  const accepted = await bffJson(
    "public",
    "POST /auth/guardian-invitations/{token}/accept",
    {
      params: { token },
      body: {
        password: data.password,
        confirm_password: data.confirmPassword,
      },
      errorMessage: "Einladung konnte nicht angenommen werden.",
    },
  );
  return {
    accountId: accepted.account_id,
    email: accepted.email,
    tenantSlug: accepted.tenant_slug,
  };
}
