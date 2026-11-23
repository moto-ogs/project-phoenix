// The browser contract of the session routes. Go's generated answers stay
// on the server; the BFF sends only the fields named here.
import type { StaffPreviewStartResponse } from "./contract/auth-staff-preview.generated";
import type { OperatorInvitationValidationResponse } from "./contract/operator-auth.generated";
import type {
  EnrollStartResponse,
  MFAResendResponse,
  OperatorResponse,
  PasskeyCeremonyOptions,
} from "./contract/shared.generated";
import { portalAuthPath, type PortalKey } from "./portal-paths";

export type SessionAuthenticated = { status: "authenticated" };

export type SignInReply =
  | SessionAuthenticated
  | {
      status: "mfa_required";
      challenge_token: string;
      masked_email?: string;
      organization_id?: string;
      trusted_device_enabled?: boolean;
      trusted_device_days?: number;
    }
  | {
      status: "mfa_enrollment_required";
      /** Limited enrollment proof, never an access token for a session. */
      access_token: string;
      masked_email?: string;
      organization_id?: string;
      mfa_enrollment_required: true;
    }
  | {
      status: "organization_selection_required";
      organizations: { id: string; name: string }[];
    };

export type OperatorInvitationFlow = { flow_id: string };

export type SessionRenewed = { session_renewed: boolean };

export type StaffPreviewReply = Pick<
  StaffPreviewStartResponse,
  "expires_in" | "target_account_id" | "target_name"
>;

const ANSWER = Symbol("session BFF answer");

export interface SessionBffRoute<T> {
  readonly method: "POST";
  readonly path: `/api/${string}`;
  readonly [ANSWER]: T | undefined;
}

function post<T>(path: `/api/${string}`): SessionBffRoute<T> {
  return { method: "POST", path, [ANSWER]: undefined };
}

function authStep<T>(step: string) {
  return (portal: PortalKey) => post<T>(portalAuthPath(portal, step));
}

export const sessionBff = {
  login: authStep<SignInReply>("login"),
  verifyMfa: authStep<SessionAuthenticated>("mfa/verify"),
  resendMfa: authStep<MFAResendResponse>("mfa/resend"),
  startEnrollment: authStep<EnrollStartResponse | null>("mfa/enroll/start"),
  confirmEnrollment: authStep<SessionAuthenticated>("mfa/enroll/confirm"),
  passkeyOptions: authStep<PasskeyCeremonyOptions>("passkeys/login/options"),
  verifyPasskey: authStep<SessionAuthenticated>("passkeys/login/verify"),
  logout: authStep<null>("logout"),
  switchTenant: post<null>("/api/auth/switch-tenant"),
  startPreview: post<StaffPreviewReply>("/api/auth/staff-preview"),
  endPreview: post<null>("/api/auth/staff-preview/end"),
  confirmCatererFactor: post<SessionRenewed>(
    "/api/caterer/account/mfa/confirm",
  ),
  confirmParentFactor: post<SessionRenewed>("/api/parent/me/mfa/confirm"),
  verifyTraegerStepUp: post<SessionRenewed>(
    "/api/traeger/auth/mfa/step-up/verify",
  ),
  startOperatorInvite: post<OperatorInvitationFlow>(
    "/api/operator/auth/invitations/session",
  ),
  validateOperatorInvite: post<OperatorInvitationValidationResponse>(
    "/api/operator/auth/invitations/validate",
  ),
  acceptOperatorInvite: post<OperatorResponse>(
    "/api/operator/auth/invitations/accept",
  ),
};
