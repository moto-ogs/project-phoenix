// The browser contract of the session routes. Go's generated answers stay
// on the server; the BFF sends only the fields named here.
import type { LoginRequest } from "./contract/auth-login.generated";
import type { passkeyLoginOptionsRequest } from "./contract/auth-passkeys.generated";
import type {
  StaffPreviewEndRequest,
  StaffPreviewStartRequest,
  StaffPreviewStartResponse,
} from "./contract/auth-staff-preview.generated";
import type { SwitchTenantRequest } from "./contract/auth-switch-tenant.generated";
import type { catererLoginRequest } from "./contract/caterer-auth.generated";
import type { parentLoginRequest } from "./contract/parent-auth.generated";
import type { SchoolLoginRequest } from "./contract/school-auth.generated";
import type { confirmMFARequest } from "./contract/caterer-account.generated";
import type {
  MFAEnrollConfirmRequest,
  OperatorAcceptInvitationRequest,
  OperatorInvitationValidationResponse,
  OperatorLoginRequest,
  ValidateInvitationRequest,
} from "./contract/operator-auth.generated";
import type {
  TraegerLoginRequest,
  TraegerLoginResponse,
  TraegerMFAVerifyRequest,
} from "./contract/traeger-auth.generated";
import type {
  EnrollStartResponse,
  MFAResendResponse,
  MFAResendRequest,
  MFAVerifyRequest,
  PasskeyVerifyRequest,
  OperatorResponse,
  PasskeyCeremonyOptions,
} from "./contract/shared.generated";
import { portalAuthPath, type PortalKey } from "./portal-paths";

export type SessionAuthenticated = { status: "authenticated" };

type ChallengeFields = Pick<
  TraegerLoginResponse,
  "masked_email" | "organization_id"
>;

export type SignInReply =
  | SessionAuthenticated
  | (ChallengeFields &
      Pick<
        TraegerLoginResponse,
        "trusted_device_enabled" | "trusted_device_days"
      > & {
        status: "mfa_required";
        challenge_token: NonNullable<TraegerLoginResponse["challenge_token"]>;
      })
  | (ChallengeFields & {
      status: "mfa_enrollment_required";
      /** Limited enrollment proof, never an access token for a session. */
      access_token: NonNullable<TraegerLoginResponse["access_token"]>;
      mfa_enrollment_required: true;
    })
  | {
      status: "organization_selection_required";
      organizations: NonNullable<TraegerLoginResponse["organizations"]>;
    };

export type OperatorInvitationFlow = { flow_id: string };

export type SessionRenewed = { session_renewed: boolean };

export type StaffPreviewReply = Pick<
  StaffPreviewStartResponse,
  "expires_in" | "target_account_id" | "target_name"
>;

type PasswordRequest = {
  tenant: LoginRequest;
  school: SchoolLoginRequest;
  traeger: TraegerLoginRequest;
  operator: OperatorLoginRequest;
  parent: parentLoginRequest;
  caterer: catererLoginRequest;
};

export type SessionLoginBody<P extends PortalKey = PortalKey> =
  PasswordRequest[P] & {
    /** BFF-only flag, stripped before the request reaches Go. */
    ignore_trusted_device?: boolean;
  };

type PasswordBody = { [P in PortalKey]: SessionLoginBody<P> };
type VerifyBody = {
  [P in PortalKey]: P extends "traeger"
    ? TraegerMFAVerifyRequest
    : MFAVerifyRequest;
};
type ConfirmBody = {
  [P in PortalKey]: P extends "operator"
    ? MFAEnrollConfirmRequest
    : VerifyBody[P];
};
type PasskeyOptionsBody = {
  [P in PortalKey]: P extends "tenant" ? passkeyLoginOptionsRequest : undefined;
};

const SESSION_TYPES = Symbol("session BFF types");

export interface SessionBffRoute<T, B> {
  readonly method: "POST";
  readonly path: `/api/${string}`;
  readonly [SESSION_TYPES]: { answer: T; body: B } | undefined;
}

function post<T, B = undefined>(path: `/api/${string}`): SessionBffRoute<T, B> {
  return { method: "POST", path, [SESSION_TYPES]: undefined };
}

function authStep<T, B = undefined>(step: string) {
  return (portal: PortalKey) => post<T, B>(portalAuthPath(portal, step));
}

function portalStep<T, Bodies extends Record<PortalKey, unknown>>(
  step: string,
) {
  return <P extends PortalKey>(portal: P) =>
    post<T, Bodies[P]>(portalAuthPath(portal, step));
}

export const sessionBff = {
  login: portalStep<SignInReply, PasswordBody>("login"),
  verifyMfa: portalStep<SessionAuthenticated, VerifyBody>("mfa/verify"),
  resendMfa: authStep<MFAResendResponse, MFAResendRequest>("mfa/resend"),
  startEnrollment: authStep<EnrollStartResponse | null>("mfa/enroll/start"),
  confirmEnrollment: portalStep<SessionAuthenticated, ConfirmBody>(
    "mfa/enroll/confirm",
  ),
  passkeyOptions: portalStep<PasskeyCeremonyOptions, PasskeyOptionsBody>(
    "passkeys/login/options",
  ),
  verifyPasskey: authStep<SessionAuthenticated, PasskeyVerifyRequest>(
    "passkeys/login/verify",
  ),
  logout: authStep<null>("logout"),
  switchTenant: post<null, SwitchTenantRequest>("/api/auth/switch-tenant"),
  startPreview: post<StaffPreviewReply, StaffPreviewStartRequest>(
    "/api/auth/staff-preview",
  ),
  endPreview: post<null, StaffPreviewEndRequest>("/api/auth/staff-preview/end"),
  confirmCatererFactor: post<SessionRenewed, confirmMFARequest>(
    "/api/caterer/account/mfa/confirm",
  ),
  confirmParentFactor: post<SessionRenewed, MFAVerifyRequest>(
    "/api/parent/me/mfa/confirm",
  ),
  verifyTraegerStepUp: post<SessionRenewed, MFAVerifyRequest>(
    "/api/traeger/auth/mfa/step-up/verify",
  ),
  startOperatorInvite: post<
    OperatorInvitationFlow,
    Pick<ValidateInvitationRequest, "token">
  >("/api/operator/auth/invitations/session"),
  validateOperatorInvite: post<
    OperatorInvitationValidationResponse,
    ValidateInvitationRequest
  >("/api/operator/auth/invitations/validate"),
  acceptOperatorInvite: post<OperatorResponse, OperatorAcceptInvitationRequest>(
    "/api/operator/auth/invitations/accept",
  ),
};
